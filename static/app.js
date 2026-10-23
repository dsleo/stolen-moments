const API_ORIGIN = location.protocol === 'file:' ? 'http://127.0.0.1:8766' : '';
const apiURL = path => `${API_ORIGIN}${path}`;
const state = {scope:'all',composition:'distinct',collection:'all',max_edits:1,offset:0,openId:null,lastTrigger:null,loading:false,request:0,details:{},audio:null,sources:[],items:[],decade:'',instrument:'',facetKind:'decade',facetData:null};
const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct = n => `${Math.round(n*100)}%`;
const sec = n => {const t=Math.max(0,Math.round(n));return `${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`};
const initials = name => String(name||'?').split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join('').toUpperCase();
const recordingLink = (item,side) => {
  const s=item[side],recording=item[`recording_${side}`],time=item[`${side}_track_time`];
  const label=side.toUpperCase();
  return `<span class="recording-action"><span class="recording-time">${label} · ${sec(time)} in source track</span>${recording?
    `<a href="${esc(recording.url)}" target="_blank" rel="noopener noreferrer">${recording.verified?'▶ Verified recording':recording.aligned?'▶ JazzTube video':recording.estimated?'▶ Video near motif':'▶ Candidate video'} ↗</a>`:
    `<span class="no-video">No matched video yet</span>`}</span>`;
};
const params = () => ({scope:state.scope,composition:state.composition,collection:state.collection,max_edits:state.max_edits,
  min_notes:$('#min_notes').value,min_pitch:Number($('#min_pitch').value)/100,
  min_rhythm:Number($('#min_rhythm').value)/100,min_distinct:Number($('#min_distinct').value)/100,
  performer:$('#performer').value,decade:state.decade,instrument:state.instrument,sort:$('#sort').value,limit:50,offset:state.offset});
const query = p => new URLSearchParams(p).toString();
let toastTimer;
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3600)}

function updateOutputs(){
  $('#min_notes_value').textContent=$('#min_notes').value+'+';
  for(const id of ['min_pitch','min_rhythm','min_distinct']) $(`#${id}_value`).textContent=$(`#${id}`).value+'%';
  for(const input of document.querySelectorAll('input[type=range]')){
    const q=(Number(input.value)-Number(input.min))/(Number(input.max)-Number(input.min))*100;
    input.style.background=`linear-gradient(to right, #a54d32 0%, #a54d32 ${q}%, #c9ccbd ${q}%, #c9ccbd 100%)`;
  }
}

function histogram(counts){
  const max=Math.max(...counts,1);
  $('#histogram').innerHTML=counts.map((n,i)=>`<div class="histogram-bar" style="height:${Math.max(3,n/max*100)}%" title="Scores ${i*10}–${i*10+9}: ${n.toLocaleString()} passages"></div>`).join('');
}

async function load(append=false){
  const serial=++state.request;
  state.loading=true;
  if(!append)refreshFacets(serial);
  try{
    const response=await fetch(apiURL('/api/matches?'+query(params())));
    if(!response.ok)throw new Error((await response.json()).error||'Search failed');
    const data=await response.json();
    if(serial!==state.request)return;
    $('#result-count').textContent=data.total.toLocaleString();
    $('#result-context').textContent=`${data.total.toLocaleString()} of ${data.unfiltered_total.toLocaleString()} indexed passage pairs meet these controls`;
    histogram(data.histogram);
    if(!append)state.items=[];state.items.push(...data.items);renderCrate(data.items,append);
    if(!append&&!data.items.length)$('#crate-strip').innerHTML='<div class="empty"><strong>No passages at this setting.</strong>Lower a threshold or include the same tune to broaden the search.</div>';
    $('#list-footer').innerHTML=data.next_offset!==null?'<button id="load-more" type="button" class="load-more">Show more passages ↓</button>':'';
    if(data.next_offset!==null)$('#load-more').addEventListener('click',()=>{state.offset=data.next_offset;load(true)});
  }catch(err){if(serial===state.request){$('#crate-strip').innerHTML=`<div class="empty"><strong>Search unavailable.</strong>${esc(err.message)}</div>`;toast(err.message)}}
  finally{if(serial===state.request)state.loading=false}
}

const hue = name => [...String(name||'')].reduce((h,c)=>(h*31+c.charCodeAt(0))%360,7);
const coverSrc = s => apiURL('/api/cover-image?'+new URLSearchParams({performer:s.performer||'',album:s.album||s.title||'',title:s.title||''}));
// Typographic sleeve underneath; the real cover (if the archive finds one) covers it.
const sleeve = (s,side) => `<span class="sleeve ${side}" style="--h:${hue(s.performer)}"><span class="sleeve-fallback">${esc(initials(s.performer))}<small>${esc(s.title)}</small></span><img loading="lazy" decoding="async" alt="" src="${esc(coverSrc(s))}"></span>`;
const crateCard = item => `<button type="button" class="crate-card" role="listitem" data-pull="${item.id}" aria-pressed="false" aria-label="Pull ${esc(item.a.performer)} and ${esc(item.b.performer)}"><span class="sleeves">${sleeve(item.a,'a')}${sleeve(item.b,'b')}</span><span class="crate-names">${esc(item.a.performer)} ↔ ${esc(item.b.performer)}</span><span class="crate-score">${item.heuristic_score.toFixed(1)} · ${item.notes} notes</span></button>`;
function renderCrate(items,append){
  const strip=$('#crate-strip');
  if(!append){strip.innerHTML='';strip.scrollLeft=0;$('#stage').className='stage';$('#stage').innerHTML='<p>Pull a pair from the crate to see both sleeves.</p>'}
  strip.insertAdjacentHTML('beforeend',items.map(crateCard).join(''));
}
function pullPair(id){
  const item=state.items.find(x=>x.id===id);if(!item)return;
  document.querySelectorAll('.crate-card').forEach(c=>c.setAttribute('aria-pressed',String(Number(c.dataset.pull)===id)));
  const stage=$('#stage');stage.className='stage has-pair';
  stage.innerHTML=`<button type="button" class="stage-open" data-match="${id}" aria-haspopup="dialog" aria-label="Open ${esc(item.a.performer)} and ${esc(item.b.performer)}">${sleeve(item.a,'a')}<span class="stage-x" aria-hidden="true">↔</span>${sleeve(item.b,'b')}</button>
    <h3>${esc(item.a.performer)} <em>↔</em> ${esc(item.b.performer)}</h3>
    <p>${esc(item.a.title)} · ${sec(item.a_track_time)} &nbsp;/&nbsp; ${esc(item.b.title)} · ${sec(item.b_track_time)}</p>
    <p>${item.notes} notes · ${pct(item.pitch_similarity)} pitch · ${pct(item.rhythm_similarity)} rhythm</p>
    <button type="button" class="drawer-done" data-match="${id}" aria-haspopup="dialog">Hear this pair ↗</button>`;
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
  const nodes=m.map((p,i)=>`<button type="button" class="echo-node${sel!=null&&sel!==i&&!linked.has(i)?' dim':''}" style="left:${x[i]}px;top:${y0}px" data-echo="${i}" aria-pressed="${sel===i}">${sleeve({performer:p.name,album:p.album,title:p.title},'a')}<span>${esc(p.name)}</span></button>`).join('');
  const H=y0+NODE_H+ARC_H+8,box=$('#echoes-scroll'),left=box.scrollLeft;
  box.innerHTML=`<div class="echo-canvas" style="width:${width}px;height:${H}px"><svg width="${width}" height="${H}" aria-label="Arcs from earlier to later musicians">${years}${arcs}</svg>${nodes}</div>`;
  box.scrollLeft=sel==null?left:Math.max(0,x[sel]-box.clientWidth/2);
  $('#echoes-note').textContent=sel==null?`Strongest ${shown.length} echoes, earlier player to later one. Pick a musician to see theirs. ${d.undirected} same-year pairs are left out.`:'';
  renderEchoPanel(sel);
}
function renderEchoPanel(sel){
  const d=state.echoes,m=d.musicians,panel=$('#echoes-panel');
  if(sel==null){panel.innerHTML='';return}
  const list=(ls,other)=>ls.length?`<ol>${[...ls].sort((a,b)=>b.strength-a.strength).slice(0,10).map(l=>`<li><button type="button" data-match="${l.top_id}"><span>${esc(m[l[other]].name)}</span><small>${l.pairs} pair${l.pairs===1?'':'s'}</small></button></li>`).join('')}</ol>`:'<p>None at these settings.</p>';
  panel.innerHTML=`<h3>${esc(m[sel].name)}</h3><p>${m[sel].solos} solos · c. ${m[sel].year??'?'}</p><h4>Echoes (earlier players)</h4>${list(d.links.filter(l=>l.to===sel),'from')}<h4>Echoed by (later players)</h4>${list(d.links.filter(l=>l.from===sel),'to')}`;
}
let echoHeight=0;
new ResizeObserver(()=>{const h=$('#echoes-scroll').clientHeight;if(h&&h!==echoHeight){echoHeight=h;renderEchoes()}}).observe($('#echoes-scroll'));
async function loadEchoes(){
  const serial=state.echoSerial=(state.echoSerial||0)+1;
  try{
    const res=await fetch(apiURL('/api/influence?'+query(params())));if(!res.ok)throw new Error('Echoes unavailable');
    const d=await res.json();if(serial!==state.echoSerial)return;
    state.echoes=d;
    state.echoOrder=d.musicians.map((_,i)=>i).sort((a,b)=>(d.musicians[a].year??9999)-(d.musicians[b].year??9999)||d.musicians[a].name.localeCompare(d.musicians[b].name));
    if(state.echoSel!=null&&state.echoSel>=d.musicians.length)state.echoSel=null;
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

const INSTRUMENTS={ts:'Tenor sax',as:'Alto sax',ss:'Soprano sax',bs:'Baritone sax',tp:'Trumpet',tb:'Trombone',cl:'Clarinet',p:'Piano',g:'Guitar',vib:'Vibraphone',b:'Bass',fl:'Flute',cor:'Cornet',bcl:'Bass clarinet',voc:'Voice'};
const FACETS={decade:{label:'Decade',name:v=>`${v}s`},instrument:{label:'Instrument',name:v=>INSTRUMENTS[v]||v.toUpperCase()},performer:{label:'Musician',name:v=>v}};
const facetValue = kind => kind==='performer'?$('#performer').value:state[kind];
async function refreshFacets(serial){
  try{const res=await fetch(apiURL('/api/facets?'+query(params())));if(!res.ok)return;const data=await res.json();if(serial===state.request){state.facetData=data;renderShelf()}}catch{}
}
function renderShelf(){
  const data=state.facetData;if(!data)return;
  document.querySelectorAll('[data-facet-kind]').forEach(b=>{const k=b.dataset.facetKind;b.setAttribute('aria-pressed',String(k===state.facetKind));b.classList.toggle('has-pick',!!facetValue(k))});
  const kind=state.facetKind,current=String(facetValue(kind)),{name}=FACETS[kind];
  const chip=(value,label,count)=>`<button type="button" class="shelf-chip" data-facet-value="${esc(value)}" aria-pressed="${String(value)===current}">${esc(label)}${count==null?'':` <small>${count.toLocaleString()}</small>`}</button>`;
  $('#shelf-chips').innerHTML=chip('','All',null)+data[kind].map(([v,n])=>chip(v,name(v),n)).join('');
  const picks=Object.keys(FACETS).filter(k=>facetValue(k)).map(k=>FACETS[k].name(facetValue(k)));
  $('#crate-label').textContent='The crate · '+(picks.length?picks.join(' · '):'flick sideways, pull a record');
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
  const differences=notes.slice(1).map((n,i)=>Math.max(.125,n.beat-notes[i].beat));
  const fallback=differences.length?[...differences].sort((a,b)=>a-b)[Math.floor(differences.length/2)]:.5;
  const body=notes.map((note,i)=>{
    const length=Math.max(1,Math.min(32,Math.round((differences[i]??fallback)*4)));
    return `${abcPitch(note.pitch,accidentals)}${length===1?'':length}`;
  }).join(' ');
  const pitches=notes.map(n=>n.pitch).sort((a,b)=>a-b);
  const clef=pitches[Math.floor(pitches.length/2)]<57?'bass':'treble';
  return `X:1\nM:none\nL:1/16\nK:C clef=${clef}\n${body}`;
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
  return `<div class="panel-listen"><div class="listen-links">${recording?`<a class="youtube-link" href="${esc(recording.url)}" target="_blank" rel="noopener noreferrer"><span class="youtube-mark">▶</span> ${recording.verified?'Play verified recording':recording.aligned?'Play JazzTube video':recording.estimated?'Play likely recording':'Open candidate video'} ↗</a>`:s.source==='WJazzD'?`<button type="button" class="find-video" data-find-video="${s.trackid}" data-match-id="${d.id}">Check for a video</button>`:'<span class="no-video">No matched video</span>'}${provenance}</div>
  </div>`;
}

function albumVisual(s,side){
  const query=new URLSearchParams({performer:s.performer||'',album:s.album||s.title||'',title:s.title||''});
  return `<div class="album-visual" data-side="${side}"><div class="album-placeholder" aria-hidden="true"></div><img class="album-art" src="${esc(apiURL(`/api/cover-image?${query}`))}" alt="Album cover for ${esc(s.album||s.title)}" onerror="this.hidden=true"><div class="album-credit" aria-hidden="true"></div></div>`;
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
  const hasDTL=d.a.source==='DTL1000'||d.b.source==='DTL1000';
  return `<div class="pair-card"><header class="pair-card-head"><div><p class="small-caps">A closer listen</p><h2 id="pair-dialog-title">${esc(d.a.performer)} <em>↔</em> ${esc(d.b.performer)}</h2></div><button type="button" class="dialog-close" data-close-pair aria-label="Close pair detail">×</button></header>
    ${d.periodicity>.62?'<p class="pair-note">This passage repeats a short cell. Its ranking is reduced because loops can match by chance.</p>':''}
    <div class="pair-split">${artistPanel(d,'a')}${artistPanel(d,'b')}</div>
    <div class="pair-card-score"><div><strong>${d.notes}</strong><span>matched notes</span></div><div><strong>${pct(d.pitch_similarity)}</strong><span>pitch agreement</span></div><div><strong>${pct(d.rhythm_similarity)}</strong><span>rhythm agreement</span></div><div><strong>${d.heuristic_score.toFixed(1)}</strong><span>ranking score</span></div></div>
    <footer class="pair-card-foot"><span>${hasDTL?`${esc(d.a.source)} · ${esc(d.b.source)}`:`WJazzD source note IDs: ${d.a_notes.map(n=>n.eventid).join(', ')} / ${d.b_notes.map(n=>n.eventid).join(', ')}.`}</span><span>${esc(d.a.recording_date||'unknown')} · ${esc(d.b.recording_date||'unknown')}</span></footer>
  </div>`;
}

async function toggleDetail(button){
  const id=Number(button.dataset.match),dialog=$('#pair-dialog');
  state.lastTrigger=button;
  state.openId=id;dialog.innerHTML='<div class="pair-loading">Reading both passages…</div>';
  if(!dialog.open)dialog.showModal();
  try{const res=await fetch(apiURL(`/api/matches/${id}`));if(!res.ok)throw new Error('Could not load passage');const detail=await res.json();state.details[id]=detail;if(state.openId===id){dialog.innerHTML=detailHTML(detail);renderScores(detail)}}catch(err){dialog.innerHTML=`<div class="pair-loading"><strong>Could not open this pair.</strong><p>${esc(err.message)}</p><button type="button" class="drawer-done" data-close-pair>Close</button></div>`}
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

async function submitJSON(url,data){const res=await fetch(apiURL(url),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const body=await res.json();if(!res.ok)throw new Error(body.error||'Could not save');return body}

document.addEventListener('click',event=>{
  const seg=event.target.closest('.segmented button');
  if(seg){const group=seg.closest('.segmented');group.querySelectorAll('button').forEach(b=>b.classList.toggle('selected',b===seg));state[group.dataset.name]=group.dataset.name==='max_edits'?Number(seg.dataset.value):seg.dataset.value;resetSearch()}
  const facetKind=event.target.closest('[data-facet-kind]');if(facetKind){state.facetKind=facetKind.dataset.facetKind;renderShelf()}
  const facetChip=event.target.closest('[data-facet-value]');if(facetChip)pickFacet(facetChip.dataset.facetValue);
  const pull=event.target.closest('[data-pull]');if(pull)pullPair(Number(pull.dataset.pull));
  const echo=event.target.closest('[data-echo]');if(echo){const i=Number(echo.dataset.echo);state.echoSel=state.echoSel===i?null:i;renderEchoes()}
  const viewBtn=event.target.closest('[data-view-btn]');if(viewBtn)setView(viewBtn.dataset.viewBtn);
  const match=event.target.closest('[data-match]');if(match){event.preventDefault();toggleDetail(match)}
  const play=event.target.closest('[data-play]');if(play){const d=state.details[Number(play.dataset.detail)];if(d)playTranscript(d[`${play.dataset.play}_notes`])}
  const find=event.target.closest('[data-find-video]');if(find){find.disabled=true;find.textContent='Checking recording…';submitJSON('/api/discover-video',{trackid:Number(find.dataset.findVideo)}).then(async result=>{toast(result.found?'Video found; opening updated passage':'No reliable video match found');await load();if(state.details[Number(find.dataset.matchId)])toggleDetail(document.querySelector(`[data-match="${find.dataset.matchId}"]`))}).catch(err=>{toast(err.message);find.disabled=false;find.textContent='Check for a video'})}
  if(event.target.closest('[data-close-settings]'))$('#settings-dialog').close();
  if(event.target.closest('[data-close-pair]'))$('#pair-dialog').close();
});
let debounce;
for(const id of ['min_notes','min_pitch','min_rhythm','min_distinct'])$('#'+id).addEventListener('input',()=>{updateOutputs();clearTimeout(debounce);debounce=setTimeout(resetSearch,150)});
$('#performer').addEventListener('change',resetSearch);$('#sort').addEventListener('change',resetSearch);
$('#collection').addEventListener('change',()=>{state.collection=$('#collection').value;resetSearch()});
$('#reset').addEventListener('click',()=>{
  for(const [id,value] of Object.entries({min_notes:9,min_pitch:80,min_rhythm:45,min_distinct:40}))$('#'+id).value=value;
  $('#performer').value='';$('#sort').value='score';$('#collection').value='all';state.scope='all';state.composition='distinct';state.collection='all';state.max_edits=1;state.decade='';state.instrument='';
  document.querySelectorAll('.segmented').forEach(group=>group.querySelectorAll('button').forEach(button=>button.classList.toggle('selected',String(state[group.dataset.name])===button.dataset.value)));
  updateOutputs();resetSearch();
});
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
  $('#open-tonearm').inert=false;
  $('#open-tonearm').focus({preventScroll:true});
  $('#desk-status').textContent='The lid is open. Select the stylus to tune the search.';
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
  $('#open-tonearm').inert=true;
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
$('#open-tonearm').addEventListener('click',()=>$('#settings-dialog').showModal());
$('#settings-dialog').addEventListener('click',event=>{if(event.target===$('#settings-dialog'))$('#settings-dialog').close()});
$('#pair-dialog').addEventListener('click',event=>{if(event.target===$('#pair-dialog'))$('#pair-dialog').close()});
$('#pair-dialog').addEventListener('close',()=>{state.openId=null;if(state.lastTrigger?.isConnected)state.lastTrigger.focus()});

async function init(){
  updateOutputs();
  try{setView(localStorage.getItem('atlas-view')==='echoes'?'echoes':'crate')}catch{}
  try{const res=await fetch(apiURL('/api/bootstrap'));if(!res.ok)throw new Error('Index unavailable');const data=await res.json();
    const collections=data.corpus.collections||{WJazzD:data.corpus.solos};
    if(collections.DTL1000){
      $('#footer-source').textContent='Sources: WJazzD v2.1 + DTL1000';
      $('#method-rhythm').textContent='“Matched notes” counts the aligned phrase. Pitch agreement measures interval matches after limited edits. Rhythm agreement compares beat spacing for WJazzD pairs and tempo-adjusted note spacing when DTL1000 is involved. Distinctiveness reflects how widely the seed appears across both collections. The score excerpts show stored pitches with approximate note values.';
      $('#dtl-method').hidden=false;$('#dtl-method-link').hidden=false;$('#collection-control').hidden=false;
    }
    $('#performer').insertAdjacentHTML('beforeend',data.performers.map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join(''));
    await load();
  }catch(err){const message=location.protocol==='file:'?'Start the local server with `python3 -m jazzmine serve --port 8766`, then reload this file.':err.message;$('#crate-strip').innerHTML=`<div class="empty"><strong>Could not open the atlas.</strong>${esc(message)}</div>`}
}
init();
