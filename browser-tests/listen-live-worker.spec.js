const {test,expect}=require('@playwright/test');

test('live pitch tracker and full-corpus search recover a known phrase',async({page})=>{
  test.setTimeout(120000);
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const manifest=await fetch('catalog/listen/manifest.json').then(r=>r.json());
    let solo;
    for(const shard of manifest.shards){
      const bytes=new Uint8Array(await fetch(`catalog/listen/${shard.path}`).then(r=>r.arrayBuffer()));
      const unpacked=bytes[0]===31&&bytes[1]===139
        ?await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
        :new TextDecoder().decode(bytes);
      solo=JSON.parse(unpacked).solos.find(s=>s.id===346);
      if(solo)break;
    }
    const sampleRate=22050,startIndex=133,start=solo.onsetsSeconds[startIndex],end=solo.onsetsSeconds[startIndex+15]-start+1;
    const pcm=new Float32Array(Math.ceil(end*sampleRate));
    for(let k=0;k<16;k++){
      const index=startIndex+k,at=solo.onsetsSeconds[index]-start;
      const next=k<15?solo.onsetsSeconds[index+1]-start:end;
      const len=Math.max(.06,Math.min(solo.durationsSeconds[index],next-at-.045,end-at,.6));
      const frequency=440*2**((solo.pitches[index]-69)/12);
      for(let i=0;i<Math.floor(len*sampleRate);i++){
        const env=Math.min(1,i/(sampleRate*.014))*Math.min(1,(len*sampleRate-i)/(sampleRate*.05));
        pcm[Math.floor(at*sampleRate)+i]+=.22*env*Math.sin(2*Math.PI*frequency*i/sampleRate);
      }
    }
    const tracker=new Worker('listen/live-pitch-worker.js',{type:'module'});
    const notes=[];
    for(const [index,from,to] of [[1,0,3.4],[2,3.2,end]]){
      const chunk=pcm.slice(Math.floor(from*sampleRate),Math.ceil(to*sampleRate));
      const tracked=await new Promise((resolve,reject)=>{
        tracker.onmessage=e=>{if(e.data.type==='result')resolve(e.data.payload);else if(e.data.type==='error')reject(new Error(e.data.payload.message))};
        tracker.onerror=e=>reject(new Error(e.message));
        tracker.postMessage({type:'transcribe',requestId:index,sessionId:1,payload:{pcm:chunk,sampleRate,windowStartSeconds:from}},[chunk.buffer]);
      });
      for(const note of tracked.notes){if(!notes.some(old=>old.pitch===note.pitch&&Math.abs(old.onsetSeconds-note.onsetSeconds)<.08))notes.push(note)}
    }
    tracker.terminate();
    notes.sort((a,b)=>a.onsetSeconds-b.onsetSeconds);
    if(notes.length<8)return {notes:notes.length,results:[]};
    const search=new Worker('listen/retrieval-worker.js',{type:'module'});
    const matches=await new Promise((resolve,reject)=>{
      search.onmessage=e=>{if(e.data.type==='result')resolve(e.data.payload);else if(e.data.type==='error')reject(new Error(e.data.payload.message))};
      search.onerror=e=>reject(new Error(e.message));
      search.postMessage({type:'search',requestId:2,sessionId:1,payload:{schemaVersion:1,requestId:2,source:'microphone',audioDurationSeconds:end,notes}});
    });
    search.terminate();
    return {notes:notes.length,results:matches.results.map(r=>({soloId:r.soloId,startNote:r.startNote}))};
  });
  expect(result.notes).toBeGreaterThanOrEqual(8);
  expect(result.results.slice(0,5).some(r=>r.soloId===346&&Math.abs(r.startNote-133)<=3)).toBe(true);
});
