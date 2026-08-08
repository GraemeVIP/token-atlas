/**
 * Should you start a fresh conversation per task?
 * Uses your real per-turn costs by conversation position to price the same
 * 30-turn job done (a) in a fresh chat vs (b) appended to an already-long one.
 * Also measures how often Codex auto-compacts, which caps runaway growth.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";

const RATES = { "gpt-5.6-sol": { in:5.0, cached:0.5, out:30.0 } };
const cost = (t,r)=> (t.fresh*r.in + t.cached*r.cached + t.write*r.in*1.25 + t.out*r.out)/1e6;

const DIR = path.join(os.homedir(), ".codex", "sessions");
const files = fs.readdirSync(DIR,{recursive:true,encoding:"utf8"})
  .filter(f=>f.endsWith(".jsonl")).map(f=>path.join(DIR,f));

const perTurn = new Map();  // exact turn index -> [costs]  (Sol only)
let compactions = 0, sessionsWithTurns = 0, totalTurns = 0;

for (const fp of files) {
  let rl; try { rl = readline.createInterface({input:fs.createReadStream(fp),crlfDelay:Infinity}); } catch { continue; }
  let model=null, idx=0, pIn=0,pC=0,pW=0,pO=0, sawTurn=false;
  for await (const line of rl) {
    if (line.indexOf('"token_count"')<0 && line.indexOf('"turn_context"')<0 && line.indexOf('"context_compacted"')<0) continue;
    let d; try{ d=JSON.parse(line);}catch{continue}
    const p=d?.payload; if(!p||typeof p!=="object") continue;
    if (p.type==="context_compacted"){ compactions++; continue; }
    if (d.type==="turn_context"){ if(typeof p.model==="string") model=p.model; continue; }
    if (p.type!=="token_count") continue;
    const tot=p.info?.total_token_usage; if(!tot) continue;
    const cIn=tot.input_tokens||0,cC=tot.cached_input_tokens||0,cW=tot.cache_write_input_tokens||0,cO=tot.output_tokens||0;
    const reset=cIn<pIn||cO<pO;
    const t={ fresh:Math.max(0,(reset?cIn:cIn-pIn)-Math.max(0,reset?cC:cC-pC)),
              cached:Math.max(0,reset?cC:cC-pC), write:Math.max(0,reset?cW:cW-pW), out:Math.max(0,reset?cO:cO-pO) };
    pIn=cIn;pC=cC;pW=cW;pO=cO;
    if (t.fresh+t.cached+t.out<=0) continue;
    idx++; totalTurns++; sawTurn=true;
    if (model==="gpt-5.6-sol"){
      if(!perTurn.has(idx)) perTurn.set(idx,[]);
      perTurn.get(idx).push(cost(t,RATES[model]));
    }
  }
  if (sawTurn) sessionsWithTurns++;
}

const med=(a)=>{ if(!a.length) return 0; const s=[...a].sort((x,y)=>x-y); const m=s.length>>1;
  return s.length%2? s[m] : (s[m-1]+s[m])/2; };

// median cost of the Nth turn of a conversation
const at = (n) => { const a=perTurn.get(n); return a && a.length>=20 ? med(a) : null; };

const JOB = 30; // a realistic "add a blog section" job
let fresh = 0, freshOk = true;
for (let i=1;i<=JOB;i++){ const c=at(i); if(c===null){freshOk=false;break;} fresh+=c; }

// same job appended at various depths
const depths=[50,100,200,400];
console.log("=".repeat(70));
console.log(`COST OF A ${JOB}-STEP JOB (Sol), FRESH CHAT vs CONTINUING A LONG ONE`);
console.log("=".repeat(70));
if (freshOk) console.log(`  in a BRAND NEW conversation           $${fresh.toFixed(2)}`);
for (const d of depths){
  let s=0, ok=true;
  for(let i=d;i<d+JOB;i++){ const c=at(i); if(c===null){ok=false;break;} s+=c; }
  if(ok) console.log(`  appended at step ${String(d).padEnd(4)} of a long chat   $${s.toFixed(2)}   (${(s/fresh).toFixed(2)}x the fresh cost)`);
}

console.log("\n" + "=".repeat(70));
console.log("DOES A LONG CHAT GROW FOREVER?");
console.log("=".repeat(70));
console.log(`  auto-compaction events in your logs : ${compactions.toLocaleString()}`);
console.log(`  sessions with any turns             : ${sessionsWithTurns.toLocaleString()}`);
console.log(`  total turns                         : ${totalTurns.toLocaleString()}`);
console.log(`  => roughly one compaction every ${Math.round(totalTurns/Math.max(1,compactions)).toLocaleString()} turns`);
for (const n of [10,50,100,200,400,800]){
  const c=at(n); if(c!==null) console.log(`  cost of turn #${String(n).padEnd(4)}: $${c.toFixed(4)}`);
}
