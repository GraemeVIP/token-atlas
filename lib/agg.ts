import type { Lane, Row, Source, TokenKind, ToolRow } from "./types";

export const LANE_LABEL: Record<Lane, string> = {
  main: "Main thread",
  "auto-review": "Auto review",
  subagent: "Subagents",
  automation: "Automation",
};

export const TOKEN_KINDS: TokenKind[] = [
  "input",
  "cacheWrite",
  "cacheRead",
  "output",
];

/**
 * Relative billing weight per token kind, expressed against a base input
 * token: cache reads are ~10x cheaper than fresh input, cache writes carry a
 * premium, and output costs the most. Drives the "weighted" lens, which
 * reflects expense rather than raw volume.
 */
export const WEIGHTS: Record<TokenKind, number> = {
  input: 1,
  cacheWrite: 1.25,
  cacheRead: 0.1,
  output: 5,
};

export function rowTotal(r: Row): number {
  return r.input + r.cacheRead + r.cacheWrite + r.output;
}

export function rowWeighted(r: Row): number {
  return (
    r.input * WEIGHTS.input +
    r.cacheWrite * WEIGHTS.cacheWrite +
    r.cacheRead * WEIGHTS.cacheRead +
    r.output * WEIGHTS.output
  );
}

/* ------------------------------------------------------------------ */
/* Dates — the week begins on SATURDAY                                 */
/* ------------------------------------------------------------------ */

export const WEEK_STARTS_ON = 6; // 0=Sun … 6=Sat

/** Midnight on the Saturday that begins the week containing `d`. */
export function weekStart(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // Sat(6)->0, Sun(0)->1, Mon(1)->2 … Fri(5)->6
  x.setDate(x.getDate() - ((x.getDay() + 1) % 7));
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseDay(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function shortDate(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function dowShort(d: Date): string {
  return DOW[d.getDay()];
}

/** "Sat 2 Aug – Fri 8 Aug" */
export function weekLabel(ws: Date): string {
  const we = addDays(ws, 6);
  const sameMonth = ws.getMonth() === we.getMonth();
  return sameMonth
    ? `${ws.getDate()} – ${we.getDate()} ${MONTHS[we.getMonth()]}`
    : `${shortDate(ws)} – ${shortDate(we)}`;
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

export function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e12) return (n / 1e12).toFixed(a >= 1e13 ? 0 : 1).replace(/\.0$/, "") + "T";
  if (a >= 1e9) return (n / 1e9).toFixed(a >= 1e10 ? 0 : 1).replace(/\.0$/, "") + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "K";
  return String(Math.round(n));
}

export function full(n: number): string {
  return Math.round(n).toLocaleString();
}

export function pct(part: number, whole: number): string {
  if (!whole) return "0%";
  const v = (part / whole) * 100;
  return v < 0.1 && v > 0 ? "<0.1%" : `${v.toFixed(v < 10 ? 1 : 0)}%`;
}

/* ------------------------------------------------------------------ */
/* Metric lens                                                         */
/* ------------------------------------------------------------------ */

export type Metric = "total" | "weighted";

export function metricOf(r: Row, m: Metric): number {
  return m === "weighted" ? rowWeighted(r) : rowTotal(r);
}

export const METRIC_LABEL: Record<Metric, string> = {
  total: "Raw tokens",
  weighted: "Weighted",
};

/* ------------------------------------------------------------------ */
/* Filtering                                                           */
/* ------------------------------------------------------------------ */

export interface Filters {
  src: Source | "all";
  lane: Lane | "all";
  model: string | "all";
  project: string | "all";
  from: string | null; // inclusive YYYY-MM-DD
  to: string | null; // inclusive
}

export function applyFilters(rows: Row[], f: Filters): Row[] {
  return rows.filter(
    (r) =>
      (f.src === "all" || r.src === f.src) &&
      (f.lane === "all" || r.lane === f.lane) &&
      (f.model === "all" || r.model === f.model) &&
      (f.project === "all" || r.project === f.project) &&
      (!f.from || r.day >= f.from) &&
      (!f.to || r.day <= f.to),
  );
}

export function applyToolFilters(tools: ToolRow[], f: Filters): ToolRow[] {
  return tools.filter(
    (t) =>
      (f.src === "all" || t.src === f.src) &&
      (f.lane === "all" || t.lane === f.lane) &&
      (!f.from || t.day >= f.from) &&
      (!f.to || t.day <= f.to),
  );
}

/* ------------------------------------------------------------------ */
/* Grouping                                                            */
/* ------------------------------------------------------------------ */

export interface Group {
  key: string;
  value: number;
  turns: number;
  rows: Row[];
}

export function groupBy(
  rows: Row[],
  keyfn: (r: Row) => string,
  m: Metric,
): Group[] {
  const map = new Map<string, Group>();
  for (const r of rows) {
    const key = keyfn(r);
    let g = map.get(key);
    if (!g) {
      g = { key, value: 0, turns: 0, rows: [] };
      map.set(key, g);
    }
    g.value += metricOf(r, m);
    g.turns += r.turns;
    g.rows.push(r);
  }
  return [...map.values()].sort((a, b) => b.value - a.value);
}

export function sum(rows: Row[], m: Metric): number {
  let t = 0;
  for (const r of rows) t += metricOf(r, m);
  return t;
}

export function sumField(rows: Row[], field: keyof Row): number {
  let t = 0;
  for (const r of rows) {
    const v = r[field];
    if (typeof v === "number") t += v;
  }
  return t;
}

/** Distinct values present in the data, for filter dropdowns. */
export function distinct(rows: Row[], keyfn: (r: Row) => string): string[] {
  return [...new Set(rows.map(keyfn))].filter(Boolean).sort();
}

/* ------------------------------------------------------------------ */
/* Time series                                                         */
/* ------------------------------------------------------------------ */

export interface Bucket {
  /** bucket start */
  date: Date;
  label: string;
  /** stacked parts, in fixed series order */
  parts: Record<string, number>;
  total: number;
}

/**
 * Build a contiguous series of buckets (no gaps) between the first and last
 * day present, stacked by `partOf`. Contiguity matters: a missing day must
 * read as zero, not be silently skipped, or the trend lies.
 */
export function series(
  rows: Row[],
  granularity: "day" | "week",
  partOf: (r: Row) => string,
  m: Metric,
  range?: { from: Date; to: Date },
): Bucket[] {
  if (!rows.length && !range) return [];

  const startOf = (d: Date) => (granularity === "week" ? weekStart(d) : d);

  let lo: Date, hi: Date;
  if (range) {
    lo = startOf(range.from);
    hi = startOf(range.to);
  } else {
    const days = rows.map((r) => parseDay(r.day)).sort((a, b) => +a - +b);
    lo = startOf(days[0]);
    hi = startOf(days[days.length - 1]);
  }

  const buckets = new Map<string, Bucket>();
  const step = granularity === "week" ? 7 : 1;
  for (let d = new Date(lo); d <= hi; d = addDays(d, step)) {
    const k = dayKey(d);
    buckets.set(k, {
      date: new Date(d),
      label: granularity === "week" ? weekLabel(d) : shortDate(d),
      parts: {},
      total: 0,
    });
  }

  for (const r of rows) {
    const k = dayKey(startOf(parseDay(r.day)));
    const b = buckets.get(k);
    if (!b) continue;
    const p = partOf(r);
    const v = metricOf(r, m);
    b.parts[p] = (b.parts[p] ?? 0) + v;
    b.total += v;
  }

  return [...buckets.values()].sort((a, b) => +a.date - +b.date);
}

/* ------------------------------------------------------------------ */
/* Colour assignment — by entity, never by rank                        */
/* ------------------------------------------------------------------ */

const SLOTS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
  "var(--series-7)",
  "var(--series-8)",
];

/** Fixed lane colours — a lane keeps its hue no matter how it ranks. */
export const LANE_COLOR: Record<Lane, string> = {
  main: SLOTS[0],
  subagent: SLOTS[1],
  "auto-review": SLOTS[2],
  automation: SLOTS[3],
};

export const SRC_COLOR: Record<Source, string> = {
  claude: SLOTS[0],
  codex: SLOTS[1],
};

export const SRC_LABEL: Record<Source, string> = {
  claude: "Claude Code",
  codex: "Codex",
};

/** Token-kind colours, in a stable stacking order. */
export const KIND_ORDER = ["cacheRead", "input", "cacheWrite", "output"] as const;
export const KIND_COLOR: Record<string, string> = {
  cacheRead: SLOTS[2],
  input: SLOTS[0],
  cacheWrite: SLOTS[1],
  output: SLOTS[3],
};
export const KIND_LABEL: Record<string, string> = {
  cacheRead: "Cache read",
  input: "Fresh input",
  cacheWrite: "Cache write",
  output: "Output",
};

/**
 * Build a stable colour map for an arbitrary set of keys, capped at 8 slots
 * with the tail folded into "Other" — never a generated 9th hue.
 */
export function colorMap(keys: string[]): Record<string, string> {
  const m: Record<string, string> = {};
  keys.slice(0, 8).forEach((k, i) => (m[k] = SLOTS[i]));
  m["Other"] = "var(--dim)";
  return m;
}

export const OTHER = "Other";

/** Keep the top `n` keys by value and fold the rest into "Other". */
export function foldTail(groups: Group[], n: number): Group[] {
  if (groups.length <= n) return groups;
  const head = groups.slice(0, n);
  const tail = groups.slice(n);
  const other: Group = {
    key: OTHER,
    value: tail.reduce((s, g) => s + g.value, 0),
    turns: tail.reduce((s, g) => s + g.turns, 0),
    rows: tail.flatMap((g) => g.rows),
  };
  return other.value > 0 ? [...head, other] : head;
}
