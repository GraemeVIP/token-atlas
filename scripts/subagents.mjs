import { scan } from "../lib/scan.ts";
import { rowTotal } from "../lib/agg.ts";

const res = await scan(false);
const fmt = (n) =>
  n >= 1e9 ? (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? (n / 1e6).toFixed(0) + "M" : n.toLocaleString();

const sub = res.rows.filter((r) => r.lane === "subagent" || r.lane === "auto-review");
const grand = sub.reduce((s, r) => s + rowTotal(r), 0);
console.log(`subagent + auto-review total: ${fmt(grand)}\n`);

const roll = (keyfn, title) => {
  const m = new Map();
  for (const r of sub) {
    const k = keyfn(r);
    const c = m.get(k) ?? { tok: 0, turns: 0 };
    c.tok += rowTotal(r);
    c.turns += r.turns;
    m.set(k, c);
  }
  console.log(`=== ${title} ===`);
  for (const [k, v] of [...m].sort((a, b) => b[1].tok - a[1].tok))
    console.log(
      `  ${k.padEnd(46)} ${fmt(v.tok).padStart(8)}  ${((v.tok / grand) * 100).toFixed(1).padStart(5)}%  ${v.turns.toLocaleString().padStart(8)} req`,
    );
  console.log();
};

roll((r) => `${r.agent} · ${r.model} · ${r.effort}`, "agent × model × effort");
roll((r) => `${r.model} · ${r.effort}`, "model × effort");
roll((r) => r.model, "model");
roll((r) => r.agent, "agent");

// Same cut for the main thread, for contrast.
const main = res.rows.filter((r) => r.lane === "main");
const mg = new Map();
for (const r of main) {
  const k = `${r.src} · ${r.model} · ${r.effort}`;
  mg.set(k, (mg.get(k) ?? 0) + rowTotal(r));
}
const mtot = main.reduce((s, r) => s + rowTotal(r), 0);
console.log("=== MAIN THREAD model × effort (for contrast) ===");
for (const [k, v] of [...mg].sort((a, b) => b[1] - a[1]).slice(0, 10))
  console.log(`  ${k.padEnd(46)} ${fmt(v).padStart(8)}  ${((v / mtot) * 100).toFixed(1).padStart(5)}%`);
