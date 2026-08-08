import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import type { Lane, RateLimit, Row, ScanResult, Source, ToolRow } from "./types";

const HOME = os.homedir();

/**
 * Log locations differ by OS and by how the tools were installed, so try the
 * documented env override first, then the usual spots. path.join keeps the
 * separators correct on Windows.
 */
/**
 * An explicit TOKEN_ATLAS_* override wins outright, even when the directory
 * does not exist — the user is stating where to look, and quietly falling
 * back to the default would scan the wrong logs and report them as theirs.
 * Everything else is best-effort: first candidate that exists.
 */
function resolveDir(override: string | undefined, candidates: Array<string | undefined>): string {
  if (override) return override;
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  return candidates.find(Boolean) as string;
}

export const CLAUDE_DIR = resolveDir(process.env.TOKEN_ATLAS_CLAUDE_DIR, [
  process.env.CLAUDE_CONFIG_DIR
    ? path.join(process.env.CLAUDE_CONFIG_DIR, "projects")
    : undefined,
  path.join(HOME, ".claude", "projects"),
  process.env.APPDATA ? path.join(process.env.APPDATA, "claude", "projects") : undefined,
]);

export const CODEX_DIR = resolveDir(process.env.TOKEN_ATLAS_CODEX_DIR, [
  process.env.CODEX_HOME ? path.join(process.env.CODEX_HOME, "sessions") : undefined,
  path.join(HOME, ".codex", "sessions"),
  process.env.APPDATA ? path.join(process.env.APPDATA, "codex", "sessions") : undefined,
]);

/**
 * The cache lives under the user's home, never the working directory — the CLI
 * is run via npx from wherever the user happens to be, which may be read-only
 * and is not ours to write into.
 */
const CACHE_FILE = path.join(HOME, ".token-atlas", "scan-cache.json");

/* ------------------------------------------------------------------ */
/* accumulator                                                         */
/* ------------------------------------------------------------------ */

type Acc = { rows: Map<string, Row>; tools: Map<string, ToolRow> };

function newAcc(): Acc {
  return { rows: new Map(), tools: new Map() };
}

function localDay(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

interface Bump {
  ts: number;
  src: Source;
  model: string;
  effort: string;
  project: string;
  lane: Lane;
  agent: string;
  input?: number;
  cacheRead?: number;
  cacheWrite?: number;
  output?: number;
  reasoning?: number;
  thinkChars?: number;
  turns?: number;
}

function bump(acc: Acc, b: Bump) {
  const day = localDay(b.ts);
  const key = `${day}|${b.src}|${b.model}|${b.effort}|${b.project}|${b.lane}|${b.agent}`;
  let r = acc.rows.get(key);
  if (!r) {
    r = {
      day,
      src: b.src,
      model: b.model,
      effort: b.effort,
      project: b.project,
      lane: b.lane,
      agent: b.agent,
      input: 0,
      cacheRead: 0,
      cacheWrite: 0,
      output: 0,
      reasoning: 0,
      thinkChars: 0,
      turns: 0,
    };
    acc.rows.set(key, r);
  }
  r.input += b.input ?? 0;
  r.cacheRead += b.cacheRead ?? 0;
  r.cacheWrite += b.cacheWrite ?? 0;
  r.output += b.output ?? 0;
  r.reasoning += b.reasoning ?? 0;
  r.thinkChars += b.thinkChars ?? 0;
  r.turns += b.turns ?? 0;
}

function bumpTool(
  acc: Acc,
  ts: number,
  src: Source,
  lane: Lane,
  tool: string,
  n = 1,
) {
  const day = localDay(ts);
  const key = `${day}|${src}|${lane}|${tool}`;
  const t = acc.tools.get(key);
  if (t) t.calls += n;
  else acc.tools.set(key, { day, src, lane, tool, calls: n });
}

/** Merge a pre-aggregated row (from cache) into the accumulator. */
function mergeRow(acc: Acc, r: Row) {
  const key = `${r.day}|${r.src}|${r.model}|${r.effort}|${r.project}|${r.lane}|${r.agent}`;
  const cur = acc.rows.get(key);
  if (!cur) {
    acc.rows.set(key, { ...r });
    return;
  }
  cur.input += r.input;
  cur.cacheRead += r.cacheRead;
  cur.cacheWrite += r.cacheWrite;
  cur.output += r.output;
  cur.reasoning += r.reasoning;
  cur.thinkChars += r.thinkChars;
  cur.turns += r.turns;
}

function mergeTool(acc: Acc, t: ToolRow) {
  const key = `${t.day}|${t.src}|${t.lane}|${t.tool}`;
  const cur = acc.tools.get(key);
  if (cur) cur.calls += t.calls;
  else acc.tools.set(key, { ...t });
}

function latest(rs: RateLimit[]): RateLimit | null {
  let best: RateLimit | null = null;
  for (const r of rs) if (!best || r.observedAt > best.observedAt) best = r;
  return best;
}

/** Non-negative integer coercion — guards against nulls and bad deltas. */
function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

function projectOf(cwd: unknown): string {
  if (typeof cwd !== "string" || !cwd) return "unknown";
  const base = path.basename(cwd);
  return base || "unknown";
}

/* ------------------------------------------------------------------ */
/* Claude Code transcripts                                             */
/* ------------------------------------------------------------------ */
/*
 * Claude splits ONE API response across several JSONL lines (one per content
 * block) that each repeat the *same* usage object. Summing naively inflates
 * totals ~2.4x, so usage is counted once per requestId. Content blocks are
 * disjoint across those lines, so tool_use / thinking are counted on every line.
 */
async function scanClaudeFile(file: string, acc: Acc) {
  const rl = readline.createInterface({
    input: fs.createReadStream(file),
    crlfDelay: Infinity,
  });
  const seen = new Set<string>();

  for await (const line of rl) {
    if (line.length < 40 || line.indexOf('"usage"') < 0) continue;

    let d: any;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (d?.type !== "assistant") continue;

    const msg = d.message;
    if (!msg) continue;

    const ts = Date.parse(d.timestamp);
    if (!Number.isFinite(ts)) continue;

    const lane: Lane = d.isSidechain ? "subagent" : "main";
    const model = String(msg.model ?? "unknown");
    const effort = String(d.effort ?? "none");
    const project = projectOf(d.cwd);
    const agent = d.isSidechain ? "sidechain" : "";

    // Content blocks are disjoint across the lines of one request.
    let thinkChars = 0;
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const c of content) {
      if (!c || typeof c !== "object") continue;
      if (c.type === "tool_use" && typeof c.name === "string") {
        bumpTool(acc, ts, "claude", lane, c.name);
      } else if (c.type === "thinking" && typeof c.thinking === "string") {
        thinkChars += c.thinking.length;
      }
    }

    const rid = d.requestId ?? msg.id;
    const dup = typeof rid === "string" && seen.has(rid);
    if (typeof rid === "string") seen.add(rid);

    const u = dup ? null : msg.usage;

    bump(acc, {
      ts,
      src: "claude",
      model,
      effort,
      project,
      lane,
      agent,
      thinkChars,
      input: num(u?.input_tokens),
      cacheRead: num(u?.cache_read_input_tokens),
      cacheWrite: num(u?.cache_creation_input_tokens),
      output: num(u?.output_tokens),
      turns: u ? 1 : 0,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Codex sessions                                                      */
/* ------------------------------------------------------------------ */
/*
 * Codex emits `total_token_usage` as a CUMULATIVE running counter, so per-turn
 * cost is the delta between consecutive events. Summing `last_token_usage`
 * instead double-counts, because duplicate token_count events are emitted.
 * Each delta is attributed to the model from the most recent turn_context.
 */
async function scanCodexFile(
  file: string,
  acc: Acc,
  onRateLimit: (r: RateLimit) => void,
) {
  const rl = readline.createInterface({
    input: fs.createReadStream(file),
    crlfDelay: Infinity,
  });

  let project = "unknown";
  let lane: Lane = "main";
  let agent = "";
  let model = "unknown";
  let effort = "none";

  // previous cumulative snapshot
  let pIn = 0, pCachedIn = 0, pCacheWrite = 0, pOut = 0, pReason = 0;
  // token_count events seen before any turn_context, awaiting a model
  const pending: Bump[] = [];

  for await (const line of rl) {
    if (
      line.indexOf('"token_count"') < 0 &&
      line.indexOf('"turn_context"') < 0 &&
      line.indexOf('"session_meta"') < 0 &&
      line.indexOf('"function_call"') < 0 &&
      line.indexOf('"custom_tool_call"') < 0 &&
      line.indexOf('"local_shell_call"') < 0 &&
      line.indexOf('"web_search_call"') < 0
    ) continue;

    let d: any;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const p = d?.payload;
    if (!p || typeof p !== "object") continue;
    const ts = Date.parse(d.timestamp);

    if (d.type === "session_meta") {
      project = projectOf(p.cwd);
      const sub = p.source && typeof p.source === "object" ? p.source.subagent : null;
      if (sub) {
        lane = "subagent";
        agent =
          typeof sub === "string"
            ? sub
            : typeof sub.other === "string"
              ? sub.other
              : sub.thread_spawn
                ? "spawned worker"
                : "subagent";
      } else if (p.thread_source === "subagent") {
        lane = "subagent";
        agent = "subagent";
      } else if (p.thread_source === "automation") {
        lane = "automation";
        agent = "automation";
      } else if (p.thread_source === "realtime_voice") {
        lane = "automation";
        agent = "realtime voice";
      }
      continue;
    }

    if (d.type === "turn_context") {
      if (typeof p.model === "string") model = p.model;
      if (typeof p.effort === "string") effort = p.effort;
      else if (p.collaboration_mode?.settings?.reasoning_effort)
        effort = String(p.collaboration_mode.settings.reasoning_effort);
      // Some files emit token_count before the first turn_context; those were
      // parked with an unknown model and are attributed here.
      if (pending.length) {
        for (const b of pending) {
          b.model = model;
          b.effort = effort;
          b.lane = laneFor(model, lane);
          if (model === "codex-auto-review") b.agent = "auto-review";
          bump(acc, b);
        }
        pending.length = 0;
      }
      continue;
    }

    if (d.type === "response_item") {
      const t = p.type;
      if (
        t === "function_call" ||
        t === "custom_tool_call" ||
        t === "local_shell_call" ||
        t === "web_search_call"
      ) {
        const name =
          typeof p.name === "string" && p.name ? p.name : String(t);
        if (Number.isFinite(ts)) {
          bumpTool(acc, ts, "codex", laneFor(model, lane), name);
        }
      }
      continue;
    }

    if (p.type === "token_count") {
      const rlim = p.rate_limits;
      if (rlim?.primary && Number.isFinite(ts)) {
        onRateLimit({
          usedPercent: Number(rlim.primary.used_percent ?? 0),
          windowMinutes: Number(rlim.primary.window_minutes ?? 0),
          resetsAt: rlim.primary.resets_at ?? null,
          plan: rlim.plan_type ?? null,
          observedAt: ts,
        });
      }

      const tot = p.info?.total_token_usage;
      if (!tot || !Number.isFinite(ts)) continue;

      const cIn = num(tot.input_tokens);
      const cCached = num(tot.cached_input_tokens);
      const cWrite = num(tot.cache_write_input_tokens);
      const cOut = num(tot.output_tokens);
      const cReason = num(tot.reasoning_output_tokens);

      // Counter reset (new thread inside the same file) -> take value as-is.
      const reset = cIn < pIn || cOut < pOut;
      const dIn = reset ? cIn : cIn - pIn;
      const dCached = reset ? cCached : cCached - pCachedIn;
      const dWrite = reset ? cWrite : cWrite - pCacheWrite;
      const dOut = reset ? cOut : cOut - pOut;
      const dReason = reset ? cReason : cReason - pReason;

      pIn = cIn; pCachedIn = cCached; pCacheWrite = cWrite;
      pOut = cOut; pReason = cReason;

      if (dIn <= 0 && dOut <= 0 && dCached <= 0) continue;

      // Codex reports `input_tokens` INCLUSIVE of the cached portion.
      const fresh = Math.max(0, dIn - Math.max(0, dCached));

      const b: Bump = {
        ts,
        src: "codex",
        model,
        effort,
        project,
        lane: laneFor(model, lane),
        agent: model === "codex-auto-review" ? "auto-review" : agent,
        input: fresh,
        cacheRead: Math.max(0, dCached),
        cacheWrite: Math.max(0, dWrite),
        output: Math.max(0, dOut),
        reasoning: Math.max(0, dReason),
        turns: 1,
      };
      if (model === "unknown") pending.push(b);
      else bump(acc, b);
    }
  }

  // No turn_context ever arrived — keep the tokens rather than dropping them.
  for (const b of pending) bump(acc, b);
}

/** Auto-review is its own model id, and is the more specific attribution. */
function laneFor(model: string, sessionLane: Lane): Lane {
  if (model === "codex-auto-review") return "auto-review";
  return sessionLane;
}

/* ------------------------------------------------------------------ */
/* cache + orchestration                                               */
/* ------------------------------------------------------------------ */

interface CacheEntry {
  mtimeMs: number;
  size: number;
  rows: Row[];
  tools: ToolRow[];
  rateLimit: RateLimit | null;
}
type Cache = Record<string, CacheEntry>;

function loadCache(): Cache {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveCache(c: Cache) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(c));
  } catch {
    /* cache is an optimisation; failing to persist is not fatal */
  }
}

function listFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

export async function scan(force = false): Promise<ScanResult> {
  const t0 = Date.now();
  const cache = force ? {} : loadCache();
  const next: Cache = {};
  const missing: string[] = [];

  if (!fs.existsSync(CLAUDE_DIR)) missing.push(CLAUDE_DIR);
  if (!fs.existsSync(CODEX_DIR)) missing.push(CODEX_DIR);

  const jobs: Array<{ file: string; src: Source }> = [
    ...listFiles(CLAUDE_DIR).map((file) => ({ file, src: "claude" as const })),
    ...listFiles(CODEX_DIR).map((file) => ({ file, src: "codex" as const })),
  ];

  const merged = newAcc();
  let bytes = 0;
  let reparsed = 0;
  const rates: RateLimit[] = [];

  const CONCURRENCY = 8;
  let idx = 0;

  async function worker() {
    while (idx < jobs.length) {
      const job = jobs[idx++];
      let st: fs.Stats;
      try {
        st = fs.statSync(job.file);
      } catch {
        continue;
      }
      bytes += st.size;

      const hit = cache[job.file];
      if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
        next[job.file] = hit;
        continue;
      }

      reparsed++;
      const acc = newAcc();
      const fileRates: RateLimit[] = [];
      try {
        if (job.src === "claude") await scanClaudeFile(job.file, acc);
        else await scanCodexFile(job.file, acc, (r) => fileRates.push(r));
      } catch {
        continue; // an unreadable/partial file must not sink the whole scan
      }
      next[job.file] = {
        mtimeMs: st.mtimeMs,
        size: st.size,
        rows: [...acc.rows.values()],
        tools: [...acc.tools.values()],
        rateLimit: latest(fileRates),
      };
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker),
  );

  for (const entry of Object.values(next)) {
    for (const r of entry.rows) mergeRow(merged, r);
    for (const t of entry.tools) mergeTool(merged, t);
    if (entry.rateLimit) rates.push(entry.rateLimit);
  }

  saveCache(next);
  const rateLimit = latest(rates);

  return {
    rows: [...merged.rows.values()],
    tools: [...merged.tools.values()],
    rateLimit,
    meta: {
      scannedAt: Date.now(),
      files: jobs.length,
      filesReparsed: reparsed,
      bytes,
      durationMs: Date.now() - t0,
      claudeDir: CLAUDE_DIR,
      codexDir: CODEX_DIR,
      missing,
    },
  };
}
