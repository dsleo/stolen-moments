/* Keep full-catalog filtering and graph aggregation off the browser's UI thread. */
const R={A:0,B:1,PAIRED:6,SIM:8,EVIDENCE:9};
let solos,rows;

function solo(row,side){return solos[row[side==='a'?R.A:R.B]]}
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
    instrument:[...counts.instrument].sort((a,b)=>b[1]-a[1]),
    performer:[...counts.performer].sort((a,b)=>b[1]-a[1])};
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
    if(!links.has(key))links.set(key,{from:old.performer,to:young.performer,pairs:new Set(),top_id:id,best_score:r[R.EVIDENCE]});
    const link=links.get(key);link.pairs.add(`${old.melid}:${young.melid}`);
    if(r[R.EVIDENCE]>link.best_score){link.top_id=id;link.best_score=r[R.EVIDENCE]}
  }
  const names=[...new Set([...links.values()].flatMap(l=>[l.from,l.to]))].sort(),index=new Map(names.map((n,i)=>[n,i]));
  const musicians=names.map(name=>{const list=byName.get(name),years=list.map(s=>s.year).filter(Boolean).sort((a,b)=>a-b),first=list[0];
    return {name,year:years.length?years[Math.floor(years.length/2)]:null,solos:list.length,album:first.album,title:first.title}});
  return {musicians,links:[...links.values()].map(l=>({from:index.get(l.from),to:index.get(l.to),pairs:l.pairs.size,
    strength:l.pairs.size/Math.sqrt(byName.get(l.from).length*byName.get(l.to).length),top_id:l.top_id,best_score:l.best_score})),undirected};
}

self.addEventListener('message',event=>{
  const message=event.data;
  if(message.type==='init'){solos=message.solos;rows=message.rows;return}
  try{
    const fn={filtered,facets,influence}[message.type];
    if(!fn)throw new Error(`Unknown search operation: ${message.type}`);
    self.postMessage({id:message.id,value:fn(message.parameters)});
  }catch(error){self.postMessage({id:message.id,error:error.message||String(error)})}
});
