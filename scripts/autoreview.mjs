import { scan } from "../lib/scan.ts";
import { rowTotal } from "../lib/agg.ts";

const res = await scan(false);
const codex = res.rows.filter((r) => r.src === "codex");

const grp = (f) => {
  const m = new Map();
  for (const r of codex) {
    const k = f(r);
    const c = m.get(k) ?? { tok: 0, req: 0, out: 0 };
    c.tok += rowTotal(r); c.req += r.turns; c.out += r.output;
    m.set(k, c);
  }
  return m;
};

const byLane = grp((r) => r.lane);
const tot = { tok: 0, req: 0 };
for (const v of byLane.values()) { tot.tok += v.tok; tot.req += v.req; }
const ar = byLane.get("auto-review") ?? { tok: 0, req: 0, out: 0 };
const pc = (a, b) => ((a / b) * 100).toFixed(1) + "%";
const n = (x) => Math.round(x).toLocaleString();

console.log("IS AUTO-REVIEW 'THE VAST MAJORITY' OF YOUR CODEX TOKENS?\n");
console.log(`${"lane".padEnd(14)}${"tokens".padStart(16)}${"share".padStart(9)}${"requests".padStart(11)}${"share".padStart(9)}`);
for (const [k, v] of [...byLane].sort((a, b) => b[1].tok - a[1].tok))
  console.log(`${k.padEnd(14)}${n(v.tok).padStart(16)}${pc(v.tok, tot.tok).padStart(9)}${n(v.req).padStart(11)}${pc(v.req, tot.req).padStart(9)}`);

console.log(`\n  auto-review by TOKENS   : ${pc(ar.tok, tot.tok)}`);
console.log(`  auto-review by REQUESTS : ${pc(ar.req, tot.req)}`);
console.log(`  -> "vast majority"? ${ar.tok / tot.tok > 0.5 ? "YES" : "NO"}`);

// Counterfactual: a user who never spawns subagents
const noSub = codex.filter((r) => r.lane === "main" || r.lane === "auto-review");
let nsTok = 0, nsReq = 0;
for (const r of noSub) { nsTok += rowTotal(r); nsReq += r.turns; }
console.log(`\nIF YOU NEVER SPAWNED SUBAGENTS (a "normal" Codex user):`);
console.log(`  auto-review would be ${pc(ar.tok, nsTok)} of tokens, ${pc(ar.req, nsReq)} of requests`);

// Why a request-count chart flatters auto-review
const main = byLane.get("main");
console.log(`\nWHY A REQUEST-COUNT CHART EXAGGERATES IT:`);
console.log(`  auto-review: ${n(ar.tok / ar.req)} tokens/request, ${n(ar.out / ar.req)} output tokens/request`);
console.log(`  main thread: ${n(main.tok / main.req)} tokens/request, ${n(main.out / main.req)} output tokens/request`);
console.log(`  -> auto-review writes ${(main.out / main.req / (ar.out / ar.req)).toFixed(1)}x less than a real turn,`);
console.log(`     so counting REQUESTS makes it look far bigger than counting work done.`);
