const state = {offset:0,nextOffset:null,openId:null,lastTrigger:null,loading:false,request:0,details:{},audio:null,sources:[],playback:null,playbackRevision:0,items:[],decade:'',instrument:'',facetKind:'decade',facetData:null,portraits:{},echoPanel:null,catalog:null,filteredTotal:0,initialResultsReady:false,sort:'evidence'};
const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct = n => `${Math.round(n*100)}%`;
const sec = n => {const t=Math.max(0,Math.round(n));return `${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`};
const initials = name => String(name||'?').split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join('').toUpperCase();
const params = () => ({min_notes:Number($('#min_notes').value),min_similarity:.8,
  performer:$('#performer').value.trim(),decade:state.decade,instrument:state.instrument,sort:state.sort});
let toastTimer;
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3600)}
function bringCrateIntoView(){
  if(deskPhase!=='open'||!state.initialResultsReady)return;
  $('#open-shelf').focus({preventScroll:true});
  $('.crate').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'end'});
}

function updateOutputs(){
  $('#min_notes_value').textContent=$('#min_notes').value+'+';
  for(const input of document.querySelectorAll('input[type=range]')){
    const q=(Number(input.value)-Number(input.min))/(Number(input.max)-Number(input.min))*100;
    input.style.background=`linear-gradient(to right, #a54d32 0%, #a54d32 ${q}%, #c9ccbd ${q}%, #c9ccbd 100%)`;
  }
}

async function load(append=false){
  const serial=++state.request;
  const perf=()=>new URLSearchParams(location.search).has('perf');
  if(!append&&perf())performance.mark('sm:first-query-start');
  state.loading=true;
  if(!append){$('#crate-state').hidden=false;$('#crate-state').textContent='Loading passages…';$('#crate-strip').setAttribute('aria-busy','true')}
  if(!append)state.nextOffset=null;
  try{
    if(!state.catalog)throw new Error('Catalog unavailable');
    const page=await state.catalog.filtered(params(),state.offset,50);
    if(!append){state.filteredTotal=page.total;refreshFacets(serial)}
    const total=state.filteredTotal;
    if(!append&&perf()){performance.mark('sm:first-query-ready');try{performance.measure('sm:first-filter','sm:first-query-start','sm:first-query-ready')}catch{}}
    const items=page.items;
    if(serial!==state.request)return;
    $('#result-count').textContent=total.toLocaleString();
    if(!append)state.items=[];state.items.push(...items);renderCrate(items,append);
    if(!append&&perf()){performance.mark('sm:first-results-rendered');try{performance.measure('sm:first-results','sm:first-query-start','sm:first-results-rendered')}catch{}}
    if(!append&&!items.length)$('#crate-strip').innerHTML='<div class="empty"><strong>No passages at this setting.</strong>Lower the similarity or length minimum to broaden the search.</div>';
    state.nextOffset=state.offset+items.length<total?state.offset+items.length:null;
  }catch(err){if(serial===state.request){if(!append)$('#crate-strip').innerHTML=`<div class="empty"><strong>Search unavailable.</strong>${esc(err.message)}</div>`;toast(err.message)}}
  finally{if(serial===state.request){state.loading=false;if(!append){$('#crate-state').hidden=true;$('#crate-strip').removeAttribute('aria-busy');state.initialResultsReady=true;bringCrateIntoView()}}}
}

const hue = name => [...String(name||'')].reduce((h,c)=>(h*31+c.charCodeAt(0))%360,7);
const coverPhoto = s => s.cover?{url:s.cover,kind:'cover'}:
  state.portraits[s.performer]?.image?{url:state.portraits[s.performer].image,kind:'portrait'}:null;
// Typographic sleeve underneath; the real cover (if the archive finds one) covers it.
const sleeve = (s,side) => {const photo=coverPhoto(s);return `<span class="sleeve ${side}" style="--h:${hue(s.performer)}"><span class="sleeve-fallback">${esc(initials(s.performer))}<small>${esc(s.title)}</small></span>${photo?`<img loading="lazy" decoding="async" alt="" src="${esc(photo.url)}">`:''}</span>`};
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
const ECHO_TOP_N=70;
const echoTopLinks=d=>[...d.links].sort((a,b)=>b.strength-a.strength).slice(0,ECHO_TOP_N);
const echoDecade=year=>year?Math.floor(year/10)*10:null;
const echoDegree=(links,count)=>{const degree=Array(count).fill(0);for(const l of links){degree[l.from]++;degree[l.to]++}return degree};
function echoVisibleOrder(shown){
  const linked=new Set(shown.flatMap(l=>[l.from,l.to]));
  if(state.echoSel!=null)linked.add(state.echoSel);
  return state.echoOrder.filter(i=>linked.has(i));
}
function echoNode(p,i,size,extra='',position=''){
  return `<button type="button" class="echo-node ${extra}" style="--echo-portrait-size:${size}px;${position}" data-echo="${i}" aria-pressed="${state.echoSel===i}" aria-label="${esc(p.name)}. Show connections" title="${esc(p.name)}">${portrait(p.name)}<span>${esc(p.name)}</span></button>`;
}
function renderEchoTimeline(d){
  const box=$('#echoes-scroll'),m=d.musicians,sel=state.echoSel;
  const shown=sel!=null?[...d.links].filter(l=>l.from===sel||l.to===sel).sort((a,b)=>b.strength-a.strength).slice(0,40):echoTopLinks(d);
  const order=echoVisibleOrder(shown),degree=echoDegree(shown,m.length);
  if(!order.length){box.innerHTML='<div class="empty"><strong>No connections at these settings.</strong></div>';return}
  const spacing=Math.round(86*(state.echoZoom||1)),x=[];
  order.forEach((mi,pos)=>{x[mi]=spacing/2+pos*spacing});
  const width=Math.max(box.clientWidth,order.length*spacing),arcH=Math.max(135,Math.floor((box.clientHeight-115)*(sel==null ? .68 : .48)));
  const y0=arcH+24,height=Math.max(box.clientHeight,y0+115),max=Math.max(...shown.map(l=>l.strength),1e-9);
  const arcs=shown.map(l=>{
    if(x[l.from]==null||x[l.to]==null)return '';
    const x1=Math.min(x[l.from],x[l.to]),x2=Math.max(x[l.from],x[l.to]),rx=Math.max(1,(x2-x1)/2),ry=Math.max(20,(arcH-20)*Math.pow(rx/(width/2),.45));
    const down=sel!=null&&l.from===sel,ty=down?y0+66:y0-6;
    return `<path class="echo-arc ${down?'down':'up'}${sel!=null?' sel':''}" d="M${x1},${ty} A${rx},${ry} 0 0 ${down?0:1} ${x2},${ty}" stroke-width="${(1.5+4.5*l.strength/max).toFixed(1)}" data-match="${l.top_id}" tabindex="0" role="button" aria-label="${esc(m[l.from].name)} to ${esc(m[l.to].name)}, ${l.pairs} solo pairs"><title>${esc(m[l.from].name)} → ${esc(m[l.to].name)} · ${l.pairs} solo pair${l.pairs===1?'':'s'}</title></path>`;
  }).join('');
  let lastDecade=null;
  const years=order.map(mi=>{const dec=echoDecade(m[mi].year),label=dec&&dec!==lastDecade?`<text class="echo-year" x="${Math.max(6,x[mi]-28)}" y="21">${dec}s</text><line class="echo-decade-line" x1="${x[mi]}" x2="${x[mi]}" y1="30" y2="${height}"/>`:'';if(dec)lastDecade=dec;return label}).join('');
  const nodes=order.map(i=>{const size=degree[i]>=10?58:degree[i]>=4?49:40;return echoNode(m[i],i,size,degree[i]?'':'unlinked',`left:${x[i]}px;top:${y0}px`)}).join('');
  const left=box.scrollLeft;
  box.innerHTML=`<div class="echo-canvas" style="width:${width}px;height:${height}px"><svg width="${width}" height="${height}" aria-label="Arcs from earlier to later musicians">${years}${arcs}</svg>${nodes}</div>`;
  box.scrollLeft=left;
  if(box.clientWidth&&box.clientHeight&&(state.echoCenterIndex!=null||!state.echoInitialCentered)){
    const target=state.echoCenterIndex??degree.indexOf(Math.max(...degree));
    state.echoCenterIndex=null;state.echoInitialCentered=true;
    requestAnimationFrame(()=>{if(x[target]!=null)box.scrollLeft=Math.max(0,x[target]-box.clientWidth/2)});
  }
}
function renderEchoes(){
  const d=state.echoes;if(!d)return;
  $('#echo-overview').hidden=state.echoSel==null;
  renderEchoTimeline(d);
  renderEchoPanel(state.echoPanel);
}
function echoLinkYears(l){
  return l.from_year&&l.to_year?`${l.from_year} → ${l.to_year}`:'';
}
function renderEchoPanel(sel){
  const d=state.echoes,m=d.musicians,panel=$('#echoes-panel');
  if(sel==null){panel.innerHTML='';return}
  const list=(ls,other)=>ls.length?`<ol>${[...ls].sort((a,b)=>b.strength-a.strength).slice(0,10).map(l=>`<li><button type="button" data-match="${l.top_id}"><span>${esc(m[l[other]].name)}<small>${echoLinkYears(l)}</small></span><small>${l.pairs} pair${l.pairs===1?'':'s'}</small></button></li>`).join('')}</ol>`:'<p>None at these settings.</p>';
  const source=state.portraits[m[sel].name]?.page;
  panel.innerHTML=`<h3>${esc(m[sel].name)}</h3><p>${m[sel].solos} solos · c. ${m[sel].year??'?'}</p>${source?`<a class="portrait-source" href="${esc(source)}" target="_blank" rel="noopener noreferrer">Portrait source ↗</a>`:''}<h4>Echoes</h4>${list(d.links.filter(l=>l.to===sel),'from')}<h4>Echoed by</h4>${list(d.links.filter(l=>l.from===sel),'to')}`;
}
let echoWidth=0,echoHeight=0;
new ResizeObserver(()=>{
  const box=$('#echoes-scroll'),width=box.clientWidth,height=box.clientHeight;
  if(!height||(width===echoWidth&&height===echoHeight))return;
  if(width!==echoWidth){if(state.echoSel!=null)state.echoCenterIndex=state.echoSel;else state.echoInitialCentered=false}
  echoWidth=width;echoHeight=height;renderEchoes();
}).observe($('#echoes-scroll'));
function selectEcho(i){
  state.echoSel=i;state.echoPanel=i;state.echoCenterIndex=i;
  renderEchoes();
}
async function loadEchoes(){
  const serial=state.echoSerial=(state.echoSerial||0)+1;
  try{
    if(!state.catalog)return;
    const d=await state.catalog.influence(params());if(serial!==state.echoSerial)return;
    const oldName=state.echoes?.musicians[state.echoSel]?.name;
    state.echoes=d;
    state.echoOrder=d.musicians.map((_,i)=>i).sort((a,b)=>(d.musicians[a].year??9999)-(d.musicians[b].year??9999)||d.musicians[a].name.localeCompare(d.musicians[b].name));
    state.echoSel=oldName?d.musicians.findIndex(m=>m.name===oldName):null;
    if(state.echoSel===-1)state.echoSel=null;
    state.echoPanel=state.echoSel;
    if(state.echoSel==null)state.echoInitialCentered=false;
    $('#echo-musicians').innerHTML=d.musicians.map(m=>`<option value="${esc(m.name)}"></option>`).join('');
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
    <div class="score-body"><div class="score-scroll" role="region" tabindex="0" aria-label="Scrollable score for ${esc(solo.performer)} playing ${esc(solo.title)}"><div class="score-paper" id="score-${id}-${side}" role="img" aria-label="Staff notation for ${esc(solo.performer)} playing ${esc(solo.title)}"></div></div></div>
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
    const aText=a?pitchLabel(a.pitch):'Skipped';
    const bText=b?pitchLabel(b.pitch):'Skipped';
    const result=paired?'Paired':a?'No matching note in B':'No matching note in A';
    return `<tr class="${paired?'':'alignment-gap'}"><th scope="row">${index+1}</th><td>${esc(aText)}</td><td>${esc(bText)}</td><td>${result}</td></tr>`;
  }).join('');
  const skipped=d.alignment.filter(([a,b])=>a<0||b<0).length;
  return `<section class="alignment-panel" aria-labelledby="alignment-title">
      <h3 id="alignment-title">Note-by-note alignment</h3>
      <p>Each row shows how notes were paired. ${skipped?`${skipped} extra note${skipped===1?' was':'s were'} skipped.`:'No notes were skipped.'}</p>
      <div class="alignment-table-scroll" tabindex="0" aria-label="Scrollable note alignment table">
        <table class="alignment-table"><caption>${d.alignment.length} alignment steps between passages A and B</caption><thead><tr><th scope="col">Step</th><th scope="col">A · ${esc(d.a.performer)}</th><th scope="col">B · ${esc(d.b.performer)}</th><th scope="col">Alignment</th></tr></thead><tbody>${rows}</tbody></table>
      </div>
    </section>`;
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
  return `<div class="album-visual" data-side="${side}"><div class="album-placeholder" aria-hidden="true"></div>${photo?`<img class="album-art" src="${esc(photo.url)}" alt="${portrait?`Photo of ${esc(s.performer)}; album cover unavailable`:`Album cover for ${esc(s.album||s.title)}`}" onerror="this.hidden=true">`:''}</div>`;
}

function artistPanel(d,side){
  const s=d[side];
  const recordingUrl=s.musicbrainz_id?`https://musicbrainz.org/recording/${encodeURIComponent(s.musicbrainz_id)}`:'';
  const trackName=recordingUrl?`<a class="track-link" href="${recordingUrl}" target="_blank" rel="noopener noreferrer">${esc(s.title)} <span aria-hidden="true">↗</span></a>`:esc(s.title);
  return `<article class="artist-panel ${side}">
    <div class="artist-visual">${albumVisual(s,side)}</div>
    <div class="artist-info"><header class="artist-heading"><div class="side-tag">${side.toUpperCase()}</div><div><h3>${esc(s.performer)}</h3><p class="artist-meta">${esc(s.recording_date||s.year||'Date unknown')}</p></div></header>
      <div class="track-heading"><div><h4>${trackName}</h4>${s.album?`<p>${esc(s.album)}</p>`:''}</div></div>
      ${scorePanel(d[`${side}_notes`],side,d.id,s)}
      ${mediaSection(d,side)}</div>
  </article>`;
}

function detailHTML(d){
  return `<div class="pair-card"><header class="pair-card-head"><div><p class="small-caps">A closer listen</p><h2 id="pair-dialog-title">${esc(d.a.performer)} <em>↔</em> ${esc(d.b.performer)}</h2></div><button type="button" class="dialog-close" data-close-pair aria-label="Close pair detail">×</button></header>
    <div class="pair-split">${artistPanel(d,'a')}${artistPanel(d,'b')}</div>
    <div class="pair-card-score"><div class="paired-stat"><div class="paired-stat-top"><strong>${d.notes}</strong><button type="button" class="alignment-toggle" data-toggle-alignment aria-expanded="false" aria-controls="alignment-panel-${d.id}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l12-2v13M9 10l12-2"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>Compare notes</button></div><span>paired notes</span></div><div><strong>${pct(d.similarity)}</strong><span>similarity</span></div><div><strong>${d.gaps}</strong><span>extra notes</span></div></div>
    <div class="alignment-score-cell" id="alignment-panel-${d.id}" hidden>${alignmentPanel(d)}</div>
    <footer class="pair-card-foot"><span>${esc(d.a.recording_date||'unknown')} · ${esc(d.b.recording_date||'unknown')}</span></footer>
  </div>`;
}

async function pairURL(id){
  const key=await state.catalog?.pairKey(id);
  if(!key)return null;
  const url=new URL(location.href);
  url.searchParams.set('pair',key);
  url.hash='';
  return url;
}
function clearPairURL(){
  const url=new URL(location.href);
  if(!url.searchParams.has('pair'))return;
  url.searchParams.delete('pair');
  history.replaceState(null,'',url);
}
async function toggleDetail(buttonOrId){
  const id=typeof buttonOrId==='number'?buttonOrId:Number(buttonOrId.dataset.match),dialog=$('#pair-dialog');
  state.lastTrigger=typeof buttonOrId==='number'?null:buttonOrId;
  const url=await pairURL(id);
  if(url)history.replaceState(null,'',url);
  state.openId=id;dialog.innerHTML='<div class="pair-loading">Reading both passages…</div>';
  if(!dialog.open)dialog.showModal();
  try{const detail=await state.catalog.detail(id);state.details[id]=detail;if(state.openId===id){dialog.innerHTML=detailHTML(detail);renderScores(detail)}}catch(err){dialog.innerHTML=`<div class="pair-loading"><strong>Could not open this pair.</strong><p>${esc(err.message)}</p><button type="button" class="drawer-done" data-close-pair>Close</button></div>`}
}

async function playTranscript(notes,{owner=null,onStateChange=()=>{}}={}){
  if(!notes?.length)return false;
  const Context=window.AudioContext||window.webkitAudioContext;
  if(!Context){toast('Audio playback is unavailable in this browser');return false}
  stopTranscript();
  if(!state.audio)state.audio=new Context();
  const revision=state.playbackRevision;
  await state.audio.resume();
  if(revision!==state.playbackRevision)return false;
  state.playback={owner,onStateChange,mode:'playing'};
  const start=state.audio.currentTime+.08,first=notes[0].onset;
  let finalSource=null,finalTime=-Infinity;
  for(const note of notes){
    const oscillator=state.audio.createOscillator(),gain=state.audio.createGain();
    const at=start+Math.max(0,note.onset-first),duration=Math.max(.07,Math.min(note.duration,.8));
    oscillator.type='triangle';oscillator.frequency.value=440*Math.pow(2,(note.pitch-69)/12);
    gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(.18,at+.018);
    gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
    oscillator.connect(gain).connect(state.audio.destination);oscillator.start(at);oscillator.stop(at+duration+.02);
    state.sources.push(oscillator);
    if(at+duration>finalTime){finalTime=at+duration;finalSource=oscillator}
  }
  if(finalSource)finalSource.onended=()=>{if(revision===state.playbackRevision)stopTranscript()};
  onStateChange('playing');
  return true;
}
function stopTranscript(){state.playbackRevision++;for(const source of state.sources){try{source.stop()}catch{}}state.sources=[];const playback=state.playback;state.playback=null;playback?.onStateChange('stopped')}
async function pauseTranscript(){const playback=state.playback;if(playback?.mode!=='playing')return;await state.audio.suspend();if(state.playback===playback){playback.mode='paused';playback.onStateChange('paused')}}
async function resumeTranscript(){const playback=state.playback;if(playback?.mode!=='paused')return;await state.audio.resume();if(state.playback===playback){playback.mode='playing';playback.onStateChange('playing')}}
function setCatalogPlayButton(button,mode){if(!button.isConnected)return;button.dataset.playLabel??=button.getAttribute('aria-label');button.dataset.playing=String(mode==='playing');button.setAttribute('aria-label',mode==='playing'?button.dataset.playLabel.replace(/^Play /,'Pause '):mode==='paused'?button.dataset.playLabel.replace(/^Play /,'Resume '):button.dataset.playLabel);button.title=mode==='playing'?'Pause MIDI transcription':mode==='paused'?'Resume MIDI transcription':'Play MIDI transcription';button.querySelector('span').textContent=mode==='playing'?'❚❚':'▶'}
window.StolenMoments={playTranscript,pausePlayback:pauseTranscript,resumePlayback:resumeTranscript,stopPlayback:stopTranscript,getPlaybackState:owner=>state.playback?.owner===owner?state.playback.mode:'stopped'};

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
  if(event.target.closest('#echo-search-toggle'))setEchoSearchOpen($('#echo-search-field').hidden);
  else if(!event.target.closest('#echo-search-field'))setEchoSearchOpen(false);
  if(event.target.closest('#echo-overview')){state.echoSel=null;state.echoPanel=null;state.echoCenterIndex=null;state.echoInitialCentered=false;$('#echo-search').value='';renderEchoes()}
  const echoZoom=event.target.closest('[data-echo-zoom]');if(echoZoom){state.echoZoom=Math.max(.8,Math.min(1.4,(state.echoZoom||1)+(echoZoom.dataset.echoZoom==='in'?.2:-.2)));renderEchoes()}
  const echo=event.target.closest('[data-echo]');if(echo)selectEcho(Number(echo.dataset.echo));
  const viewBtn=event.target.closest('[data-view-btn]');if(viewBtn)setView(viewBtn.dataset.viewBtn);
  const match=event.target.closest('[data-match]');if(match){event.preventDefault();toggleDetail(match)}
  const alignmentToggle=event.target.closest('[data-toggle-alignment]');if(alignmentToggle){const panel=document.getElementById(alignmentToggle.getAttribute('aria-controls'));const open=panel.hidden;panel.hidden=!open;alignmentToggle.setAttribute('aria-expanded',String(open))}
  const play=event.target.closest('[data-play]');if(play){const d=state.details[Number(play.dataset.detail)];if(d){const mode=window.StolenMoments.getPlaybackState(play);if(mode==='playing')pauseTranscript();else if(mode==='paused')resumeTranscript();else playTranscript(d[`${play.dataset.play}_notes`],{owner:play,onStateChange:next=>setCatalogPlayButton(play,next)})}}
  if(event.target.closest('[data-close-pair]'))$('#pair-dialog').close();
});
document.addEventListener('keydown',event=>{const match=event.target.closest('[data-match]');if(match&&(event.key==='Enter'||event.key===' ')){event.preventDefault();toggleDetail(match)}});
let debounce;
$('#facet-search').addEventListener('input',renderShelf);
function setEchoSearchOpen(open){$('#echo-search-field').hidden=!open;$('#echo-search-toggle').setAttribute('aria-expanded',String(open));if(open)$('#echo-search').focus()}
function findEchoMusician(){const value=$('#echo-search').value.trim().toLowerCase(),d=state.echoes;if(!value||!d)return;let i=d.musicians.findIndex(m=>m.name.toLowerCase()===value);if(i<0)i=d.musicians.findIndex(m=>m.name.toLowerCase().startsWith(value));if(i>=0){selectEcho(i);setEchoSearchOpen(false)}}
$('#echo-search').addEventListener('change',findEchoMusician);
$('#echo-search').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();findEchoMusician()}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){setEchoSearchOpen(false);for(const [panel,btn] of [['#crate-options','#open-shelf'],['#sort-options','#open-sort']]){$(panel).hidden=true;$(btn).setAttribute('aria-expanded','false')}}});
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

async function openDesk({instant=false,scrollToCrate=true}={}){
  if(deskPhase!=='closed')return;
  deskPhase='opening';
  desk.dataset.phase='opening';
  $('#enter-atlas').disabled=true;
  $('[data-lift-lid]').disabled=true;
  $('.landing-intro').inert=true;
  if(instant)renderLid(1);else await animateLid(true);
  deskPhase='open';
  desk.dataset.phase='open';
  document.body.classList.add('atlas-open');
  $('.landing-intro').hidden=true;
  $('#enter-atlas').hidden=true;
  $('.archive-content').hidden=false;
  $('.archive-content').inert=false;
  $('.desk-actions').inert=false;
  $('#desk-status').textContent='The lid is open.';
  if(scrollToCrate)bringCrateIntoView();
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
$('#pair-dialog').addEventListener('close',()=>{stopTranscript();state.openId=null;clearPairURL();if(state.lastTrigger?.isConnected)state.lastTrigger.focus();else $('#crate-strip .crate-card')?.focus()});

async function init(){
  const perf=()=>new URLSearchParams(location.search).has('perf');
  if(perf())performance.mark('sm:app-start');
  updateOutputs();
  const requestedPair=new URLSearchParams(location.search).get('pair');
  if(location.hash==='#explore'||requestedPair){
    await openDesk({instant:!!requestedPair,scrollToCrate:false});
    $('#explore').scrollIntoView({behavior:'instant'});
  }
  try{const portraits=await fetch('artist-portraits.json');if(portraits.ok)state.portraits=await portraits.json()}catch{}
  try{setView(localStorage.getItem('atlas-view')==='echoes'?'echoes':'crate')}catch{}
  try{
    state.catalog=await loadCatalog();
    if(perf())performance.mark('sm:catalog-ready');
    await load();
    if($('.results-area').dataset.view==='echoes')loadEchoes();
    if(requestedPair){
      const id=await state.catalog.findPairKey(requestedPair);
      if(id===null){clearPairURL();toast('This pair link is no longer available. Browse the archive.')}else toggleDetail(id);
    }
  }catch(err){const message=location.protocol==='file:'?'Open this site over HTTP, for example with `python3 -m http.server 8766 -d static`.':err.message;$('#crate-strip').innerHTML=`<div class="empty"><strong>Could not open the atlas.</strong>${esc(message)}</div>`}
}
init();
