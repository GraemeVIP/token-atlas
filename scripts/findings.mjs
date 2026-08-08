import { scan } from "../lib/scan.ts";
import { detect } from "../lib/anomalies.ts";
import { applyFilters, applyToolFilters, dayKey, addDays, weekStart } from "../lib/agg.ts";

const res = await scan(false);

const windows = [
  ["ALL TIME", null],
  ["THIS WEEK (Sat-start)", { from: weekStart(new Date()), to: addDays(weekStart(new Date()), 6) }],
  ["LAST WEEK", { from: addDays(weekStart(new Date()), -7), to: addDays(weekStart(new Date()), -1) }],
];

for (const [name, w] of windows) {
  const f = w
    ? { src: "all", lane: "all", model: "all", project: "all", from: dayKey(w.from), to: dayKey(w.to) }
    : { src: "all", lane: "all", model: "all", project: "all", from: null, to: null };
  const rows = applyFilters(res.rows, f);
  const tools = applyToolFilters(res.tools, f);
  const found = detect(rows, tools, res.rateLimit);
  console.log(`\n${"=".repeat(72)}\n${name} — ${found.length} finding(s)\n${"=".repeat(72)}`);
  for (const x of found) {
    console.log(`\n[${x.severity.toUpperCase()}] ${x.title}`);
    console.log(`   ${x.detail}`);
    console.log(`   WHY: ${x.why.slice(0, 150)}…`);
  }
}

// Noise check: a lane-filtered view should not invent findings about that lane.
const only = { src: "all", lane: "main", model: "all", project: "all", from: null, to: null };
const mainOnly = detect(applyFilters(res.rows, only), applyToolFilters(res.tools, only), null);
console.log(`\n${"=".repeat(72)}\nMAIN-THREAD-ONLY FILTER (should not report invisible burn) — ${mainOnly.length}`);
for (const x of mainOnly) console.log(`   [${x.severity}] ${x.title}`);
