/**
 * Corrected: a model switch does not add cache WRITES, it collapses cache
 * READS — the conversation gets re-sent as full-price fresh input for one turn.
 * Also measures how a turn's cost grows as the conversation gets longer.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";

const RATES = {
  "gpt-5.6-sol":  { in: 5.0, cached: 0.5,  out: 30.0 },
  "gpt-5.6-luna": { in: 0.2, cached: 0.02, out: 1.2 },
};
const cost = (t, r) => r ? (t.fresh*r.in + t.cached*r.cached + t.write*r.in*1.25 + t.out*r.out)/1e6 : 0;
const med = (a) => { if(!a.length) return 0; const s=[...a].sort((x,y)=>x-y); const m=s.length>>1;
  return s.length%2 ? s[m] : (s[m-1]+s[m])/2; };

const DIR = path.join(os.homedir(), ".codex", "sessions");
const files = fs.readdirSync(DIR, { recursive: true, encoding:"utf8" })
  .filter(f=>f.endsWith(".jsonl")).map(f=>path.join(DIR,f));

const sw = [], norm = [];
const byDepth = new Map(); // conversation position -> costs (Sol only, like-for-like)

for (const fp of files) {
  let rl; try { rl = readline.createInterface({ input: fs.createReadStream(fp), crlfDelay: Infinity }); } catch { continue; }
  let model=null, justSwitched=false, idx=0;
  let pIn=0,pCached=0,pWrite=0,pOut=0;
  for await (const line of rl) {
    if (line.indexOf('"token_count"')<0 && line.indexOf('"turn_context"')<0) continue;
    let d; try { d=JSON.parse(line); } catch { continue; }
    const p=d?.payload; if(!p||typeof p!=="object") continue;
    if (d.type==="turn_context") {
      if (typeof p.model==="string") { if (model && p.model!==model) justSwitched=true; model=p.model; }
      continue;
    }
    if (p.type!=="token_count") continue;
    const tot=p.info?.total_token_usage; if(!tot) continue;
    const cIn=tot.input_tokens||0,cCached=tot.cached_input_tokens||0,
          cWrite=tot.cache_write_input_tokens||0,cOut=tot.output_tokens||0;
    const reset=cIn<pIn||cOut<pOut;
    const t={ fresh:Math.max(0,(reset?cIn:cIn-pIn)-Math.max(0,reset?cCached:cCached-pCached)),
              cached:Math.max(0,reset?cCached:cCached-pCached),
              write:Math.max(0,reset?cWrite:cWrite-pWrite),
              out:Math.max(0,reset?cOut:cOut-pOut) };
    pIn=cIn;pCached=cCached;pWrite=cWrite;pOut=cOut;
    if (t.fresh+t.cached+t.out<=0) continue;
    idx++;
    const rec={...t, model, usd:cost(t,RATES[model])};
    if (justSwitched){ sw.push(rec); justSwitched=false; } else norm.push(rec);
    if (model==="gpt-5.6-sol"){
      const band = idx<=10?"turns 1-10":idx<=50?"turns 11-50":idx<=150?"turns 51-150":"turns 150+";
      if(!byDepth.has(band)) byDepth.set(band,[]);
      byDepth.get(band).push(rec);
    }
  }
}

console.log("="+"=".repeat(72));
console.log("WHAT A MID-CHAT MODEL SWITCH REALLY COSTS");
console.log("="+"=".repeat(72));
for (const m of ["gpt-5.6-sol","gpt-5.6-luna"]) {
  const S=sw.filter(r=>r.model===m), N=norm.filter(r=>r.model===m);
  if (S.length<10||N.length<100) continue;
  const swFresh=med(S.map(r=>r.fresh)), nmFresh=med(N.map(r=>r.fresh));
  const swUsd=med(S.map(r=>r.usd)), nmUsd=med(N.map(r=>r.usd));
  console.log(`\n${m}   (${S.length} switches observed)`);
  console.log(`   full-price fresh tokens, ordinary turn : ${Math.round(nmFresh).toLocaleString()}`);
  console.log(`   full-price fresh tokens, switch turn   : ${Math.round(swFresh).toLocaleString()}`);
  console.log(`   typical cost, ordinary turn            : $${nmUsd.toFixed(4)}`);
  console.log(`   typical cost, switch turn              : $${swUsd.toFixed(4)}`);
  console.log(`   => a switch costs about ${(swUsd/nmUsd).toFixed(1)}x one ordinary turn (one-off, ~$${(swUsd-nmUsd).toFixed(3)} extra)`);
}

console.log("\n"+"=".repeat(73));
console.log("HOW COST GROWS AS ONE CONVERSATION GETS LONGER  (Sol)");
console.log("="+"=".repeat(72));
console.log(`${"position in chat".padEnd(18)}${"turns".padStart(9)}${"tokens/turn".padStart(14)}${"$/turn".padStart(11)}${"vs first 10".padStart(13)}`);
const base = byDepth.get("turns 1-10");
const baseUsd = base ? med(base.map(r=>r.usd)) : 0;
for (const band of ["turns 1-10","turns 11-50","turns 51-150","turns 150+"]) {
  const a=byDepth.get(band); if(!a||a.length<50) continue;
  const u=med(a.map(r=>r.usd)), tk=med(a.map(r=>r.fresh+r.cached+r.write+r.out));
  console.log(`${band.padEnd(18)}${a.length.toLocaleString().padStart(9)}${Math.round(tk).toLocaleString().padStart(14)}${("$"+u.toFixed(4)).padStart(11)}${((u/baseUsd).toFixed(1)+"x").padStart(13)}`);
}
