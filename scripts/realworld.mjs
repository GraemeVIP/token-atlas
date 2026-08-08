/**
 * Two empirical questions, answered from the raw Codex logs:
 *  1. Does Luna actually need more back-and-forth than Sol?
 *     -> agent turns and cost per USER MESSAGE (per thing you asked for).
 *  2. What does switching model mid-conversation actually cost?
 *     -> cache behaviour on the first turn after a switch vs a normal turn.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";

const RATES = {
  "gpt-5.6-sol":   { in: 5.0, cached: 0.5,  out: 30.0 },
  "gpt-5.6-luna":  { in: 0.2, cached: 0.02, out: 1.2 },
  "gpt-5.6-terra": { in: 2.0, cached: 0.2,  out: 12.0 },
};
const cost = (t, rate) =>
  rate ? (t.fresh * rate.in + t.cached * rate.cached + t.write * rate.in * 1.25 + t.out * rate.out) / 1e6 : 0;

const DIR = path.join(os.homedir(), ".codex", "sessions");
const files = fs.readdirSync(DIR, { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".jsonl")).map((f) => path.join(DIR, f));

const sessions = [];          // per-session rollups
const switchTurns = [];       // turns immediately after a model change
const normalTurns = [];       // all other turns

for (const fp of files) {
  let rl;
  try { rl = readline.createInterface({ input: fs.createReadStream(fp), crlfDelay: Infinity }); }
  catch { continue; }

  let model = null, prevModel = null, justSwitched = false, isSub = false;
  let users = 0, turns = 0, usd = 0;
  let pIn = 0, pCached = 0, pWrite = 0, pOut = 0;
  const modelTurns = new Map();

  for await (const line of rl) {
    if (line.indexOf('"token_count"') < 0 && line.indexOf('"turn_context"') < 0 &&
        line.indexOf('"user_message"') < 0 && line.indexOf('"session_meta"') < 0) continue;
    let d; try { d = JSON.parse(line); } catch { continue; }
    const p = d?.payload; if (!p || typeof p !== "object") continue;

    if (d.type === "session_meta") {
      const s = p.source;
      isSub = p.thread_source === "subagent" || (s && typeof s === "object" && "subagent" in s);
      continue;
    }
    if (d.type === "turn_context") {
      if (typeof p.model === "string") {
        if (model && p.model !== model) { prevModel = model; justSwitched = true; }
        model = p.model;
      }
      continue;
    }
    if (p.type === "user_message") { users++; continue; }
    if (p.type !== "token_count") continue;

    const tot = p.info?.total_token_usage; if (!tot) continue;
    const cIn = tot.input_tokens || 0, cCached = tot.cached_input_tokens || 0;
    const cWrite = tot.cache_write_input_tokens || 0, cOut = tot.output_tokens || 0;
    const reset = cIn < pIn || cOut < pOut;
    const dIn = reset ? cIn : cIn - pIn, dCached = reset ? cCached : cCached - pCached;
    const dWrite = reset ? cWrite : cWrite - pWrite, dOut = reset ? cOut : cOut - pOut;
    pIn = cIn; pCached = cCached; pWrite = cWrite; pOut = cOut;
    if (dIn <= 0 && dOut <= 0) continue;

    const t = { fresh: Math.max(0, dIn - Math.max(0, dCached)), cached: Math.max(0, dCached),
                write: Math.max(0, dWrite), out: Math.max(0, dOut) };
    const c = cost(t, RATES[model]);
    turns++; usd += c;
    modelTurns.set(model, (modelTurns.get(model) ?? 0) + 1);

    const rec = { ...t, usd: c, model, prevModel, total: t.fresh + t.cached + t.write + t.out };
    if (justSwitched) { switchTurns.push(rec); justSwitched = false; }
    else normalTurns.push(rec);
  }

  if (turns && users && !isSub) {
    const dominant = [...modelTurns].sort((a, b) => b[1] - a[1])[0]?.[0];
    sessions.push({ model: dominant, users, turns, usd });
  }
}

/* ---------- Q1: back-and-forth per thing you asked for ---------- */
const med = (a) => { if (!a.length) return 0; const s=[...a].sort((x,y)=>x-y); const m=s.length>>1;
  return s.length%2 ? s[m] : (s[m-1]+s[m])/2; };

console.log("=".repeat(74));
console.log("Q1  DOES LUNA NEED MORE BACK-AND-FORTH?");
console.log("=".repeat(74));
console.log(`${"model".padEnd(16)}${"sessions".padStart(9)}${"your msgs".padStart(11)}${"agent turns".padStart(13)}${"turns/msg".padStart(11)}${"$/your msg".padStart(12)}`);
for (const m of ["gpt-5.6-luna", "gpt-5.6-sol"]) {
  const ss = sessions.filter((s) => s.model === m);
  if (ss.length < 5) continue;
  const users = ss.reduce((a, s) => a + s.users, 0);
  const turns = ss.reduce((a, s) => a + s.turns, 0);
  const usd = ss.reduce((a, s) => a + s.usd, 0);
  const perMsg = ss.map((s) => s.turns / s.users);
  console.log(
    `${m.padEnd(16)}${ss.length.toString().padStart(9)}${users.toLocaleString().padStart(11)}` +
    `${turns.toLocaleString().padStart(13)}${med(perMsg).toFixed(1).padStart(11)}` +
    `${("$" + (usd / users).toFixed(3)).padStart(12)}`);
}

/* ---------- Q2: what a mid-chat model switch costs ---------- */
console.log("\n" + "=".repeat(74));
console.log("Q2  WHAT DOES SWITCHING MODEL MID-CHAT COST?");
console.log("=".repeat(74));
const summarise = (arr, label) => {
  if (!arr.length) { console.log(`${label}: no data`); return null; }
  const cachedShare = arr.map((r) => r.total ? r.cached / r.total : 0);
  const writeShare  = arr.map((r) => r.total ? r.write / r.total : 0);
  console.log(`${label.padEnd(34)} n=${String(arr.length).padStart(6)}  ` +
    `median cache-read ${(med(cachedShare)*100).toFixed(1).padStart(5)}%  ` +
    `median cache-write ${(med(writeShare)*100).toFixed(1).padStart(5)}%  ` +
    `median tokens ${Math.round(med(arr.map(r=>r.total))).toLocaleString().padStart(8)}`);
  return { cached: med(cachedShare), write: med(writeShare), tok: med(arr.map(r=>r.total)) };
};
const sw = summarise(switchTurns, "first turn AFTER a model switch");
const nm = summarise(normalTurns, "an ordinary turn");
if (sw && nm) {
  const extraWrite = (sw.write - nm.write) * sw.tok;
  console.log(`\n  Extra cache-WRITE on a switch turn: ~${Math.round(extraWrite).toLocaleString()} tokens`);
  console.log(`  Cost of that on Sol:  $${(extraWrite * 5.0 * 1.25 / 1e6).toFixed(3)}`);
  console.log(`  Cost of that on Luna: $${(extraWrite * 0.2 * 1.25 / 1e6).toFixed(3)}`);
  console.log(`  (one ordinary Sol request costs ~$0.13 for comparison)`);
}
