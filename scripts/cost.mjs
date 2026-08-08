import { scan } from "../lib/scan.ts";

// Published API rates, USD per million tokens (aipricing.guru, Aug 2026).
// Cache writes bill at 1.25x standard input across the GPT-5.6 tiers.
const RATES = {
  "gpt-5.6-sol":   { in: 5.0,  cached: 0.5,  out: 30.0 },
  "gpt-5.6-terra": { in: 2.0,  cached: 0.2,  out: 12.0 },
  "gpt-5.6-luna":  { in: 0.2,  cached: 0.02, out: 1.2 },
};

const cost = (r, rate) =>
  (r.input * rate.in +
    r.cacheRead * rate.cached +
    r.cacheWrite * rate.in * 1.25 +
    r.output * rate.out) / 1e6;

const res = await scan(false);
const usd = (n) => "$" + n.toLocaleString(undefined, { maximumFractionDigits: 2 });
const n = (x) => Math.round(x).toLocaleString();

// --- real spend by model, whole dataset -----------------------------
const per = new Map();
for (const r of res.rows) {
  const rate = RATES[r.model];
  if (!rate) continue;
  const c = per.get(r.model) ?? { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, turns: 0, usd: 0 };
  c.input += r.input; c.cacheRead += r.cacheRead; c.cacheWrite += r.cacheWrite;
  c.output += r.output; c.turns += r.turns; c.usd += cost(r, rate);
  per.set(r.model, c);
}

console.log("ACTUAL API-EQUIVALENT COST OF YOUR REAL USAGE\n");
console.log(`${"model".padEnd(16)}${"tokens".padStart(15)}${"requests".padStart(10)}${"cost".padStart(13)}${"$/request".padStart(12)}`);
for (const [m, c] of [...per].sort((a, b) => b[1].usd - a[1].usd)) {
  const tok = c.input + c.cacheRead + c.cacheWrite + c.output;
  console.log(`${m.padEnd(16)}${n(tok).padStart(15)}${n(c.turns).padStart(10)}${usd(c.usd).padStart(13)}${("$" + (c.usd / c.turns).toFixed(4)).padStart(12)}`);
}

// --- like-for-like: one identical request on each model --------------
const sol = per.get("gpt-5.6-sol");
const luna = per.get("gpt-5.6-luna");
if (sol && luna) {
  const avg = (c) => ({
    input: c.input / c.turns, cacheRead: c.cacheRead / c.turns,
    cacheWrite: c.cacheWrite / c.turns, output: c.output / c.turns,
  });
  const aSol = avg(sol), aLuna = avg(luna);
  const solOnSol = cost(aSol, RATES["gpt-5.6-sol"]);
  const solOnLuna = cost(aSol, RATES["gpt-5.6-luna"]);
  const lunaOnLuna = cost(aLuna, RATES["gpt-5.6-luna"]);

  console.log("\n\nSAME AVERAGE REQUEST, PRICED ON EACH MODEL");
  console.log(`  your average Sol request, on Sol   ${usd(solOnSol)}`);
  console.log(`  the exact same request, on Luna    ${usd(solOnLuna)}   (${(100 - (solOnLuna / solOnSol) * 100).toFixed(1)}% cheaper)`);
  console.log(`  your average Luna request, on Luna ${usd(lunaOnLuna)}`);
  console.log(`\n  tokens per request:  Sol ${n(Object.values(aSol).reduce((a, b) => a + b))}  vs  Luna ${n(Object.values(aLuna).reduce((a, b) => a + b))}`);
  console.log(`  cost per request:    Sol ${usd(solOnSol)}  vs  Luna ${usd(lunaOnLuna)}  ->  Luna is ${(solOnSol / lunaOnLuna).toFixed(1)}x cheaper`);
  console.log(`\n  HOW MANY parallel Luna helpers equal one Sol helper?  ${(solOnSol / lunaOnLuna).toFixed(1)}`);
}

// --- what the subagent burn would have cost on Luna -------------------
const subSol = res.rows.filter((r) => r.model === "gpt-5.6-sol" && (r.lane === "subagent" || r.lane === "auto-review"));
if (subSol.length) {
  const actual = subSol.reduce((s, r) => s + cost(r, RATES["gpt-5.6-sol"]), 0);
  const onLuna = subSol.reduce((s, r) => s + cost(r, RATES["gpt-5.6-luna"]), 0);
  console.log(`\n\nYOUR SOL SUBAGENT BURN`);
  console.log(`  actually cost (on Sol)      ${usd(actual)}`);
  console.log(`  would have cost (on Luna)   ${usd(onLuna)}`);
  console.log(`  overspend                   ${usd(actual - onLuna)}`);
}
