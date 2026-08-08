import { scan } from "../lib/scan.ts";
import { rowTotal, rowWeighted } from "../lib/agg.ts";

const res = await scan(false);
const sub = res.rows.filter((r) => r.lane === "subagent" || r.lane === "auto-review");

const m = new Map();
for (const r of sub) {
  const k = `${r.model} · ${r.effort}`;
  const c = m.get(k) ?? { tok: 0, w: 0, req: 0, out: 0 };
  c.tok += rowTotal(r);
  c.w += rowWeighted(r);
  c.req += r.turns;
  c.out += r.output;
  m.set(k, c);
}

const n = (x) => x.toLocaleString();
console.log(
  `${"subagent model · effort".padEnd(32)}${"tokens".padStart(15)}${"requests".padStart(10)}${"tok/req".padStart(11)}${"output/req".padStart(12)}`,
);
for (const [k, v] of [...m].sort((a, b) => b[1].tok - a[1].tok)) {
  if (v.req < 100) continue;
  console.log(
    `${k.padEnd(32)}${n(v.tok).padStart(15)}${n(v.req).padStart(10)}${n(Math.round(v.tok / v.req)).padStart(11)}${n(Math.round(v.out / v.req)).padStart(12)}`,
  );
}

const sol = m.get("gpt-5.6-sol · max");
const luna = m.get("gpt-5.6-luna · max");
if (sol && luna) {
  const a = sol.tok / sol.req, b = luna.tok / luna.req;
  console.log(`\nLuna max vs Sol max, tokens per request: ${Math.round(b).toLocaleString()} vs ${Math.round(a).toLocaleString()}`);
  console.log(`Luna uses ${((1 - b / a) * 100).toFixed(0)}% fewer raw tokens per request.`);
  console.log(`So N parallel Luna helpers cost about ${(b / a).toFixed(2)}×N of one Sol helper in raw tokens.`);
  console.log(`Break-even vs one Sol helper: about ${(a / b).toFixed(1)} Luna helpers.`);
}
