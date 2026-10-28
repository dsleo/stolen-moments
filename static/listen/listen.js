import {CaptureSession} from './audio-capture.js';

const $=id=>document.getElementById(id);
const dialog=$('listen-dialog');
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const formatTime=seconds=>`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
const pitchName=n=>`${['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'][((n%12)+12)%12]}${Math.floor(n/12)-1}`;
const INSTRUMENTS={ts:'Tenor sax',as:'Alto sax',ss:'Soprano sax',bs:'Baritone sax',tp:'Trumpet',tb:'Trombone',cl:'Clarinet',p:'Piano',g:'Guitar',vib:'Vibraphone',b:'Bass',fl:'Flute',cor:'Cornet',bcl:'Bass clarinet',voc:'Voice'};
const state={mode:'idle',sessionId:0,requestId:0,capture:null,transcriber:null,liveTracker:null,searcher:null,notes:[],liveNotes:[],results:[],blobUrl:null,debugData:{},ticker:null,liveTicker:null,inFlight:false,pending:false,finishing:false,pendingRequests:new Set(),liveStarted:0,lastWindow:0,lastSupported:0,stable:null,candidateResult:null,candidateCount:0,trigger:null,progressStage:null,phraseRevision:0};
const debugEnabled=new URLSearchParams(location.search).has('listenDebug');
$('listen-debug').hidden=!debugEnabled;
function updateDebug(patch){if(!debugEnabled)return;Object.assign(state.debugData,patch);$('listen-debug-text').textContent=JSON.stringify(state.debugData,null,2)}

function setStatus(message,mode=state.mode){state.mode=mode;dialog.dataset.mode=mode;$('listen-status').textContent=message;const active=mode==='recording'||mode==='live';$('listen-stop').hidden=!active;$('listen-cancel').hidden=mode==='idle'||mode==='results'||mode==='empty';$('listen-clear').hidden=!(mode==='results'||mode==='empty'||mode==='error');const controls=document.querySelector('.listen-controls');controls.hidden=[...controls.querySelectorAll('button')].every(button=>button.hidden);$('listen-record').disabled=active||mode==='transcribing'||mode==='searching';$('listen-example').disabled=active||mode==='transcribing'||mode==='searching';$('listen-file').disabled=active||mode==='transcribing'||mode==='searching';if(mode!=='transcribing'&&mode!=='searching')hideProgress()}
function hideProgress(){$('listen-progress').hidden=true;state.progressStage=null}
function showProgress(stage,fraction=null){const names={preparing:'Preparing audio…',loading:'Loading the note model…',transcribing:'Transcribing your phrase…','loading-corpus':'Opening the archive…',searching:'Comparing passages…'};const label=names[stage]||names.preparing;$('listen-progress').hidden=false;$('listen-progress-step').textContent=label;if(state.progressStage!==stage){state.progressStage=stage;$('listen-status').textContent=label}const track=$('listen-progress-track');if(stage==='transcribing'&&Number.isFinite(fraction)){const percent=Math.max(0,Math.min(100,Math.round(fraction*100)));track.setAttribute('aria-valuenow',String(percent));$('listen-progress-fill').style.width=`${percent}%`;$('listen-progress-percent').textContent=`${percent}%`}else{track.removeAttribute('aria-valuenow');$('listen-progress-fill').style.width='';$('listen-progress-percent').textContent=''}}
function fail(error){const message=error instanceof Error?error.message:String(error);setStatus(message||'Something went wrong. Please try again.','error')}
function meter(level){const value=Math.max(0,Math.min(100,Math.round((typeof level==='number'?level:level?.rms||0)*500)));$('listen-level').style.width=value+'%';document.querySelector('.listen-meter').setAttribute('aria-valuenow',String(value))}
function elapsed(){return (performance.now()-state.liveStarted)/1000}
function timer(){$('listen-time').textContent=formatTime(elapsed())}
function clearTimers(){clearInterval(state.ticker);clearInterval(state.liveTicker);state.ticker=null;state.liveTicker=null}
function stopPlayback(){window.StolenMoments?.stopPlayback?.()}
async function closeCapture(){const capture=state.capture;state.capture=null;if(capture)await capture.close();meter(0)}
async function cancelWork(){state.sessionId++;clearTimers();state.inFlight=false;state.pending=false;for(const reject of state.pendingRequests)reject(new Error('Analysis cancelled.'));state.pendingRequests.clear();await closeCapture();state.transcriber?.terminate();state.liveTracker?.terminate();state.searcher?.terminate();state.transcriber=null;state.liveTracker=null;state.searcher=null}
function clearPhrase(){state.phraseRevision++;stopPlayback();if(state.blobUrl)URL.revokeObjectURL(state.blobUrl);state.blobUrl=null;state.notes=[];state.liveNotes=[];state.results=[];state.stable=null;state.candidateResult=null;state.candidateCount=0;state.lastSupported=0;$('listen-note-preview').hidden=true;$('listen-your-score').replaceChildren();$('listen-preview-details').open=true;$('listen-note-summary').textContent='';$('listen-note-names').textContent='';$('listen-note-timings-list').replaceChildren();$('listen-downloads').hidden=true;$('listen-result-list').innerHTML='<p class="listen-empty">No passage has been searched yet.</p>';$('listen-result-count').textContent='';$('listen-result-explainer').hidden=true;document.querySelector('.listen-results').hidden=true;hideProgress()}
async function reset(){await cancelWork();clearPhrase();state.debugData={};updateDebug({});$('listen-time').textContent='00:00';setStatus('Ready when you are.','idle')}

function workerRequest(worker,type,payload,sessionId,transfer=[]){
  const requestId=++state.requestId;
  return new Promise((resolve,reject)=>{
    let settled=false;
    const cleanup=()=>{clearTimeout(timer);worker.removeEventListener('message',onMessage);worker.removeEventListener('error',onError);state.pendingRequests.delete(cancel)};
    const finish=(error,value)=>{if(settled)return;settled=true;cleanup();error?reject(error):resolve(value)};
    const cancel=error=>finish(error);
    const timer=setTimeout(()=>finish(new Error('The analysis took too long. Try a shorter phrase.')),60000);
    const onError=()=>finish(new Error('Background analysis stopped'));
    const onMessage=event=>{const data=event.data;if(!data||data.requestId!==requestId||data.sessionId!==sessionId)return;if(data.type==='progress'){if(sessionId===state.sessionId){const stage=data.payload?.stage||data.payload?.phase||'preparing';showProgress(stage,data.payload?.fraction)}return}if(data.type==='error')finish(new Error(data.payload?.message||data.payload?.error||'Analysis failed'));else if(data.type==='result')finish(null,data.payload)};
    state.pendingRequests.add(cancel);worker.addEventListener('message',onMessage);worker.addEventListener('error',onError);worker.postMessage({type,requestId,sessionId,payload},transfer);
  });
}
function modelWorker(){return state.transcriber??=new Worker(new URL('./assets/transcription-worker.bundle.js?v=cpu-3',import.meta.url))}
function liveWorker(){return state.liveTracker??=new Worker(new URL('./live-pitch-worker.js',import.meta.url),{type:'module'})}
function searchWorker(){return state.searcher??=new Worker(new URL('./retrieval-worker.js',import.meta.url),{type:'module'})}
function normalizedNotes(notes,durationSeconds){return notes.map((n,i)=>({pitch:n.pitch,onsetSeconds:n.onsetSeconds??n.onset,durationSeconds:n.durationSeconds??n.duration,confidence:n.confidence??null,originalIndex:n.originalIndex??i})).filter(n=>Number.isInteger(n.pitch)&&Number.isFinite(n.onsetSeconds)&&Number.isFinite(n.durationSeconds)&&n.onsetSeconds>=0&&n.onsetSeconds<durationSeconds&&n.durationSeconds>0).map(n=>({...n,durationSeconds:Math.min(n.durationSeconds,durationSeconds-n.onsetSeconds)})).sort((a,b)=>a.onsetSeconds-b.onsetSeconds).slice(-64)}
async function analyse(input,sessionId,{live=false,source='microphone'}={}){
  if(sessionId!==state.sessionId)return;
  if(!live){setStatus('Preparing audio…','transcribing');showProgress('preparing')}
  const {pcm,sampleRate,durationSeconds}=input;
  if(durationSeconds<2)throw new Error('Play for at least two seconds.');
  let peak=0,sum=0;for(let i=0;i<pcm.length;i++){const v=Math.abs(pcm[i]);peak=Math.max(peak,v);sum+=v*v}
  if(peak<.003&&Math.sqrt(sum/pcm.length)<.001)throw new Error('No clear sound detected. Try playing closer to the microphone.');
  const copy=new Float32Array(pcm);
  const transcription=await workerRequest(modelWorker(),'transcribe',{pcm:copy,sampleRate},sessionId,[copy.buffer]);
  if(sessionId!==state.sessionId)return;
  updateDebug({backend:transcription.backend,model:'@spotify/basic-pitch 1.0.1',rawNoteCount:transcription.rawNoteCount,retainedNoteCount:transcription.retainedNoteCount,transcriptionTimings:transcription.timings,sessionId});
  const notes=normalizedNotes(transcription.notes||[],durationSeconds);state.notes=notes;
  $('listen-note-preview').hidden=false;
  $('listen-downloads').hidden=!notes.length;
  $('listen-note-summary').textContent=(notes.length?`${notes.length} notes detected.`:'No distinct notes found in this recording.')+(transcription.retainedNoteCount>64?' Searching the latest 64 notes.':'')+(transcription.clipping?' Recording clipped; try a lower input level.':'');
  $('listen-note-names').textContent=notes.length?notes.map(n=>pitchName(n.pitch)).join(' · '):'';
  $('listen-note-timings-list').innerHTML=notes.map(n=>`<li>${escapeHTML(pitchName(n.pitch))} · ${n.onsetSeconds.toFixed(2)}s · ${n.durationSeconds.toFixed(2)}s long</li>`).join('');
  $('listen-play-detected').disabled=!notes.length;
  renderScore($('listen-your-score'),notes,'Your phrase');
  if(notes.length<8){if(!live){setStatus('Play a longer, clearer phrase with at least eight notes.','empty');renderResults([])}return}
  if(!live){setStatus('Looking through the archive…','searching');showProgress('searching')}
  const result=await workerRequest(searchWorker(),'search',{schemaVersion:1,requestId:state.requestId+1,source,audioDurationSeconds:durationSeconds,notes},sessionId);
  if(sessionId!==state.sessionId)return;
  updateDebug({algorithmVersion:result.algorithmVersion,candidateCount:result.candidateCount,searchTimings:result.timings,queryNoteCount:result.queryNoteCount,requestId:state.requestId});
  renderResults(result.results||[],{live});
  if(!live&&result.results?.length)$('listen-preview-details').open=false;
  if(!live)setStatus(result.results?.length?'Closest passages are ready.':'No convincing match found. Try a longer phrase. ',result.results?.length?'results':'empty');
}
function recordingURL(result){const rec=result.recording;if(!rec?.videoId)return null;const url=new URL('https://www.youtube.com/watch');url.searchParams.set('v',rec.videoId);if(Number.isFinite(result.recordingTimeSeconds))url.searchParams.set('t',`${Math.floor(result.recordingTimeSeconds)}s`);return url.href}
function renderResults(results,{live=false}={}){
  if(live){
    const first=results[0],previous=state.candidateResult;
    const overlap=first&&previous&&first.soloId===previous.soloId
      ?Math.max(0,Math.min(first.endNote,previous.endNote)-Math.max(first.startNote,previous.startNote)+1)/Math.min(first.endNote-first.startNote+1,previous.endNote-previous.startNote+1)
      :0;
    state.candidateCount=first?(overlap>=.5?state.candidateCount+1:1):0;
    state.candidateResult=first||null;
    if(state.candidateCount>=2){state.stable=first.soloId;state.lastSupported=performance.now()}
    if(!results.length&&performance.now()-state.lastSupported>10000)state.stable=null;
  }
  state.results=results;
  document.querySelector('.listen-results').hidden=false;
  $('listen-result-count').textContent=results.length?`${results.length} shown`:'';
  $('listen-result-explainer').hidden=!results.length;
  if(!results.length){$('listen-result-list').innerHTML=`<p class="listen-empty">${live?'Listening for a clear phrase…':state.notes.length<8?'Play at least eight clear notes to search the archive.':'No close passage found. Try a longer or clearer phrase.'}</p>`;return}
  $('listen-result-list').innerHTML=results.map((r,i)=>{const url=recordingURL(r),kind=({verified:'Verified recording',aligned:'Aligned recording',estimated:'Likely recording',candidate:'Unverified recording'})[r.recording?.kind]||'Source recording';const at=Number.isFinite(r.recordingTimeSeconds)?` at ${formatTime(r.recordingTimeSeconds)}`:'';const stable=live&&i===0&&state.stable===r.soloId?'<span class="listen-stable"> · steady match</span>':'';const instrument=INSTRUMENTS[r.instrument]||r.instrument||'solo';return `<article class="listen-result"><div class="listen-result-head"><h4>${escapeHTML(r.performer)} · ${escapeHTML(r.title)}</h4><strong>${Math.round(r.score*100)}% pattern similarity${stable}</strong></div><p class="listen-result-meta">${r.pairedNotes} matched notes · ${r.transpositionSemitones>0?'+':''}${r.transpositionSemitones} semitones · ${escapeHTML(instrument)} · ${url?escapeHTML(kind+at):'No matched recording'}</p><div class="listen-result-actions"><button type="button" data-listen-compare="${i}" aria-expanded="${i===0}" aria-controls="listen-compare-${i}">${i===0?'Hide pair':'Compare as a pair'}</button>${url?`<a href="${url}" target="_blank" rel="noopener noreferrer">Open recording ↗</a>`:''}</div><div class="listen-compare" id="listen-compare-${i}" ${i===0?'':'hidden'}>${i===0?comparison(r,i):''}</div></article>`}).join('');if(results.length)renderPairScores(0)}
function setPlayButton(button,mode){if(!button.isConnected)return;const original=button.dataset.playLabel??button.getAttribute('aria-label');button.dataset.playLabel=original;button.dataset.playMode=mode;button.querySelector('[data-play-icon]').textContent=mode==='playing'?'❚❚':'▶';button.querySelector('[data-play-text]').textContent=mode==='playing'?button.dataset.pauseText:mode==='paused'?button.dataset.resumeText:button.dataset.playText;button.setAttribute('aria-label',mode==='playing'?original.replace(/^Play /,'Pause '):mode==='paused'?original.replace(/^Play /,'Resume '):original);button.title=button.getAttribute('aria-label')}
async function playNotes(notes,button){if(!notes?.length||!button)return;const engine=window.StolenMoments;if(!engine?.playTranscript){$('listen-status').textContent='Note playback is unavailable in this browser.';return}const mode=engine.getPlaybackState(button);try{if(mode==='playing')await engine.pausePlayback();else if(mode==='paused')await engine.resumePlayback();else await engine.playTranscript(notes.map(n=>({pitch:n.pitch,onset:n.onsetSeconds??n.onset,duration:n.durationSeconds??n.duration})),{owner:button,onStateChange:next=>setPlayButton(button,next)})}catch{$('listen-status').textContent='Could not play the notes. Try again.';engine.stopPlayback()}}
let abcLoad;
function loadAbc(){return abcLoad??=window.ABCJS?Promise.resolve():new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=new URL('../vendor/abcjs-basic-min.js',import.meta.url);script.onload=resolve;script.onerror=()=>{abcLoad=null;reject(new Error('Score renderer unavailable.'))};document.head.append(script)})}
function abcPitch(midi,accidentals){const steps=[['C',0],['D',-1],['D',0],['E',-1],['E',0],['F',0],['G',-1],['G',0],['A',-1],['A',0],['B',-1],['B',0]];const [letter,alter]=steps[((midi%12)+12)%12],octave=Math.floor(midi/12)-1,key=`${letter}${octave}`,previous=accidentals.get(key)||0;accidentals.set(key,alter);return `${alter===previous?'':alter===-1?'_':'='}${octave>=5?letter.toLowerCase()+"'".repeat(Math.max(0,octave-5)):letter+','.repeat(Math.max(0,4-octave))}`}
function scoreAbc(notes){const accidental=new Map(),ordered=[...notes].sort((a,b)=>(a.onsetSeconds??a.onset)-(b.onsetSeconds??b.onset));const body=ordered.map((note,i)=>{const onset=note.onsetSeconds??note.onset,duration=Math.max(.0625,note.durationSeconds??note.duration??.2),next=ordered[i+1],gap=next?Math.max(0,(next.onsetSeconds??next.onset)-onset-duration):0;return `${abcPitch(note.pitch,accidental)}${Math.max(1,Math.min(32,Math.round(duration*8)))}${gap>.08?` z${Math.min(32,Math.max(1,Math.round(gap*8)))}`:''}`}).join(' ');const pitches=ordered.map(n=>n.pitch).sort((a,b)=>a-b);return `X:1\nM:none\nL:1/16\nK:C clef=${pitches[Math.floor(pitches.length/2)]<57?'bass':'treble'}\n${body}`}
async function renderScore(target,notes,label='phrase'){if(!target)return;const revision=state.phraseRevision;if(!notes.length){target.textContent='No notes to show yet.';return}try{await loadAbc();if(revision!==state.phraseRevision||!target.isConnected)return;window.ABCJS.renderAbc(target,scoreAbc(notes),{staffwidth:Math.max(550,notes.length*42),scale:.8,paddingtop:4,paddingbottom:2,paddingleft:2,paddingright:2});const svg=target.querySelector('svg');if(svg){svg.setAttribute('role','img');svg.setAttribute('aria-label',`${label}: ${notes.length} notes. ${notes.map(n=>pitchName(n.pitch)).join(', ')}`)}}catch{if(revision===state.phraseRevision&&target.isConnected)target.textContent='Score unavailable; you can still play the detected notes.'}}
function scoreSide(label,title,notes,side,index){return `<section class="listen-pair-side ${side}"><div class="listen-pair-side-head"><span class="score-letter">${label}</span><strong>${escapeHTML(title)}</strong><small>${notes.length} notes</small></div><div class="listen-score-scroll" role="region" tabindex="0" aria-label="Scrollable score for ${escapeHTML(title)}"><div id="listen-pair-score-${index}-${side}" class="listen-score-paper"></div></div><button type="button" data-listen-play="${side==='a'?'query':'match'}" data-index="${index}" data-play-text="Play notes" data-pause-text="Pause notes" data-resume-text="Resume notes" aria-label="Play notes from ${escapeHTML(title)} as MIDI"><span data-play-icon aria-hidden="true">▶</span> <span data-play-text>Play notes</span></button></section>`}
function renderPairScores(index){const r=state.results[index];if(!r)return;renderScore($(`listen-pair-score-${index}-a`),state.notes,'Your phrase');renderScore($(`listen-pair-score-${index}-b`),r.notes||[],`${r.performer} · ${r.title}`)}
function comparison(r,index){
  const q=state.notes,c=new Map((r.notes||[]).map(n=>[n.index,n]));
  const rows=(r.alignment||[]).map(([qi,ci])=>`<tr><td>${qi>=0&&q[qi]?pitchName(q[qi].pitch):'—'}</td><td>${ci>=0&&c.has(ci)?pitchName(c.get(ci).pitch):'—'}</td></tr>`).join('');
  return `<div class="listen-pair-split">${scoreSide('A','Your phrase',q,'a',index)}${scoreSide('B',`${r.performer} · ${r.title}`,r.notes||[],'b',index)}</div><details class="listen-alignment"><summary>Note-by-note alignment</summary><div class="listen-alignment-scroll" tabindex="0"><table><caption>Detected notes aligned with the archive passage</caption><thead><tr><th scope="col">Your phrase</th><th scope="col">Archive</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
}
function midiBytes(notes){
  const first=notes[0]?.onsetSeconds??0,events=[];
  for(const note of notes){
    const start=Math.max(0,Math.round((note.onsetSeconds-first)*960)),end=Math.max(start+1,Math.round((note.onsetSeconds-first+note.durationSeconds)*960));
    events.push({tick:start,order:1,data:[0x90,note.pitch,88]},{tick:end,order:0,data:[0x80,note.pitch,0]});
  }
  events.sort((a,b)=>a.tick-b.tick||a.order-b.order||a.data[1]-b.data[1]);
  const varlen=value=>{const parts=[value&127];while((value>>=7)>0)parts.unshift((value&127)|128);return parts};
  const track=[0,0xff,0x51,3,0x07,0xa1,0x20];let previous=0;
  for(const event of events){track.push(...varlen(event.tick-previous),...event.data);previous=event.tick}
  track.push(0,0xff,0x2f,0);
  const u32=n=>[(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255];
  return new Uint8Array([...new TextEncoder().encode('MThd'),...u32(6),0,0,0,1,1,0xe0,...new TextEncoder().encode('MTrk'),...u32(track.length),...track]);
}
function downloadNotes(kind){
  if(!state.notes.length)return;
  if(state.blobUrl)URL.revokeObjectURL(state.blobUrl);
  const bytes=kind==='midi'?midiBytes(state.notes):JSON.stringify({schemaVersion:1,source:'Listen & Find',notes:state.notes},null,2);
  state.blobUrl=URL.createObjectURL(new Blob([bytes],{type:kind==='midi'?'audio/midi':'application/json'}));
  const anchor=document.createElement('a');anchor.href=state.blobUrl;anchor.download=`stolen-moments-notes.${kind==='midi'?'mid':'json'}`;anchor.click();
}

async function begin(live){await cancelWork();clearPhrase();state.liveNotes=[];state.lastWindow=0;const sessionId=state.sessionId;state.liveStarted=performance.now();$('listen-time').textContent='00:00';setStatus('Waiting for microphone permission…','requesting-permission');try{state.capture=new CaptureSession({onLevel:meter});await state.capture.start();if(sessionId!==state.sessionId){await closeCapture();return}state.liveStarted=performance.now();setStatus(live?'Listening — gathering a phrase…':'Recording. Play a single-note phrase. ',live?'live':'recording');state.ticker=setInterval(timer,200);if(live){state.liveTicker=setInterval(()=>liveTick(sessionId),3000);setTimeout(()=>liveTick(sessionId),5000)}else state.liveTicker=setInterval(()=>{if(elapsed()>=20)finish()},500)}catch(error){await closeCapture();if(sessionId===state.sessionId)fail(error)}}
async function liveTick(sessionId){
  if(sessionId!==state.sessionId||state.mode!=='live'||!state.capture)return;
  if(elapsed()>=300){await finish();return}
  if(elapsed()<5)return;
  if(state.inFlight){state.pending=true;return}
  state.inFlight=true;
  try{
    const snapshot=state.capture.snapshot(20),end=snapshot.startSeconds+snapshot.durationSeconds;
    const start=Math.max(snapshot.startSeconds,end-5.8,state.lastWindow?state.lastWindow-.35:0);
    if(end-start<.5)return;
    const offset=Math.max(0,Math.floor((start-snapshot.startSeconds)*snapshot.sampleRate));
    const pcm=snapshot.pcm.slice(offset),windowStartSeconds=snapshot.startSeconds+offset/snapshot.sampleRate;
    $('listen-status').textContent='Listening and comparing…';
    const tracked=await workerRequest(liveWorker(),'transcribe',{pcm,sampleRate:snapshot.sampleRate,windowStartSeconds},sessionId,[pcm.buffer]);
    if(sessionId!==state.sessionId)return;
    updateDebug({backend:tracked.backend,liveWindow:[tracked.windowStartSeconds,tracked.windowEndSeconds],liveTimings:tracked.timings,sessionId});
    state.lastWindow=end;
    for(const note of tracked.notes||[]){
      const duplicate=state.liveNotes.findIndex(old=>old.pitch===note.pitch&&Math.abs(old.onsetSeconds-note.onsetSeconds)<.08);
      if(duplicate>=0){if(note.durationSeconds>state.liveNotes[duplicate].durationSeconds)state.liveNotes[duplicate]=note}
      else state.liveNotes.push(note);
    }
    const queryStart=Math.max(0,end-15);
    state.liveNotes=state.liveNotes.filter(n=>n.onsetSeconds+n.durationSeconds>=queryStart).sort((a,b)=>a.onsetSeconds-b.onsetSeconds);
    state.notes=normalizedNotes(state.liveNotes.map(n=>({...n,onsetSeconds:n.onsetSeconds-queryStart})),end-queryStart);
    $('listen-note-preview').hidden=!state.notes.length;
    $('listen-downloads').hidden=!state.notes.length;
    if(state.notes.length)$('listen-note-preview').textContent=`Heard ${state.notes.length} notes: ${state.notes.slice(-16).map(n=>pitchName(n.pitch)).join(' · ')}`;
    if(state.notes.length<8){if(state.results.length&&performance.now()-state.lastSupported>10000)renderResults([],{live:true});$('listen-status').textContent='Listening — gathering a phrase…';return}
    const result=await workerRequest(searchWorker(),'search',{schemaVersion:1,requestId:state.requestId+1,source:'microphone',audioDurationSeconds:end-queryStart,notes:state.notes},sessionId);
    if(sessionId===state.sessionId){updateDebug({algorithmVersion:result.algorithmVersion,candidateCount:result.candidateCount,searchTimings:result.timings,queryNoteCount:result.queryNoteCount,requestId:state.requestId});renderResults(result.results||[],{live:true})}
  }catch(error){if(sessionId===state.sessionId)$('listen-status').textContent=error.message||'Keep playing; trying again…'}
  finally{state.inFlight=false;if(state.pending&&sessionId===state.sessionId){state.pending=false;setTimeout(()=>liveTick(sessionId),0)}else if(sessionId===state.sessionId&&state.mode==='live')$('listen-status').textContent='Listening for another phrase…'}
}
async function finish(){const live=state.mode==='live';if(!state.capture||state.finishing)return;state.finishing=true;clearTimers();const sessionId=state.sessionId;try{const input=await state.capture.stop();await closeCapture();if(live){await cancelWork();setStatus('Listening stopped. Your latest suggestions are shown.','results');return}await analyse(input,sessionId)}catch(error){if(sessionId===state.sessionId)fail(error)}finally{state.finishing=false}}
async function fileInput(file,source='upload'){if(!file)return;await cancelWork();clearPhrase();const sessionId=state.sessionId;state.liveStarted=performance.now();if(file.size>20*1024*1024){fail(new Error('Choose an audio file smaller than 20 MB.'));return}setStatus('Opening your audio…','transcribing');showProgress('preparing');let context;try{context=new AudioContext();const buffer=await context.decodeAudioData(await file.arrayBuffer());if(buffer.duration>20)throw new Error('Choose a recording shorter than 20 seconds.');const mono=new Float32Array(buffer.length);for(let channel=0;channel<buffer.numberOfChannels;channel++){const data=buffer.getChannelData(channel);for(let i=0;i<data.length;i++)mono[i]+=data[i]/buffer.numberOfChannels}await context.close();context=null;await analyse({pcm:mono,sampleRate:buffer.sampleRate,durationSeconds:buffer.duration},sessionId,{source})}catch(error){if(sessionId===state.sessionId)fail(error)}finally{if(context)await context.close()}}
async function example(){
  await cancelWork();
  clearPhrase();
  const sessionId=state.sessionId,kind=$('listen-example-kind').value;
  setStatus('Preparing an archive phrase…','transcribing');
  showProgress('preparing');
  try{
    if(!['clear','transposed','silence'].includes(kind))throw new Error('Unknown example.');
    const response=await fetch(new URL(`./examples/${kind}.wav`,import.meta.url));
    if(!response.ok)throw new Error('Example audio is unavailable.');
    const file=new File([await response.blob()],`${kind}.wav`,{type:'audio/wav'});
    if(sessionId===state.sessionId)await fileInput(file,'example');
  }catch(error){if(sessionId===state.sessionId)fail(error)}
}

$('open-listen').addEventListener('click',async()=>{state.trigger=document.activeElement;dialog.showModal();await reset()});
$('listen-close').addEventListener('click',()=>dialog.close());
dialog.addEventListener('close',async()=>{await reset();state.trigger?.focus?.()});
dialog.addEventListener('cancel',()=>{dialog.close()});
$('listen-record').addEventListener('click',()=>begin(false));
$('listen-stop').addEventListener('click',finish);
$('listen-cancel').addEventListener('click',reset);
$('listen-clear').addEventListener('click',reset);
$('listen-file').addEventListener('change',event=>{const file=event.target.files?.[0];event.target.value='';fileInput(file)});
$('listen-example').addEventListener('click',example);
$('listen-export-json').addEventListener('click',()=>downloadNotes('json'));
$('listen-export-midi').addEventListener('click',()=>downloadNotes('midi'));
$('listen-play-detected').addEventListener('click',event=>playNotes(state.notes,event.currentTarget));
dialog.addEventListener('click',event=>{const play=event.target.closest('[data-listen-play]');if(play){const r=state.results[Number(play.dataset.index)];playNotes(play.dataset.listenPlay==='query'?state.notes:r?.notes||[],play);return}const compare=event.target.closest('[data-listen-compare]');if(compare){const index=Number(compare.dataset.listenCompare),panel=$(`listen-compare-${index}`),open=panel.hidden;if(!open)stopPlayback();panel.hidden=!open;compare.setAttribute('aria-expanded',String(open));compare.textContent=open?'Hide pair':'Compare as a pair';if(open){panel.innerHTML=comparison(state.results[index],index);renderPairScores(index)}}});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.capture)finish()});
window.addEventListener('pagehide',()=>{cancelWork();stopPlayback()});
