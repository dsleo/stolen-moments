import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {performance} from 'node:perf_hooks';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {searchCorpus,selectCandidates} from '../static/listen/retrieval.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const catalog=path.join(root,'static/catalog/listen');
const manifest=JSON.parse(await readFile(path.join(catalog,'manifest.json'),'utf8'));
const solos=[];
for(const shard of manifest.shards){
  const data=JSON.parse(gunzipSync(await readFile(path.join(catalog,shard.path))));
  solos.push(...data.solos);
}
const count=Number((process.argv.find(arg=>arg.startsWith('--count='))||'--count=12').split('=')[1]);
if(!Number.isSafeInteger(count)||count<1||count>60)throw new Error('Use --count=1..60');
const chosen=solos.filter(s=>s.pitches.length>=40).filter((_,i)=>i%7===0).slice(0,count);
if(chosen.length<count)throw new Error('Not enough solos for benchmark');
let seed=20261027;
const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/2**32};
const cases=[];
for(const solo of chosen){
  const start=Math.floor((solo.pitches.length-24)*.33),n=20,first=solo.onsetsSeconds[start];
  const base=Array.from({length:n},(_,i)=>({pitch:solo.pitches[start+i],onsetSeconds:solo.onsetsSeconds[start+i]-first,durationSeconds:solo.durationsSeconds[start+i],confidence:null}));
  const add=(variant,notes,expected=true)=>cases.push({soloId:solo.id,start,n,variant,notes,expected});
  add('clean',base);
  add('transposed+7',base.map(x=>({...x,pitch:Math.min(127,x.pitch+7)})));
  add('tempo×1.25',base.map(x=>({...x,onsetSeconds:x.onsetSeconds*1.25,durationSeconds:x.durationSeconds*1.25})));
  add('one-deleted',base.filter((_,i)=>i!==9));
  add('one-pitch-error',base.map((x,i)=>i===9?{...x,pitch:x.pitch+1}:x));
}
for(let i=0;i<Math.min(20,count);i++){
  const notes=Array.from({length:20},(_,j)=>({pitch:48+Math.floor(random()*36),onsetSeconds:j*.33,durationSeconds:.22,confidence:null}));
  cases.push({soloId:null,start:null,n:20,variant:'random-negative',notes,expected:false});
}
const results=[];
for(const item of cases){
  const duration=Math.max(...item.notes.map(n=>n.onsetSeconds+n.durationSeconds))+.1;
  const query={schemaVersion:1,requestId:results.length,source:'example',audioDurationSeconds:duration,notes:item.notes};
  const t0=performance.now();
  const candidates=selectCandidates(query,solos);
  const result=searchCorpus(query,solos);
  const milliseconds=performance.now()-t0;
  const candidateHit=item.expected&&candidates.some(c=>c.soloId===item.soloId&&
    Math.max(0,Math.min(c.endNote,item.start+item.n-1)-Math.max(c.startNote,item.start)+1)/
    Math.min(c.endNote-c.startNote+1,item.n)>=.5);
  const hit=item.expected&&result.results.some(r=>r.soloId===item.soloId&&
    Math.max(0,Math.min(r.endNote,item.start+item.n-1)-Math.max(r.startNote,item.start)+1)/
    Math.min(r.endNote-r.startNote+1,item.n)>=.5);
  results.push({soloId:item.soloId,start:item.start,variant:item.variant,expected:item.expected,
    candidateHit:!!candidateHit,hit:!!hit,returned:result.results.length,
    topScore:result.results[0]?.score??null,milliseconds:Math.round(milliseconds)});
}
const byVariant={};
for(const row of results){const stat=byVariant[row.variant]??={count:0,hits:0,candidateHits:0,falsePositives:0};stat.count++;stat.hits+=Number(row.hit);stat.candidateHits+=Number(row.candidateHit);stat.falsePositives+=Number(!row.expected&&row.returned>0)}
const times=results.map(r=>r.milliseconds).sort((a,b)=>a-b);
const summary={kind:'symbolic-pilot',sourceSha256:manifest.sourceSha256,algorithmVersion:manifest.algorithmVersion,
  node:process.version,platform:`${process.platform}/${process.arch}`,count:results.length,byVariant,
  timingMs:{median:times[Math.floor(times.length/2)],p95:times[Math.ceil(times.length*.95)-1],max:times.at(-1)},
  limitations:['Synthetic symbolic queries only; not held-out instrument recordings.','This pilot does not satisfy real-audio accuracy or physical microphone gates.']};
const output=path.join(root,'docs/listen');await mkdir(output,{recursive:true});
await writeFile(path.join(output,'benchmark.json'),JSON.stringify({summary,results},null,2)+'\n');
const lines=['# Listen search symbolic pilot','',`Source SHA-256: ${summary.sourceSha256}`,
  `Algorithm: ${summary.algorithmVersion}`,'',
  '| Variant | Hits / cases | Candidate hits | False positives |','| --- | ---: | ---: | ---: |',
  ...Object.entries(byVariant).map(([name,s])=>`| ${name} | ${s.hits}/${s.count} | ${s.candidateHits}/${s.count} | ${s.falsePositives} |`),
  '',`Median ${summary.timingMs.median} ms; p95 ${summary.timingMs.p95} ms; max ${summary.timingMs.max} ms on ${summary.platform}.`,
  '',...summary.limitations.map(x=>`- ${x}`),''];
await writeFile(path.join(output,'benchmark.md'),lines.join('\n'));
console.log(`Benchmarked ${results.length} symbolic cases; wrote docs/listen/benchmark.json and benchmark.md`);
