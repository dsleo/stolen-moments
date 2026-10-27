const { test, expect } = require('@playwright/test');

test('retrieval worker loads the complete catalog and ignores cancelled work', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  const outcome = await page.evaluate(async () => {
    const base = new URL('catalog/listen/', location.href);
    const manifest = await fetch(new URL('manifest.json', base)).then(response => response.json());
    const shardBytes = new Uint8Array(await fetch(new URL(manifest.shards[0].path, base)).then(response => response.arrayBuffer()));
    const text = shardBytes[0] === 31 && shardBytes[1] === 139
      ? await new Response(new Blob([shardBytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
      : new TextDecoder().decode(shardBytes);
    const solo = JSON.parse(text).solos.find(item => item.pitches.length >= 30);
    const first = 6, count = 24, origin = solo.onsetsSeconds[first];
    const notes = solo.pitches.slice(first, first + count).map((pitch, i) => ({
      pitch, onsetSeconds: solo.onsetsSeconds[first + i] - origin,
      durationSeconds: solo.durationsSeconds[first + i],
    }));
    const query = requestId => ({ schemaVersion: 1, requestId, source: 'example',
      audioDurationSeconds: Math.max(...notes.map(note => note.onsetSeconds + note.durationSeconds)) + 0.1,
      notes });
    const worker = new Worker(new URL('listen/retrieval-worker.js', location.href), { type: 'module' });
    const messages = [];
    worker.addEventListener('message', event => messages.push(event.data));
    try {
      worker.postMessage({ type: 'search', requestId: 1, sessionId: 1, payload: query(1) });
      worker.postMessage({ type: 'cancel', requestId: 1, sessionId: 1 });
      worker.postMessage({ type: 'search', requestId: 2, sessionId: 2, payload: query(2) });
      const second = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Retrieval worker timed out')), 45_000);
        worker.addEventListener('message', event => {
          const data = event.data;
          if (data.requestId === 2 && data.type === 'error') {
            clearTimeout(timeout); reject(new Error(data.payload.message));
          }
          if (data.requestId === 2 && data.type === 'result') {
            clearTimeout(timeout); resolve(data.payload);
          }
        });
      });
      await new Promise(resolve => setTimeout(resolve, 100));
      return { soloId: solo.id, first, result: second.results[0],
        cancelledResults: messages.filter(message => message.requestId === 1 && message.type === 'result').length,
        count: second.candidateCount };
    } finally { worker.terminate(); }
  });
  expect(outcome.cancelledResults).toBe(0);
  expect(outcome.count).toBeGreaterThan(0);
  expect(outcome.result.soloId).toBe(outcome.soloId);
  expect(outcome.result.startNote).toBe(outcome.first);
});

test('built-in audio example reaches a ranked match through the real model', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (data, ...rest) {
      if (data?.type === 'search') window.__exampleQuery = data.payload;
      return send.call(this, data, ...rest);
    };
  });
  await page.goto('/');
  await page.locator('#landing-prompt').click();
  await page.locator('#open-listen').click();
  await page.locator('#listen-example').click();
  await expect.poll(async () => page.locator('#listen-dialog').getAttribute('data-mode'),
    { timeout: 100_000 }).toMatch(/results|empty|error/);
  const status = await page.locator('#listen-status').textContent();
  const query = await page.evaluate(() => window.__exampleQuery || null);
  expect(await page.locator('#listen-dialog').getAttribute('data-mode'),
    `${status}; detected notes: ${query?.notes?.map(note => `${note.pitch}@${note.onsetSeconds.toFixed(2)}+${note.durationSeconds.toFixed(2)}`).join(',') || 'none'}`).toBe('results');
  await expect(page.locator('.listen-result').first()).toBeVisible();
});
