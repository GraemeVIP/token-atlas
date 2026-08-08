/**
 * Reproduces the Codex usage view's shape from local logs:
 * tokens per day, per model (TokenUsageProfileDailyBucket = {start_date, tokens}).
 * Lets us predict what the in-app chart should show and check our numbers.
 */
import { scan } from "../lib/scan.ts";
import { rowTotal } from "../lib/agg.ts";

const res = await scan(false);
const codex = res.rows.filter((r) => r.src === "codex");

const days = new Map();
for (const r of codex) {
  const d = days.get(r.day) ?? new Map();
  d.set(r.model, (d.get(r.model) ?? 0) + rowTotal(r));
  days.set(r.day, d);
}

const M = (t) => (t / 1e6 >= 1000 ? (t / 1e9).toFixed(2) + "B" : Math.round(t / 1e6) + "M");
const recent = [...days.keys()].sort().slice(-8);

console.log("PREDICTED CODEX USAGE VIEW — tokens per day, per model\n");
for (const day of recent) {
  const m = [...days.get(day)].sort((a, b) => b[1] - a[1]);
  const tot = m.reduce((s, x) => s + x[1], 0);
  const ar = m.find((x) => x[0] === "codex-auto-review")?.[1] ?? 0;
  console.log(`${day}   total ${M(tot).padStart(7)}   auto-review ${((ar / tot) * 100).toFixed(1)}%`);
  for (const [model, tok] of m) {
    if (tok / tot < 0.005) continue;
    const bar = "█".repeat(Math.max(1, Math.round((tok / tot) * 34)));
    console.log(`   ${model.padEnd(20)}${M(tok).padStart(8)}  ${((tok / tot) * 100).toFixed(1).padStart(5)}%  ${bar}`);
  }
  console.log();
}

const tot = codex.reduce((s, r) => s + rowTotal(r), 0);
const ar = codex.filter((r) => r.model === "codex-auto-review").reduce((s, r) => s + rowTotal(r), 0);
console.log(`ALL TIME: auto-review = ${M(ar)} of ${M(tot)} = ${((ar / tot) * 100).toFixed(1)}%`);
console.log(`\nNote: the in-app view is per ACCOUNT (all devices); this is this Mac's logs only.`);
