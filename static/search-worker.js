/* Own the large catalog in this worker so decoding, parsing, and filtering stay off the UI thread. */
const R={A:0,B:1,A0:2,A1:3,B0:4,B1:5,PAIRED:6,GAPS:7,SIM:8,EVIDENCE:9,TA:10,TB:11,VA:12,VB:13};
let solos,rows,floor,shardSize;
const filteredCache=new Map();

async function loadIndex(){
  const marks={start:performance.timeOrigin+performance.now()};
  const url=new URL('catalog/index.json.gz',self.location.href);
  const res=await fetch(url);
  if(!res.ok)throw new Error(`Could not load ${url.pathname}`);
  marks.response=performance.timeOrigin+performance.now();
  const bytes=new Uint8Array(await res.arrayBuffer());
  marks.bytes=performance.timeOrigin+performance.now();
  let text;
  if(bytes[0]===0x1f&&bytes[1]===0x8b){
    if(!('DecompressionStream' in self))throw new Error('This browser cannot unpack the archive data.');
    text=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  }else text=new TextDecoder().decode(bytes);
  marks.unpacked=performance.timeOrigin+performance.now();
  const data=JSON.parse(text);
  marks.parsed=performance.timeOrigin+performance.now();
  solos=data.solos;rows=data.rows;floor=data.floor;shardSize=data.shard_size;
  return {marks,bytes:bytes.byteLength,textBytes:text.length};
}
function solo(row,side){return solos[row[side==='a'?R.A:R.B]]}
function recording(s,second){
  if(!s.video_id||(second===null&&s.video_kind!=='candidate'))return null;
  const timed=second!==null&&second!==undefined;
  return {url:`https://www.youtube.com/watch?v=${encodeURIComponent(s.video_id)}${timed?`&t=${second}s`:''}`,
    time_seconds:timed?second:null,verified:s.video_kind==='verified',aligned:s.video_kind==='aligned',
    estimated:s.video_kind==='estimated',source_url:s.video_source_url,title:s.video_title,channel:s.video_channel,
    verified_by:s.video_verifier,evidence:s.video_evidence};
}
function item(id){
  const r=rows[id],a=solo(r,'a'),b=solo(r,'b');
  return {id,pair_key:[r[R.A],r[R.A0],r[R.B],r[R.B0]].join('.'),a,b,notes:r[R.PAIRED],gaps:r[R.GAPS],
    similarity:r[R.SIM],evidence:r[R.EVIDENCE],a_track_time:r[R.TA],b_track_time:r[R.TB],
    recording_a:recording(a,r[R.VA]),recording_b:recording(b,r[R.VB]),
    same_performer:a.performer.toLowerCase()===b.performer.toLowerCase(),
    same_composition:a.composition_id===b.composition_id,same_track:a.trackid===b.trackid};
}
function base(row,p){
  if(row[R.PAIRED]<p.min_notes||row[R.SIM]<p.min_similarity)return false;
  const a=solo(row,'a'),b=solo(row,'b');
  if(a.composition_id===b.composition_id)return false;
  return !p.performer||a.performer.toLowerCase().includes(p.performer.toLowerCase())||b.performer.toLowerCase().includes(p.performer.toLowerCase());
}
function flags(row,p){
  const a=solo(row,'a'),b=solo(row,'b');
  return [!p.decade||Math.floor(a.year/10)*10===Number(p.decade)||Math.floor(b.year/10)*10===Number(p.decade),
    !p.instrument||a.instrument.toLowerCase()===p.instrument.toLowerCase()||b.instrument.toLowerCase()===p.instrument.toLowerCase()];
}
function filtered(p){
  const ids=[];
  for(let id=0;id<rows.length;id++)if(base(rows[id],p)&&flags(rows[id],p).every(Boolean))ids.push(id);
  if(p.sort==='length')ids.sort((x,y)=>rows[y][R.PAIRED]-rows[x][R.PAIRED]||rows[y][R.EVIDENCE]-rows[x][R.EVIDENCE]);
  else if(p.sort==='similarity')ids.sort((x,y)=>rows[y][R.SIM]-rows[x][R.SIM]||rows[y][R.EVIDENCE]-rows[x][R.EVIDENCE]);
  return ids;
}
function search(p){
  const {offset=0,limit=50,...filters}=p;
  const key=JSON.stringify(filters);
  if(!filteredCache.has(key)){
    filteredCache.set(key,filtered(filters));
    if(filteredCache.size>3)filteredCache.delete(filteredCache.keys().next().value);
  }else{
    const cached=filteredCache.get(key);filteredCache.delete(key);filteredCache.set(key,cached);
  }
  const ids=filteredCache.get(key);
  return {total:ids.length,items:ids.slice(offset,offset+limit).map(item)};
}
function facets(p){
  const counts={decade:new Map(),instrument:new Map(),performer:new Map()};
  const add=(map,values)=>{for(const v of values)if(v!==null&&v!==undefined&&v!=='')map.set(v,(map.get(v)||0)+1)};
  for(const row of rows){
    if(!base(row,p))continue;
    const [fd,fi]=flags(row,p),a=solo(row,'a'),b=solo(row,'b');
    if(fi)add(counts.decade,new Set([a.year&&Math.floor(a.year/10)*10,b.year&&Math.floor(b.year/10)*10].filter(Boolean)));
    if(fd)add(counts.instrument,new Set([a.instrument,b.instrument].filter(Boolean)));
    if(fd&&fi)add(counts.performer,new Set([a.performer,b.performer]));
  }
  return {decade:[...counts.decade].sort((a,b)=>a[0]-b[0]),
    instrument:[...counts.instrument].sort((a,b)=>b[1]-a[1]),performer:[...counts.performer].sort((a,b)=>b[1]-a[1])};
}
function influence(p){
  const byName=new Map();for(const s of Object.values(solos)){
    if(!byName.has(s.performer))byName.set(s.performer,[]);byName.get(s.performer).push(s);
  }
  const links=new Map();let undirected=0;
  for(let id=0;id<rows.length;id++){
    const r=rows[id];if(!base(r,p)||!flags(r,p).every(Boolean))continue;
    const a=solo(r,'a'),b=solo(r,'b');if(a.performer===b.performer)continue;
    if(!a.year||!b.year||a.year===b.year){undirected++;continue}
    const [old,young]=a.year<b.year?[a,b]:[b,a],key=`${old.performer}\0${young.performer}`;
    if(!links.has(key))links.set(key,{from:old.performer,to:young.performer,from_year:old.year,to_year:young.year,pairs:new Set(),top_id:id,best_score:r[R.EVIDENCE]});
    const link=links.get(key);link.pairs.add(`${old.melid}:${young.melid}`);
    if(r[R.EVIDENCE]>link.best_score){link.top_id=id;link.best_score=r[R.EVIDENCE];link.from_year=old.year;link.to_year=young.year}
  }
  const names=[...new Set([...links.values()].flatMap(l=>[l.from,l.to]))].sort(),index=new Map(names.map((n,i)=>[n,i]));
  const musicians=names.map(name=>{const list=byName.get(name),years=list.map(s=>s.year).filter(Boolean).sort((a,b)=>a-b),first=list[0];
    return {name,year:years.length?years[Math.floor(years.length/2)]:null,solos:list.length,album:first.album,title:first.title}});
  return {musicians,links:[...links.values()].map(l=>({from:index.get(l.from),to:index.get(l.to),pairs:l.pairs.size,
    strength:l.pairs.size/Math.sqrt(byName.get(l.from).length*byName.get(l.to).length),top_id:l.top_id,best_score:l.best_score,
    from_year:l.from_year,to_year:l.to_year})),undirected};
}
function pairKey(id){const r=rows[id];return r?[r[R.A],r[R.A0],r[R.B],r[R.B0]].join('.'):null}
function findPairKey(key){
  if(!/^\d+\.\d+\.\d+\.\d+$/.test(key||''))return null;
  const [a,a0,b,b0]=key.split('.').map(Number);
  const id=rows.findIndex(r=>(r[R.A]===a&&r[R.A0]===a0&&r[R.B]===b&&r[R.B0]===b0)||
    (r[R.A]===b&&r[R.A0]===b0&&r[R.B]===a&&r[R.B0]===a0));
  return id<0?null:id;
}

let loadError,loadMetrics;
const ready=loadIndex().then(result=>{loadMetrics=result}).catch(error=>{loadError=error});
self.addEventListener('message',async event=>{
  const {id,type,parameters={}}=event.data;
  try{
    await ready;if(loadError)throw loadError;
    const value=type==='ready'?{...loadMetrics,ready:performance.timeOrigin+performance.now()}:type==='filtered'?search(parameters):type==='facets'?facets(parameters):
      type==='influence'?influence(parameters):type==='pairKey'?pairKey(parameters.id):
      type==='findPairKey'?findPairKey(parameters.key):type==='pair'?{row:rows[parameters.id],item:rows[parameters.id]?item(parameters.id):null,shardSize}:
      (()=>{throw new Error(`Unknown search operation: ${type}`)})();
    self.postMessage({id,value});
  }catch(error){self.postMessage({id,error:error.message||String(error)})}
});
