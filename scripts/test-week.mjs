/** Verifies weeks bucket Saturday → Friday. Run: node --experimental-strip-types scripts/test-week.mjs */
import { weekStart, addDays, weekLabel, dayKey } from "../lib/agg.ts";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
let fail = 0;

// Every day of a known week must map to Saturday 1 Aug 2026.
const expected = "2026-08-01"; // a Saturday
for (let i = 0; i < 7; i++) {
  const d = addDays(new Date(2026, 7, 1), i); // 1..7 Aug
  const ws = dayKey(weekStart(d));
  const ok = ws === expected;
  if (!ok) fail++;
  console.log(
    `${dayKey(d)} (${DOW[d.getDay()]}) -> week of ${ws}  ${ok ? "ok" : "FAIL expected " + expected}`,
  );
}

// The day before that week must roll back to the previous Saturday.
const fri = new Date(2026, 6, 31); // Fri 31 Jul
const prev = dayKey(weekStart(fri));
const okPrev = prev === "2026-07-25";
if (!okPrev) fail++;
console.log(`\n${dayKey(fri)} (Fri) -> week of ${prev} ${okPrev ? "ok" : "FAIL"}`);

// weekStart must be idempotent and always land on a Saturday.
for (let i = 0; i < 400; i++) {
  const d = addDays(new Date(2026, 0, 1), i);
  const ws = weekStart(d);
  if (ws.getDay() !== 6) {
    console.log(`FAIL: ${dayKey(d)} -> ${dayKey(ws)} is ${DOW[ws.getDay()]}, not Sat`);
    fail++;
  }
  if (dayKey(weekStart(ws)) !== dayKey(ws)) {
    console.log(`FAIL: not idempotent at ${dayKey(ws)}`);
    fail++;
  }
}

console.log(`\nlabel sample: "${weekLabel(weekStart(new Date(2026, 7, 7)))}"`);
console.log(fail === 0 ? "\nALL WEEK TESTS PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
