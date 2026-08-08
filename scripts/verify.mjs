/**
 * Sanity-checks the scanner against independently computed ground truth.
 * Run: node --experimental-strip-types scripts/verify.mjs
 */
import { scan } from "../lib/scan.ts";
import { rowTotal } from "../lib/agg.ts";

const fmt = (n) =>
  n >= 1e9 ? (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n.toLocaleString();

const t0 = Date.now();
const res = await scan(true);
console.log(`scan: ${res.meta.files} files, ${(res.meta.bytes / 1e9).toFixed(1)}GB in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`rows=${res.rows.length} toolRows=${res.tools.length}\n`);

const by = (rows, keyfn) => {
  const m = new Map();
  for (const r of rows) {
    const k = keyfn(r);
    m.set(k, (m.get(k) ?? 0) + rowTotal(r));
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

const grand = res.rows.reduce((s, r) => s + rowTotal(r), 0);
console.log("GRAND TOTAL:", fmt(grand), "tokens\n");

console.log("BY SOURCE");
for (const [k, v] of by(res.rows, (r) => r.src))
  console.log(`  ${k.padEnd(16)} ${fmt(v).padStart(9)}  ${((v / grand) * 100).toFixed(1)}%`);

console.log("\nBY LANE (where tokens burn)");
for (const [k, v] of by(res.rows, (r) => `${r.src}/${r.lane}`))
  console.log(`  ${k.padEnd(22)} ${fmt(v).padStart(9)}  ${((v / grand) * 100).toFixed(1)}%`);

console.log("\nBY MODEL");
for (const [k, v] of by(res.rows, (r) => r.model).slice(0, 12))
  console.log(`  ${k.padEnd(28)} ${fmt(v).padStart(9)}  ${((v / grand) * 100).toFixed(1)}%`);

console.log("\nBY EFFORT");
for (const [k, v] of by(res.rows, (r) => `${r.src}/${r.effort}`))
  console.log(`  ${k.padEnd(22)} ${fmt(v).padStart(9)}`);

console.log("\nBY TOKEN KIND");
const kinds = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 };
for (const r of res.rows) for (const k of Object.keys(kinds)) kinds[k] += r[k];
for (const [k, v] of Object.entries(kinds))
  console.log(`  ${k.padEnd(14)} ${fmt(v).padStart(9)}  ${((v / grand) * 100).toFixed(1)}%`);

console.log("\nTOP PROJECTS");
for (const [k, v] of by(res.rows, (r) => r.project).slice(0, 8))
  console.log(`  ${k.slice(0, 34).padEnd(36)} ${fmt(v).padStart(9)}`);

console.log("\nTOP TOOLS");
const tm = new Map();
for (const t of res.tools) tm.set(`${t.src}/${t.tool}`, (tm.get(`${t.src}/${t.tool}`) ?? 0) + t.calls);
for (const [k, v] of [...tm].sort((a, b) => b[1] - a[1]).slice(0, 12))
  console.log(`  ${k.padEnd(38)} ${v.toLocaleString()}`);

console.log("\nTURNS:", res.rows.reduce((s, r) => s + r.turns, 0).toLocaleString());
console.log("RATE LIMIT:", JSON.stringify(res.rateLimit));
const days = [...new Set(res.rows.map((r) => r.day))].sort();
console.log("DATE RANGE:", days[0], "->", days[days.length - 1], `(${days.length} days)`);

// cached rescan
const t1 = Date.now();
await scan(false);
console.log(`\ncached rescan: ${((Date.now() - t1) / 1000).toFixed(1)}s`);
