// Read-only search catalog. Every query runs over the precomputed joint matches.
(function(){
  const R={A:0,B:1,A0:2,A1:3,B0:4,B1:5,PAIRED:6,GAPS:7,SIM:8,EVIDENCE:9,TA:10,TB:11,VA:12,VB:13};
  const perfEnabled=()=>new URLSearchParams(location.search).has('perf');
  const perfMark=name=>{if(perfEnabled())performance.mark(`sm:${name}`)};
  const perfMeasure=(name,start,end)=>{if(perfEnabled())try{performance.measure(`sm:${name}`,`sm:${start}`,`sm:${end}`)}catch{}};
  async function readGzip(path){
    const isIndex=path==='catalog/index.json.gz';
    if(isIndex)perfMark('index-start');
    const res=await fetch(path);
    if(!res.ok)throw new Error(`Could not load ${path}`);
    if(isIndex){perfMark('index-response');perfMeasure('index-fetch','index-start','index-response')}
    const bytes=new Uint8Array(await res.arrayBuffer());
    if(isIndex){perfMark('index-bytes');performance.mark('sm:index-byte-count',{detail:{bytes:bytes.byteLength}})}
    // A host that sends Content-Encoding: gzip lets the browser unpack the file already.
    let jsonText;
    if(bytes[0]!==0x1f||bytes[1]!==0x8b)jsonText=new TextDecoder().decode(bytes);
    else{
      if(!('DecompressionStream' in window))throw new Error('This browser cannot unpack the archive data. Try a current version of Safari, Chrome, Firefox, or Edge.');
      jsonText=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    }
    if(isIndex){perfMark('index-unpacked');perfMeasure('index-unpack','index-bytes','index-unpacked')}
    const data=JSON.parse(jsonText);
    if(isIndex){perfMark('index-parsed');perfMeasure('index-json-parse','index-unpacked','index-parsed')}
    return data;
  }
  class Catalog{
    constructor(data=null,worker=null){
      this.solos=data?.solos;this.rows=data?.rows;this.floor=data?.floor;this.shardSize=data?.shard_size;
      this.shards=new Map();this.notes=new Map();
      this.performers=data?[...new Set(Object.values(this.solos).map(s=>s.performer))].sort():[];
      this.visibleTotal=data?this.rows.reduce((n,r)=>n+(this.solos[r[R.A]].composition_id!==this.solos[r[R.B]].composition_id),0):0;
      this.searchWorker=worker;this.searchSerial=0;this.searchPending=new Map();
      if(worker)this.bindWorker(worker);
    }
    bindWorker(worker){
      worker.addEventListener('message',event=>{
        const pending=this.searchPending.get(event.data.id);if(!pending)return;
        this.searchPending.delete(event.data.id);
        event.data.error?pending.reject(new Error(event.data.error)):pending.resolve(event.data.value);
      });
      worker.addEventListener('error',()=>{
        for(const pending of this.searchPending.values())pending.reject(new Error('Background search stopped'));
        this.searchPending.clear();this.searchWorker?.terminate();this.searchWorker=null;
      });
    }
    async query(type,parameters={}){
      if(!this.searchWorker)return this[`${type}OnMainThread`](parameters);
      const id=++this.searchSerial;
      return new Promise((resolve,reject)=>{
        this.searchPending.set(id,{resolve,reject});
        this.searchWorker.postMessage({id,type,parameters});
      });
    }
    solo(row,side){return this.solos[row[side==='a'?R.A:R.B]]}
    link(s,second){
      if(!s.video_id||(second===null&&s.video_kind!=='candidate'))return null;
      const timed=second!==null&&second!==undefined;
      return {url:`https://www.youtube.com/watch?v=${encodeURIComponent(s.video_id)}${timed?`&t=${second}s`:''}`,
        time_seconds:timed?second:null,verified:s.video_kind==='verified',aligned:s.video_kind==='aligned',
        estimated:s.video_kind==='estimated',source_url:s.video_source_url,
        title:s.video_title,channel:s.video_channel,verified_by:s.video_verifier,evidence:s.video_evidence};
    }
    item(id){
      const r=this.rows[id],a=this.solo(r,'a'),b=this.solo(r,'b');
      return {id,a,b,notes:r[R.PAIRED],gaps:r[R.GAPS],similarity:r[R.SIM],evidence:r[R.EVIDENCE],
        a_track_time:r[R.TA],b_track_time:r[R.TB],
        recording_a:this.link(a,r[R.VA]),recording_b:this.link(b,r[R.VB]),
        same_performer:a.performer.toLowerCase()===b.performer.toLowerCase(),
        same_composition:a.composition_id===b.composition_id,same_track:a.trackid===b.trackid};
    }
    pairKey(id){
      if(this.searchWorker)return this.query('pairKey',{id});
      const r=this.rows[id];
      return r?[r[R.A],r[R.A0],r[R.B],r[R.B0]].join('.'):null;
    }
    findPairKey(key){
      if(this.searchWorker)return this.query('findPairKey',{key});
      if(!/^\d+\.\d+\.\d+\.\d+$/.test(key||''))return null;
      const [a,a0,b,b0]=key.split('.').map(Number);
      const id=this.rows.findIndex(r=>(r[R.A]===a&&r[R.A0]===a0&&r[R.B]===b&&r[R.B0]===b0)||
        (r[R.A]===b&&r[R.A0]===b0&&r[R.B]===a&&r[R.B0]===a0));
      return id<0?null:id;
    }
    base(row,p){
      if(row[R.PAIRED]<p.min_notes||row[R.SIM]<p.min_similarity)return false;
      const a=this.solo(row,'a'),b=this.solo(row,'b');
      if(a.composition_id===b.composition_id)return false;
      return !p.performer||a.performer.toLowerCase().includes(p.performer.toLowerCase())||b.performer.toLowerCase().includes(p.performer.toLowerCase());
    }
    flags(row,p){
      const a=this.solo(row,'a'),b=this.solo(row,'b');
      return [!p.decade||Math.floor(a.year/10)*10===Number(p.decade)||Math.floor(b.year/10)*10===Number(p.decade),
        !p.instrument||a.instrument.toLowerCase()===p.instrument.toLowerCase()||b.instrument.toLowerCase()===p.instrument.toLowerCase()];
    }
    filtered(p,offset=0,limit=50){
      if(this.searchWorker)return this.query('filtered',{...p,offset,limit});
      const ids=this.filteredOnMainThread(p);
      return Promise.resolve({total:ids.length,items:ids.slice(offset,offset+limit).map(id=>this.item(id))});
    }
    filteredOnMainThread(p){
      const ids=[];
      for(let id=0;id<this.rows.length;id++){
        const row=this.rows[id];if(this.base(row,p)&&this.flags(row,p).every(Boolean))ids.push(id);
      }
      if(p.sort==='length')ids.sort((x,y)=>this.rows[y][R.PAIRED]-this.rows[x][R.PAIRED]||this.rows[y][R.EVIDENCE]-this.rows[x][R.EVIDENCE]);
      else if(p.sort==='similarity')ids.sort((x,y)=>this.rows[y][R.SIM]-this.rows[x][R.SIM]||this.rows[y][R.EVIDENCE]-this.rows[x][R.EVIDENCE]);
      // Otherwise evidence order is already stored in the index.
      return ids;
    }
    facets(p){return this.query('facets',p)}
    facetsOnMainThread(p){
      const counts={decade:new Map(),instrument:new Map(),performer:new Map()};
      const add=(map,values)=>{for(const v of values)if(v!==null&&v!==undefined&&v!=='')map.set(v,(map.get(v)||0)+1)};
      for(const row of this.rows){
        if(!this.base(row,p))continue;
        const [fd,fi]=this.flags(row,p),a=this.solo(row,'a'),b=this.solo(row,'b');
        if(fi)add(counts.decade,new Set([a.year&&Math.floor(a.year/10)*10,b.year&&Math.floor(b.year/10)*10].filter(Boolean)));
        if(fd)add(counts.instrument,new Set([a.instrument,b.instrument].filter(Boolean)));
        if(fd&&fi)add(counts.performer,new Set([a.performer,b.performer]));
      }
      return {decade:[...counts.decade].sort((a,b)=>a[0]-b[0]),
        instrument:[...counts.instrument].sort((a,b)=>b[1]-a[1]),
        performer:[...counts.performer].sort((a,b)=>b[1]-a[1])};
    }
    influence(p){return this.query('influence',p)}
    influenceOnMainThread(p){
      const byName=new Map();for(const s of Object.values(this.solos)){
        if(!byName.has(s.performer))byName.set(s.performer,[]);byName.get(s.performer).push(s);
      }
      const links=new Map();let undirected=0;
      for(let id=0;id<this.rows.length;id++){
        const r=this.rows[id];if(!this.base(r,p)||!this.flags(r,p).every(Boolean))continue;
        const a=this.solo(r,'a'),b=this.solo(r,'b');if(a.performer===b.performer)continue;
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
    async detail(id){
      const pair=this.searchWorker?await this.query('pair',{id}):{row:this.rows[id],item:this.item(id),shardSize:this.shardSize};
      const r=pair?.row;if(!r)throw new Error('Passage not found');
      const shard=Math.floor(id/(pair.shardSize||this.shardSize));
      if(!this.shards.has(shard))this.shards.set(shard,readGzip(`catalog/detail/${String(shard).padStart(4,'0')}.json.gz`));
      const [entry,na,nb]=await Promise.all([this.shards.get(shard),this.note(r[R.A]),this.note(r[R.B])]);
      const [transposition,alignment]=entry[id%(pair.shardSize||this.shardSize)];
      const excerpt=(notes,solo,start,end)=>notes.slice(start,end).map((n,i)=>({index:start+i,eventid:n[0],pitch:n[1],onset:n[2],
        track_time:Math.round((solo.solo_start+n[2])*1000)/1000,duration:n[3],beat:n[4],phrase:n[5],chord:n[6]}));
      const item=pair.item;
      return {...item,transposition,alignment,a_notes:excerpt(na,item.a,r[R.A0],r[R.A1]),
        b_notes:excerpt(nb,item.b,r[R.B0],r[R.B1])};
    }
    note(mid){
      if(!this.notes.has(mid))this.notes.set(mid,readGzip(`catalog/notes/${mid}.json.gz`));
      return this.notes.get(mid);
    }
  }
  window.loadCatalog=async()=>{
    if('Worker' in window){
      let worker;
      try{
        worker=new Worker('search-worker.js?v=worker-2');
        const catalog=new Catalog(null,worker);
        const startup=await catalog.query('ready');
        if(perfEnabled()&&startup?.marks){
          const at=stamp=>Math.max(0,stamp-performance.timeOrigin);
          for(const [name,stamp] of Object.entries({
            'worker-index-start':startup.marks.start,'worker-index-response':startup.marks.response,
            'worker-index-bytes':startup.marks.bytes,'worker-index-unpacked':startup.marks.unpacked,
            'worker-index-parsed':startup.marks.parsed,'worker-ready':startup.ready
          }))performance.mark(`sm:${name}`,{startTime:at(stamp)});
          for(const [name,start,end] of [
            ['worker-index-fetch','worker-index-start','worker-index-response'],
            ['worker-index-unpack','worker-index-bytes','worker-index-unpacked'],
            ['worker-index-json-parse','worker-index-unpacked','worker-index-parsed'],
            ['worker-startup','worker-index-start','worker-ready']
          ])try{performance.measure(`sm:${name}`,`sm:${start}`,`sm:${end}`)}catch{}
          window.__catalogStartupMetrics={...startup,marks:undefined};
          console.info(`[Stolen Moments perf] worker index: ${startup.bytes.toLocaleString()} compressed bytes, ${startup.textBytes.toLocaleString()} JSON characters`);
        }
        return catalog;
      }catch(error){worker?.terminate();console.warn('Catalog worker unavailable; using main-thread search',error)}
    }
    return new Catalog(await readGzip('catalog/index.json.gz'));
  };
})();
