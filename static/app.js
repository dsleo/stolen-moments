const state = {offset:0,nextOffset:null,openId:null,lastTrigger:null,loading:false,request:0,details:{},audio:null,sources:[],items:[],decade:'',instrument:'',facetKind:'decade',facetData:null,portraits:{},echoPanel:null,catalog:null,filteredIds:[],sort:'evidence'};
const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct = n => `${Math.round(n*100)}%`;
const sec = n => {const t=Math.max(0,Math.round(n));return `${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`};
const initials = name => String(name||'?').split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join('').toUpperCase();
const params = () => ({min_notes:Number($('#min_notes').value),min_similarity:.8,
  performer:$('#performer').value.trim(),decade:state.decade,instrument:state.instrument,sort:state.sort});
let toastTimer;
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3600)}

function updateOutputs(){
  $('#min_notes_value').textContent=$('#min_notes').value+'+';
  for(const input of document.querySelectorAll('input[type=range]')){
    const q=(Number(input.value)-Number(input.min))/(Number(input.max)-Number(input.min))*100;
    input.style.background=`linear-gradient(to right, #a54d32 0%, #a54d32 ${q}%, #c9ccbd ${q}%, #c9ccbd 100%)`;
  }
}

async function load(append=false){
  const serial=++state.request;
  state.loading=true;
  if(!append)state.nextOffset=null;
  try{
    if(!state.catalog)throw new Error('Catalog unavailable');
    if(!append){state.filteredIds=await state.catalog.filtered(params());refreshFacets(serial)}
    const total=state.filteredIds.length;
    const ids=state.filteredIds.slice(state.offset,state.offset+50);
    const items=ids.map(id=>state.catalog.item(id));
    if(serial!==state.request)return;
    $('#result-count').textContent=total.toLocaleString();
    if(!append)state.items=[];state.items.push(...items);renderCrate(items,append);
    if(!append&&!items.length)$('#crate-strip').innerHTML='<div class="empty"><strong>No passages at this setting.</strong>Lower the similarity or length minimum to broaden the search.</div>';
    state.nextOffset=state.offset+items.length<total?state.offset+items.length:null;
  }catch(err){if(serial===state.request){if(!append)$('#crate-strip').innerHTML=`<div class="empty"><strong>Search unavailable.</strong>${esc(err.message)}</div>`;toast(err.message)}}
  finally{if(serial===state.request)state.loading=false}
}

const hue = name => [...String(name||'')].reduce((h,c)=>(h*31+c.charCodeAt(0))%360,7);
const coverPhoto = s => s.cover?{url:s.cover,kind:'cover'}:
  state.portraits[s.performer]?.image?{url:state.portraits[s.performer].image,kind:'portrait'}:null;
// Typographic sleeve underneath; the real cover (if the archive finds one) covers it.
const sleeve = (s,side) => {const photo=coverPhoto(s);return `<span class="sleeve ${side}" style="--h:${hue(s.performer)}"><span class="sleeve-fallback">${esc(initials(s.performer))}<small>${esc(s.title)}</small></span>${photo?`<img loading="lazy" decoding="async" alt="" src="${esc(photo.url)}">`:''}${photo?.kind==='portrait'?'<span class="portrait-tag">Artist photo</span>':''}</span>`};
const crateCard = item => `<div class="crate-card-item" role="listitem"><button type="button" class="crate-card" data-pull="${item.id}" aria-pressed="false" aria-label="Open ${esc(item.a.performer)}, ${esc(item.a.title)}, and ${esc(item.b.performer)}, ${esc(item.b.title)}; ${item.notes} paired notes; ${pct(item.similarity)} similar"><span class="sleeves">${sleeve(item.a,'a')}${sleeve(item.b,'b')}</span><span class="crate-names">${esc(item.a.performer)} ↔ ${esc(item.b.performer)}</span><span class="crate-score">${pct(item.similarity)} similar · ${item.notes} notes</span></button></div>`;
function renderCrate(items,append){
  const strip=$('#crate-strip');
  if(!append){strip.innerHTML='';strip.scrollLeft=0;$('#stage').className='stage';$('#stage').innerHTML=''}
  strip.insertAdjacentHTML('beforeend',items.map(crateCard).join(''));
}
$('#crate-strip').addEventListener('scroll',()=>{
  const strip=$('#crate-strip');
  if(state.loading||state.nextOffset===null||strip.scrollLeft+strip.clientWidth<strip.scrollWidth-400)return;
  state.offset=state.nextOffset;
  load(true);
});
function pullPair(id){
  const item=state.items.find(x=>x.id===id);if(!item)return;
  document.querySelectorAll('.crate-card').forEach(c=>c.setAttribute('aria-pressed',String(Number(c.dataset.pull)===id)));
  const stage=$('#stage');stage.className='stage has-pair';
  stage.innerHTML=`<button type="button" class="stage-open" data-match="${id}" aria-haspopup="dialog" aria-label="Open ${esc(item.a.performer)} and ${esc(item.b.performer)}">${sleeve(item.a,'a')}<span class="stage-x" aria-hidden="true">↔</span>${sleeve(item.b,'b')}</button>
    <h3>${esc(item.a.performer)} <em>↔</em> ${esc(item.b.performer)}</h3>
    <p>${esc(item.a.title)} · ${sec(item.a_track_time)} &nbsp;/&nbsp; ${esc(item.b.title)} · ${sec(item.b_track_time)}</p>
    <button type="button" class="stage-cta" data-match="${id}" aria-haspopup="dialog"><span>Hear this pair</span><span class="stage-cta-arrow" aria-hidden="true">↗</span></button>`;
}
const SPACING=64,NODE_H=84,TOP_N=70;
function layoutEcho(d){
  const order=d.musicians.map((m,i)=>i).sort((a,b)=>(d.musicians[a].year??9999)-(d.musicians[b].year??9999)||d.musicians[a].name.localeCompare(d.musicians[b].name));
  const x=[];order.forEach((mi,pos)=>{x[mi]=SPACING/2+pos*SPACING});
  return {x,width:order.length*SPACING};
}
function renderEchoes(){
  const d=state.echoes;if(!d)return;
  const ARC_H=Math.max(110,Math.floor(($('#echoes-scroll').clientHeight-NODE_H-12)/2));
  const {x,width}=layoutEcho(d),sel=state.echoSel,m=d.musicians;
  const links=d.links.filter(l=>sel==null?false:l.from===sel||l.to===sel);
  const shown=sel==null?[...d.links].sort((a,b)=>b.strength-a.strength).slice(0,TOP_N):links;
  const max=Math.max(...shown.map(l=>l.strength),1e-9),y0=ARC_H+4;
  const linked=new Set(shown.flatMap(l=>[l.from,l.to]));
  const arcs=shown.map(l=>{
    const x1=Math.min(x[l.from],x[l.to]),x2=Math.max(x[l.from],x[l.to]),rx=(x2-x1)/2,ry=Math.max(14,(ARC_H-6)*Math.pow(rx/(width/2),.6));
    const down=sel!=null&&l.from===sel,ty=down?y0+NODE_H:y0-4;
    return `<path class="echo-arc ${down?'down':'up'}${sel!=null?' sel':''}" d="M${x1},${ty} A${rx},${ry} 0 0 ${down?0:1} ${x2},${ty}" stroke-width="${(1.5+4.5*l.strength/max).toFixed(1)}" data-match="${l.top_id}" tabindex="0" role="button" aria-label="${esc(m[l.from].name)} to ${esc(m[l.to].name)}, ${l.pairs} solo pairs"><title>${esc(m[l.from].name)} → ${esc(m[l.to].name)} · ${l.pairs} solo pair${l.pairs===1?'':'s'}</title></path>`;
  }).join('');
  let lastDecade='';
  const years=state.echoOrder.map(mi=>{const dec=m[mi].year?Math.floor(m[mi].year/10)*10:'';const t=dec&&dec!==lastDecade?`<text class="echo-year" x="${x[mi]-24}" y="14">${dec}s</text>`:'';if(dec)lastDecade=dec;return t}).join('');
  const nodes=m.map((p,i)=>`<button type="button" class="echo-node${sel!=null&&sel!==i&&!linked.has(i)?' dim':''}" style="left:${x[i]}px;top:${y0}px" data-echo="${i}" aria-pressed="${sel===i}" aria-label="${esc(p.name)}. Select, then double click for details" title="${esc(p.name)} · double click for details">${portrait(p.name)}<span>${esc(p.name)}</span></button>`).join('');
  const H=y0+NODE_H+ARC_H+8,box=$('#echoes-scroll'),left=box.scrollLeft;
  box.innerHTML=`<div class="echo-canvas" style="width:${width}px;height:${H}px"><svg width="${width}" height="${H}" aria-label="Arcs from earlier to later musicians">${years}${arcs}</svg>${nodes}</div>`;
  box.scrollLeft=left;
  $('#echoes-note').textContent=sel==null?`Strongest ${shown.length} connections. Select a musician to trace their echoes; double click to open details.`:`${m[sel].name} · double click for details`;
  renderEchoPanel(state.echoPanel);
}
function renderEchoPanel(sel){
  const d=state.echoes,m=d.musicians,panel=$('#echoes-panel');
  if(sel==null){panel.innerHTML='';return}
  const list=(ls,other)=>ls.length?`<ol>${[...ls].sort((a,b)=>b.strength-a.strength).slice(0,10).map(l=>`<li><button type="button" data-match="${l.top_id}"><span>${esc(m[l[other]].name)}</span><small>${l.pairs} pair${l.pairs===1?'':'s'}</small></button></li>`).join('')}</ol>`:'<p>None at these settings.</p>';
  const source=state.portraits[m[sel].name]?.page;
  panel.innerHTML=`<h3>${esc(m[sel].name)}</h3><p>${m[sel].solos} solos · c. ${m[sel].year??'?'}</p>${source?`<a class="portrait-source" href="${esc(source)}" target="_blank" rel="noopener noreferrer">Portrait source ↗</a>`:''}<h4>Echoes</h4>${list(d.links.filter(l=>l.to===sel),'from')}<h4>Echoed by</h4>${list(d.links.filter(l=>l.from===sel),'to')}`;
}
let echoHeight=0;
new ResizeObserver(()=>{const h=$('#echoes-scroll').clientHeight;if(h&&h!==echoHeight){echoHeight=h;renderEchoes()}}).observe($('#echoes-scroll'));
async function loadEchoes(){
  const serial=state.echoSerial=(state.echoSerial||0)+1;
  try{
    if(!state.catalog)return;
    const d=await state.catalog.influence(params());if(serial!==state.echoSerial)return;
    state.echoes=d;
    state.echoOrder=d.musicians.map((_,i)=>i).sort((a,b)=>(d.musicians[a].year??9999)-(d.musicians[b].year??9999)||d.musicians[a].name.localeCompare(d.musicians[b].name));
    if(state.echoSel!=null&&state.echoSel>=d.musicians.length)state.echoSel=null;
    if(state.echoPanel!=null&&state.echoPanel>=d.musicians.length)state.echoPanel=null;
    renderEchoes();
  }catch(err){$('#echoes-scroll').innerHTML=`<div class="empty"><strong>Echoes unavailable.</strong>${esc(err.message)}</div>`}
}
function setView(view){
  document.querySelector('.results-area').dataset.view=view;
  document.querySelectorAll('[data-view-btn]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.viewBtn===view)));
  try{localStorage.setItem('atlas-view',view)}catch{}
  if(view==='echoes'){loadEchoes();$('.results-area').scrollIntoView()}
}
document.addEventListener('error',e=>{if(e.target.matches?.('.sleeve img'))e.target.hidden=true},true);
const portrait=name=>{const photo=state.portraits[name];return `<span class="echo-portrait" style="--h:${hue(name)}"><span class="echo-portrait-fallback">${esc(initials(name))}</span>${photo?`<img loading="lazy" decoding="async" src="${esc(photo.image)}" alt="">`:''}</span>`};
document.addEventListener('error',e=>{if(e.target.matches?.('.echo-portrait img'))e.target.hidden=true},true);

const INSTRUMENTS={ts:'Tenor sax',as:'Alto sax',ss:'Soprano sax',bs:'Baritone sax',tp:'Trumpet',tb:'Trombone',cl:'Clarinet',p:'Piano',g:'Guitar',vib:'Vibraphone',b:'Bass',fl:'Flute',cor:'Cornet',bcl:'Bass clarinet',voc:'Voice'};
const FACETS={decade:{label:'Decade',name:v=>`${v}s`},instrument:{label:'Instrument',name:v=>INSTRUMENTS[v]||v.toUpperCase()},performer:{label:'Musician',name:v=>v}};
const facetValue = kind => kind==='performer'?$('#performer').value:state[kind];
async function refreshFacets(serial){
  try{const data=await state.catalog.facets(params());if(serial===state.request){state.facetData=data;renderShelf()}}catch{}
}
function renderShelf(){
  const data=state.facetData;if(!data)return;
  document.querySelectorAll('[data-facet-kind]').forEach(b=>{const k=b.dataset.facetKind;b.setAttribute('aria-pressed',String(k===state.facetKind));b.classList.toggle('has-pick',!!facetValue(k))});
  const kind=state.facetKind,current=String(facetValue(kind)),{name}=FACETS[kind];
  const chip=(value,label,count)=>`<button type="button" class="shelf-chip" data-facet-value="${esc(value)}" aria-pressed="${String(value)===current}">${esc(label)}${count==null?'':` <small>${count.toLocaleString()}</small>`}</button>`;
  const search=$('#facet-search'),q=kind==='performer'?search.value.trim().toLowerCase():'';
  search.hidden=kind!=='performer';
  $('#shelf-chips').innerHTML=chip('','All',null)+data[kind].filter(([v])=>!q||name(v).toLowerCase().includes(q)).map(([v,n])=>chip(v,name(v),n)).join('');
  const hasFilters=Object.keys(FACETS).some(k=>!!facetValue(k))||Number($('#min_notes').value)>8;
  $('#open-shelf').classList.toggle('has-pick',hasFilters);
  $('#clear-crate-filters').hidden=!hasFilters;
  renderCrateState();
}
function renderCrateState(){
  const tags=Object.keys(FACETS).filter(k=>facetValue(k)).map(k=>`<button type="button" class="state-tag" data-unset="${k}" aria-label="Remove ${esc(FACETS[k].label)} filter">${esc(FACETS[k].label)}: ${esc(FACETS[k].name(facetValue(k)))} ×</button>`);
  if(Number($('#min_notes').value)>8)tags.push(`<button type="button" class="state-tag" data-unset="notes" aria-label="Remove paired notes filter">${$('#min_notes').value}+ notes ×</button>`);
  const el=$('#crate-state');el.hidden=!tags.length;
  el.innerHTML=`${tags.join('')}`;
  $('#open-sort').classList.toggle('has-pick',state.sort!=='evidence');
  $('#clear-sort').hidden=state.sort==='evidence';
}
function pickFacet(value){
  const kind=state.facetKind;
  if(kind==='performer')$('#performer').value=value;else state[kind]=value;
  resetSearch();
}
function resetSearch(){state.offset=0;state.openId=null;load();if($('.results-area').dataset.view==='echoes')loadEchoes()}
function scorePanel(notes,side,id,solo){
  if(!notes.length)return '';
  return `<section class="score-panel ${side}" aria-label="Score excerpt ${side.toUpperCase()}">
    <div class="score-heading"><div><span class="score-letter">${side.toUpperCase()}</span><strong>${esc(solo.performer)} · ${esc(solo.title)}</strong></div><span>${notes.length} notes</span></div>
    <div class="score-body"><div class="score-scroll"><div class="score-paper" id="score-${id}-${side}" role="img" aria-label="Staff notation for ${esc(solo.performer)} playing ${esc(solo.title)}"></div></div></div>
    <div class="score-footer"><span>${sec(notes[0].track_time)}–${sec(notes[notes.length-1].track_time)} in source track</span><button type="button" class="score-play" data-play="${side}" data-detail="${id}" aria-label="Play MIDI transcription for ${esc(solo.performer)} — ${esc(solo.title)}" title="Play MIDI transcription"><span aria-hidden="true">▶</span></button></div>
  </section>`;
}

function abcPitch(midi,accidentals){
  const steps=[['C',0],['D',-1],['D',0],['E',-1],['E',0],['F',0],['G',-1],['G',0],['A',-1],['A',0],['B',-1],['B',0]];
  const [letter,alter]=steps[((midi%12)+12)%12],octave=Math.floor(midi/12)-1;
  const key=`${letter}${octave}`;
  const previous=accidentals.get(key)||0;
  const prefix=alter===previous?'':alter===-1?'_':'=';
  accidentals.set(key,alter);
  const name=octave>=5?letter.toLowerCase()+"'".repeat(Math.max(0,octave-5)):letter+','.repeat(Math.max(0,4-octave));
  return prefix+name;
}

function scoreAbc(notes){
  const accidentals=new Map();
  const rates=notes.slice(1).map((n,i)=>{
    const seconds=n.onset-notes[i].onset,beats=n.beat-notes[i].beat;
    return seconds>1e-6&&beats>0?beats/seconds:null;
  }).filter(rate=>rate!==null);
  const fallback=rates.length?[...rates].sort((a,b)=>a-b)[Math.floor(rates.length/2)]:2;
  const units=beats=>Math.max(1,Math.min(32,Math.round(beats*4)));
  const body=notes.map((note,i)=>{
    const next=notes[i+1];
    const seconds=next?next.onset-note.onset:null,beats=next?next.beat-note.beat:null;
    const localRate=seconds>1e-6&&beats>0?beats/seconds:fallback;
    const durationBeats=Math.max(.0625,(note.duration||0)*localRate);
    const length=units(durationBeats);
    const duration=`${abcPitch(note.pitch,accidentals)}${length===1?'':length}`;
    if(!next)return duration;
    const restBeats=Math.max(0,beats-durationBeats);
    const restUnits=Math.round(restBeats*4);
    return restUnits>0?`${duration} z${Math.min(32,restUnits)}`:duration;
  }).join(' ');
  const pitches=notes.map(n=>n.pitch).sort((a,b)=>a-b);
  const clef=pitches[Math.floor(pitches.length/2)]<57?'bass':'treble';
  return `X:1\nM:none\nL:1/16\nK:C clef=${clef}\n${body}`;
}

const PITCH_NAMES=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
function pitchLabel(midi){return `${PITCH_NAMES[((midi%12)+12)%12]}${Math.floor(midi/12)-1}`}

function alignmentPanel(d){
  const aByIndex=new Map(d.a_notes.map(note=>[note.index,note]));
  const bByIndex=new Map(d.b_notes.map(note=>[note.index,note]));
  const rows=d.alignment.map(([ai,bi],index)=>{
    const a=ai>=0?aByIndex.get(ai):null,b=bi>=0?bByIndex.get(bi):null;
    const paired=!!a&&!!b;
    const aText=a?`${pitchLabel(a.pitch)} · note ${a.index+1}`:'Skipped';
    const bText=b?`${pitchLabel(b.pitch)} · note ${b.index+1}`:'Skipped';
    const result=paired?'Paired':a?'No matching note in B':'No matching note in A';
    return `<tr class="${paired?'':'alignment-gap'}"><th scope="row">${index+1}</th><td>${esc(aText)}</td><td>${esc(bText)}</td><td>${result}</td></tr>`;
  }).join('');
  const skipped=d.alignment.filter(([a,b])=>a<0||b<0).length;
  return `<details class="alignment-disclosure">
    <summary aria-label="Show note-by-note alignment" title="Show note-by-note alignment">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l12-2v13M9 10l12-2"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
      <span>Compare notes</span>
    </summary>
    <section class="alignment-panel" aria-labelledby="alignment-title">
      <h3 id="alignment-title">Note-by-note alignment</h3>
      <p>Each row shows how notes were paired. ${skipped?`${skipped} extra note${skipped===1?' was':'s were'} skipped.`:'No notes were skipped.'}</p>
      <div class="alignment-table-scroll" tabindex="0" aria-label="Scrollable note alignment table">
        <table class="alignment-table"><caption>${d.alignment.length} alignment steps between passages A and B</caption><thead><tr><th scope="col">Step</th><th scope="col">A · ${esc(d.a.performer)}</th><th scope="col">B · ${esc(d.b.performer)}</th><th scope="col">Alignment</th></tr></thead><tbody>${rows}</tbody></table>
      </div>
    </section>
  </details>`;
}

let abcLoad;
const loadAbc=()=>abcLoad??=window.ABCJS?Promise.resolve():new Promise((ok,fail)=>{const el=document.createElement('script');el.src='vendor/abcjs-basic-min.js';el.onload=ok;el.onerror=()=>{abcLoad=null;fail()};document.head.append(el)});
async function renderScores(d){
  try{await loadAbc()}catch{}
  const staffWidth=Math.max(610,...['a','b'].map(side=>(d[`${side}_notes`]||[]).length*43));
  for(const side of ['a','b']){
    const target=document.getElementById(`score-${d.id}-${side}`);
    if(!target)continue;
    if(!window.ABCJS){target.textContent='Score renderer unavailable';continue}
    const notes=d[`${side}_notes`];
    try{window.ABCJS.renderAbc(target,scoreAbc(notes),{staffwidth:staffWidth,scale:.9,paddingtop:4,paddingbottom:2,paddingleft:2,paddingright:2});}
    catch(err){target.textContent='Could not draw this score'}
  }
}

function mediaSection(d,side){
  const s=d[side],time=d[`${side}_track_time`];
  const recording=d[`recording_${side}`];
  const source=s.source_url?`<a href="${esc(s.source_url)}" target="_blank" rel="noopener noreferrer">${s.source==='DTL1000'?'DTL1000 solo details':'Source transcription'} ↗</a>`:'';
  const alignment=recording?.aligned?`<a href="${esc(recording.source_url)}" target="_blank" rel="noopener noreferrer">JazzTube alignment ↗</a>`:'';
  const provenance=(source||alignment)?`<details class="provenance-info"><summary aria-label="Open source information" title="Source information">i</summary><div class="provenance-popover">${source}${alignment}</div></details>`:'';
  return `<div class="panel-listen"><div class="listen-links">${recording?`<a class="youtube-link" href="${esc(recording.url)}" target="_blank" rel="noopener noreferrer"><span class="youtube-mark">▶</span> ${recording.verified?'Play verified recording':recording.aligned?'Play JazzTube video':recording.estimated?'Play likely recording':'Open candidate video'}${recording.time_seconds!=null?` at ${sec(recording.time_seconds)}`:''} ↗</a>`:'<span class="no-video">No matched video</span>'}${provenance}</div>
  </div>`;
}

function albumVisual(s,side){
  const photo=coverPhoto(s),portrait=photo?.kind==='portrait';
  return `<div class="album-visual" data-side="${side}"><div class="album-placeholder" aria-hidden="true"></div>${photo?`<img class="album-art" src="${esc(photo.url)}" alt="${portrait?`Photo of ${esc(s.performer)}; album cover unavailable`:`Album cover for ${esc(s.album||s.title)}`}" onerror="this.hidden=true">`:''}${portrait?'<span class="album-kind">Artist photo · recording cover unavailable</span>':''}</div>`;
}

function artistPanel(d,side){
  const s=d[side];
  const recordingUrl=s.musicbrainz_id?`https://musicbrainz.org/recording/${encodeURIComponent(s.musicbrainz_id)}`:'';
  const trackName=recordingUrl?`<a class="track-link" href="${recordingUrl}" target="_blank" rel="noopener noreferrer">${esc(s.title)} <span aria-hidden="true">↗</span></a>`:esc(s.title);
  return `<article class="artist-panel ${side}">
    <div class="artist-visual">${albumVisual(s,side)}</div>
    <div class="artist-info"><header class="artist-heading"><div class="side-tag">${side.toUpperCase()}</div><div><h3>${esc(s.performer)}</h3><p class="artist-meta">${esc(s.instrument||'Jazz soloist')} · ${esc(s.recording_date||s.year||'Date unknown')}</p></div></header>
      <div class="track-heading"><div><h4>${trackName}</h4>${s.album?`<p>${esc(s.album)}</p>`:''}</div></div>
      ${scorePanel(d[`${side}_notes`],side,d.id,s)}
      ${mediaSection(d,side)}</div>
  </article>`;
}

function detailHTML(d){
  return `<div class="pair-card"><header class="pair-card-head"><div><p class="small-caps">A closer listen</p><h2 id="pair-dialog-title">${esc(d.a.performer)} <em>↔</em> ${esc(d.b.performer)}</h2></div><button type="button" class="dialog-close" data-close-pair aria-label="Close pair detail">×</button></header>
    <div class="pair-split">${artistPanel(d,'a')}${artistPanel(d,'b')}</div>
    <div class="pair-card-score"><div><strong>${d.notes}</strong><span>paired notes</span></div><div><strong>${pct(d.similarity)}</strong><span>similarity</span></div><div><strong>${d.gaps}</strong><span>extra notes</span></div><div class="alignment-score-cell">${alignmentPanel(d)}</div></div>
    <footer class="pair-card-foot"><span>${esc(d.a.recording_date||'unknown')} · ${esc(d.b.recording_date||'unknown')}</span></footer>
  </div>`;
}

async function toggleDetail(button){
  const id=Number(button.dataset.match),dialog=$('#pair-dialog');
  state.lastTrigger=button;
  state.openId=id;dialog.innerHTML='<div class="pair-loading">Reading both passages…</div>';
  if(!dialog.open)dialog.showModal();
  try{const detail=await state.catalog.detail(id);state.details[id]=detail;if(state.openId===id){dialog.innerHTML=detailHTML(detail);renderScores(detail)}}catch(err){dialog.innerHTML=`<div class="pair-loading"><strong>Could not open this pair.</strong><p>${esc(err.message)}</p><button type="button" class="drawer-done" data-close-pair>Close</button></div>`}
}

async function playTranscript(notes){
  const Context=window.AudioContext||window.webkitAudioContext;
  if(!Context){toast('Audio playback is unavailable in this browser');return}
  if(!state.audio)state.audio=new Context();
  await state.audio.resume();
  for(const source of state.sources){try{source.stop()}catch{}}
  state.sources=[];
  const start=state.audio.currentTime+.08,first=notes[0].onset;
  for(const note of notes){
    const oscillator=state.audio.createOscillator(),gain=state.audio.createGain();
    const at=start+Math.max(0,note.onset-first),duration=Math.max(.07,Math.min(note.duration,.8));
    oscillator.type='triangle';oscillator.frequency.value=440*Math.pow(2,(note.pitch-69)/12);
    gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(.18,at+.018);
    gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
    oscillator.connect(gain).connect(state.audio.destination);oscillator.start(at);oscillator.stop(at+duration+.02);
    state.sources.push(oscillator);
  }
}

document.addEventListener('click',event=>{
  const facetKind=event.target.closest('[data-facet-kind]');if(facetKind){state.facetKind=facetKind.dataset.facetKind;renderShelf()}
  const facetChip=event.target.closest('[data-facet-value]');if(facetChip)pickFacet(facetChip.dataset.facetValue);
  if(event.target.closest('#open-shelf')){const options=$('#crate-options'),button=$('#open-shelf'),open=options.hidden;options.hidden=!open;button.setAttribute('aria-expanded',String(open));$('#sort-options').hidden=true;$('#open-sort').setAttribute('aria-expanded','false')}
  if(event.target.closest('#open-sort')){const options=$('#sort-options'),button=$('#open-sort'),open=options.hidden;options.hidden=!open;button.setAttribute('aria-expanded',String(open));$('#crate-options').hidden=true;$('#open-shelf').setAttribute('aria-expanded','false')}
  const unset=event.target.closest('[data-unset]');if(unset){const k=unset.dataset.unset;if(k==='performer')$('#performer').value='';else if(k==='notes'){$('#min_notes').value=8;updateOutputs()}else state[k]='';$('#facet-search').value='';resetSearch()}
  if(event.target.closest('#clear-sort')){state.sort='evidence';document.querySelectorAll('[data-sort]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.sort==='evidence')));resetSearch()}
  if(!event.target.closest('#crate-options,#sort-options,#open-shelf,#open-sort')){for(const [panel,btn] of [['#crate-options','#open-shelf'],['#sort-options','#open-sort']]){$(panel).hidden=true;$(btn).setAttribute('aria-expanded','false')}}
  const sorting=event.target.closest('[data-sort]');if(sorting){state.sort=sorting.dataset.sort;document.querySelectorAll('[data-sort]').forEach(b=>b.setAttribute('aria-pressed',String(b===sorting)));$('#sort-options').hidden=true;$('#open-sort').setAttribute('aria-expanded','false');resetSearch()}
  if(event.target.closest('#clear-crate-filters')){state.decade='';state.instrument='';$('#performer').value='';$('#min_notes').value=8;updateOutputs();resetSearch()}
  const pull=event.target.closest('[data-pull]');if(pull)pullPair(Number(pull.dataset.pull));
  const echo=event.target.closest('[data-echo]');if(echo){const i=Number(echo.dataset.echo),now=performance.now();const secondClick=state.lastEchoClick?.index===i&&now-state.lastEchoClick.time<450;state.echoSel=i;state.echoPanel=secondClick?i:null;state.lastEchoClick={index:i,time:now};renderEchoes()}
  const viewBtn=event.target.closest('[data-view-btn]');if(viewBtn)setView(viewBtn.dataset.viewBtn);
  const match=event.target.closest('[data-match]');if(match){event.preventDefault();toggleDetail(match)}
  const play=event.target.closest('[data-play]');if(play){const d=state.details[Number(play.dataset.detail)];if(d)playTranscript(d[`${play.dataset.play}_notes`])}
  if(event.target.closest('[data-close-pair]'))$('#pair-dialog').close();
});
document.addEventListener('dblclick',event=>{const echo=event.target.closest('[data-echo]');if(echo){state.echoSel=Number(echo.dataset.echo);state.echoPanel=state.echoSel;renderEchoes()}});
document.addEventListener('keydown',event=>{const echo=event.target.closest('[data-echo]');if(echo&&event.key==='Enter'&&state.echoSel===Number(echo.dataset.echo)){event.preventDefault();state.echoPanel=state.echoSel;renderEchoes()}});
let debounce;
$('#facet-search').addEventListener('input',renderShelf);
document.addEventListener('keydown',e=>{if(e.key==='Escape')for(const [panel,btn] of [['#crate-options','#open-shelf'],['#sort-options','#open-sort']]){$(panel).hidden=true;$(btn).setAttribute('aria-expanded','false')}});
$('#min_notes').addEventListener('input',()=>{updateOutputs();clearTimeout(debounce);debounce=setTimeout(resetSearch,150)});
// One photograph and one hinged cover persist through both views. The lid's
// projected corners rotate around the rear hinges; the record never changes.
const desk = $('#landing');
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const lidParts = Object.fromEntries(['shadow','left','right','glass-face','reflection-face','front','rim','glint'].map(name=>[name,$(`#lid-${name}`)]));
let deskPhase = 'closed';
const point = (a,b,t) => a.map((value,i)=>value+(b[i]-value)*t);
const polygon = points => 'M'+points.map(p=>p.map(n=>n.toFixed(2)).join(',')).join(' L')+' Z';

function renderLid(progress){
  const angle = progress * 72 * Math.PI / 180;
  const c = Math.cos(angle), s = Math.sin(angle);
  const rearLeft = [786,66], rearRight = [1426,207];
  // A shallow acrylic box: the top and its three visible edges rotate together.
  const corner = (hinge,depth,lift=0) => {
    const reach = depth[1] ? 1 : 0;
    return [hinge[0]+depth[0]*c+38*s*reach+lift*(.3*c-.36*s),hinge[1]+depth[1]*c-360*s*reach+lift*(-c+s)];
  };
  const a = corner(rearLeft,[0,0],34), b = corner(rearRight,[0,0],34);
  const d = corner(rearLeft,[-181,466],34), e = corner(rearRight,[-105,538],34);
  const bottomD = corner(rearLeft,[-181,466]), bottomE = corner(rearRight,[-105,538]);
  lidParts.left.setAttribute('d',polygon([rearLeft,a,d,bottomD]));
  lidParts.right.setAttribute('d',polygon([rearRight,b,e,bottomE]));
  lidParts.front.setAttribute('d',polygon([d,e,bottomE,bottomD]));
  lidParts['glass-face'].setAttribute('d',polygon([a,b,e,d]));
  lidParts.rim.setAttribute('d',polygon([a,b,e,d]));
  lidParts.glint.setAttribute('d',`M${a} L${d} L${e}`);
  lidParts['reflection-face'].setAttribute('d',polygon([point(a,b,.12),point(a,b,.32),point(d,e,.55),point(d,e,.32)]));
  lidParts.shadow.setAttribute('d',polygon([rearLeft,rearRight,[1321,745],[605,532]]));
  lidParts.shadow.style.opacity = .2 * (1-progress);
  desk.style.setProperty('--lid-progress',progress);
}

function animateLid(open){
  const duration = open ? 1350 : 850;
  return new Promise(resolve=>{
    let started;
    function frame(now){
      started ??= now;
      const t = motionPreference.matches ? 1 : Math.min(1,(now-started)/duration);
      // Smooth acceleration at the hinge, then a gentle stop at the open angle.
      const eased = t < .5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2;
      renderLid(open ? eased : 1-eased);
      if(open && t>.65)desk.dataset.phase='arriving';
      if(t<1)requestAnimationFrame(frame);else resolve();
    }
    requestAnimationFrame(frame);
  });
}

async function openDesk(){
  if(deskPhase!=='closed')return;
  deskPhase='opening';
  desk.dataset.phase='opening';
  $('#enter-atlas').disabled=true;
  $('[data-lift-lid]').disabled=true;
  $('.landing-intro').inert=true;
  await animateLid(true);
  deskPhase='open';
  desk.dataset.phase='open';
  document.body.classList.add('atlas-open');
  $('.landing-intro').hidden=true;
  $('#enter-atlas').hidden=true;
  $('.archive-content').hidden=false;
  $('.archive-content').inert=false;
  $('.desk-actions').inert=false;
  $('#desk-status').textContent='The lid is open.';
}

async function closeDesk(){
  if(deskPhase!=='open')return;
  deskPhase='closing';
  desk.dataset.phase='closing';
  window.scrollTo({top:0,behavior:'instant'});
  document.body.classList.remove('atlas-open');
  $('.archive-content').hidden=true;
  $('.archive-content').inert=true;
  $('.desk-actions').inert=true;
  await animateLid(false);
  deskPhase='closed';
  desk.dataset.phase='closed';
  $('.landing-intro').hidden=false;
  $('.landing-intro').inert=false;
  $('#enter-atlas').hidden=false;
  $('#enter-atlas').disabled=false;
  $('[data-lift-lid]').disabled=false;
  $('#enter-atlas').focus({preventScroll:true});
  $('#desk-status').textContent='The lid is closed.';
}

renderLid(0);
$('#enter-atlas').addEventListener('click',openDesk);
$('[data-lift-lid]').addEventListener('click',openDesk);
$('#close-deck').addEventListener('click',closeDesk);
$('#pair-dialog').addEventListener('click',event=>{if(event.target===$('#pair-dialog'))$('#pair-dialog').close()});
$('#pair-dialog').addEventListener('close',()=>{state.openId=null;if(state.lastTrigger?.isConnected)state.lastTrigger.focus()});

async function init(){
  updateOutputs();
  try{const portraits=await fetch('artist-portraits.json');if(portraits.ok)state.portraits=await portraits.json()}catch{}
  try{setView(localStorage.getItem('atlas-view')==='echoes'?'echoes':'crate')}catch{}
  try{
    state.catalog=await loadCatalog();
    await load();
    if($('.results-area').dataset.view==='echoes')loadEchoes();
  }catch(err){const message=location.protocol==='file:'?'Open this site over HTTP, for example with `python3 -m http.server 8766 -d static`.':err.message;$('#crate-strip').innerHTML=`<div class="empty"><strong>Could not open the atlas.</strong>${esc(message)}</div>`}
}
init();
