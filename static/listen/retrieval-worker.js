import { ALGORITHM_VERSION, SCHEMA_VERSION, validateCorpusSolo, validateQuery } from './contracts.mjs';
import { fastCandidateCost, intervalCandidates, rerankCandidate, selectCandidatesFromPool, selectResults } from './retrieval.mjs';

const base = new URL('../catalog/listen/', import.meta.url);
let corpusPromise;
let activeRequest = null;

async function readJson(path) {
  const response = await fetch(new URL(path, base));
  if (!response.ok) throw new Error(`Could not load listen catalog (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let text;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (!('DecompressionStream' in self)) throw new Error('This browser cannot unpack the listen catalog.');
    text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  } else text = new TextDecoder().decode(bytes);
  return JSON.parse(text);
}

async function loadCorpus() {
  const manifest = await readJson('manifest.json');
  if (manifest.schemaVersion !== SCHEMA_VERSION || manifest.algorithmVersion !== ALGORITHM_VERSION || !Array.isArray(manifest.shards)) {
    throw new Error('Unsupported listen catalog version.');
  }
  const solos = [];
  for (const shard of manifest.shards) {
    if (!/^shard-\d+\.json\.gz$/.test(shard.path)) throw new Error('Invalid listen catalog shard path.');
    const data = await readJson(shard.path);
    if (data.schemaVersion !== SCHEMA_VERSION || !Array.isArray(data.solos)) throw new Error('Invalid listen catalog shard.');
    for (const solo of data.solos) solos.push(validateCorpusSolo(solo));
  }
  if (solos.length !== manifest.soloCount || solos.reduce((sum, solo) => sum + solo.pitches.length, 0) !== manifest.noteCount) {
    throw new Error('Listen catalog count mismatch.');
  }
  return solos;
}

function response(type, requestId, sessionId, payload) {
  self.postMessage({ type, requestId, sessionId, payload });
}

const yieldToMessages = () => new Promise(resolve => setTimeout(resolve, 0));

async function search(query, solos, token) {
  const started = performance.now();
  const pool = [];
  for (let i = 0; i < solos.length; i++) {
    if (token.cancelled || activeRequest !== token) return null;
    pool.push(...intervalCandidates(query, solos[i]));
    if (i % 8 === 7) await yieldToMessages();
  }
  const candidates = selectCandidatesFromPool(pool);
  const retrievedAt = performance.now();
  const fastRanked = [];
  for (let i = 0; i < candidates.length; i++) {
    if (token.cancelled || activeRequest !== token) return null;
    fastRanked.push({ candidate: candidates[i], cost: fastCandidateCost(query, candidates[i]) });
    if (i % 20 === 19) await yieldToMessages();
  }
  fastRanked.sort((a, b) => a.cost - b.cost || a.candidate.coarseCost - b.candidate.coarseCost ||
    a.candidate.soloId - b.candidate.soloId || a.candidate.startNote - b.candidate.startNote);
  const ranked = [];
  const fullLimit = fastRanked[0]?.cost <= 0.1 ? 12 : 24;
  for (const { candidate } of fastRanked.slice(0, fullLimit)) {
    if (token.cancelled || activeRequest !== token) return null;
    ranked.push(rerankCandidate(query, candidate));
    await yieldToMessages();
  }
  return { algorithmVersion: ALGORITHM_VERSION, queryNoteCount: query.notes.length,
    candidateCount: candidates.length,
    timings: { candidateMs: retrievedAt - started, rerankMs: performance.now() - retrievedAt },
    results: selectResults(ranked) };
}

self.addEventListener('message', async event => {
  const { type, requestId, sessionId, payload } = event.data || {};
  if (type === 'cancel') {
    if (activeRequest?.sessionId === sessionId) activeRequest.cancelled = true;
    return;
  }
  if (type !== 'search') {
    response('error', requestId, sessionId, { message: 'Unknown listen search operation.' });
    return;
  }
  const token = { requestId, sessionId, cancelled: false };
  activeRequest = token;
  try {
    const query = validateQuery(payload);
    if (requestId !== query.requestId || !Number.isSafeInteger(sessionId) || sessionId < 0) {
      throw new Error('Invalid listen search request identity.');
    }
    response('progress', requestId, sessionId, { phase: 'loading-corpus' });
    corpusPromise ??= loadCorpus().catch(error => { corpusPromise = null; throw error; });
    const solos = await corpusPromise;
    if (token.cancelled || activeRequest !== token) return;
    response('progress', requestId, sessionId, { phase: 'searching' });
    // Yield once so a pending cancellation message can be handled before the CPU work.
    await new Promise(resolve => setTimeout(resolve, 0));
    if (token.cancelled || activeRequest !== token) return;
    const result = await search(query, solos, token);
    if (result && !token.cancelled && activeRequest === token) response('result', requestId, sessionId, result);
  } catch (error) {
    if (!token.cancelled && activeRequest === token) response('error', requestId, sessionId, { message: error.message || String(error) });
  } finally {
    if (activeRequest === token) activeRequest = null;
  }
});
