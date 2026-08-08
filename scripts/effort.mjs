import { scan } from "../lib/scan.ts";

const RATES = {
  "gpt-5.6-sol":  { in: 5.0, cached: 0.5,  out: 30.0 },
  "gpt-5.6-luna": { in: 0.2, cached: 0.02, out: 1.2 },
};
const cost = (r, rate) =>
  (r.input * rate.in + r.cacheRead * rate.cached +
   r.cacheWrite * rate.in * 1.25 + r.output * rate.out) / 1e6;

const ORDER = ["low", "medium", "high", "xhigh", "max", "ultra"];
const res = await scan(false);

const agg = new Map();
for (const r of res.rows) {
  if (!RATES[r.model]) continue;
  const k = `${r.model}|${r.effort}`;
  const c = agg.get(k) ?? { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, turns: 0, usd: 0 };
  for (const f of ["input", "cacheRead", "cacheWrite", "output", "reasoning", "turns"]) c[f] += r[f];
  c.usd += cost(r, RATES[r.model]);
  agg.set(k, c);
}

for (const model of ["gpt-5.6-luna", "gpt-5.6-sol"]) {
  const rows = ORDER
    .map((e) => [e, agg.get(`${model}|${e}`)])
    .filter(([, c]) => c && c.turns >= 200);
  if (!rows.length) continue;

  console.log(`\n${"=".repeat(78)}\n${model}\n${"=".repeat(78)}`);
  console.log(`${"effort".padEnd(9)}${"requests".padStart(10)}${"reasoning/req".padStart(15)}${"output/req".padStart(12)}${"$/request".padStart(12)}${"vs max".padStart(10)}`);

  const max = agg.get(`${model}|max`);
  const maxPer = max ? max.usd / max.turns : null;

  for (const [e, c] of rows) {
    const per = c.usd / c.turns;
    const rel = maxPer ? `${((per / maxPer) * 100).toFixed(0)}%` : "-";
    console.log(
      `${e.padEnd(9)}${c.turns.toLocaleString().padStart(10)}` +
      `${Math.round(c.reasoning / c.turns).toLocaleString().padStart(15)}` +
      `${Math.round(c.output / c.turns).toLocaleString().padStart(12)}` +
      `${("$" + per.toFixed(4)).padStart(12)}${rel.padStart(10)}`,
    );
  }
}

// What 1,000 requests would cost at each rung
console.log(`\n\n${"=".repeat(78)}\nCOST OF 1,000 REQUESTS AT EACH SETTING\n${"=".repeat(78)}`);
const cells = [];
for (const model of ["gpt-5.6-luna", "gpt-5.6-sol"]) {
  for (const e of ORDER) {
    const c = agg.get(`${model}|${e}`);
    if (!c || c.turns < 200) continue;
    cells.push([`${model} · ${e}`, (c.usd / c.turns) * 1000]);
  }
}
cells.sort((a, b) => a[1] - b[1]);
const cheapest = cells[0][1];
for (const [k, v] of cells) {
  console.log(`${k.padEnd(26)}${("$" + v.toFixed(2)).padStart(12)}${(" " + (v / cheapest).toFixed(1) + "x cheapest").padStart(18)}`);
}
