const {test, expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const path=require('node:path');

test('Listen & Find opens, runs the real example path, and closes cleanly',async({page})=>{
  test.setTimeout(120000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  await page.locator('#landing-prompt').click();
  await expect(page.locator('#open-listen')).toBeVisible();
  await page.locator('#open-listen').click();
  const dialog=page.locator('#listen-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Your audio stays in this browser');
  await expect(dialog.locator('#listen-live')).toHaveCount(0);
  await expect(dialog.locator('#listen-record')).toHaveAttribute('aria-label','Record a phrase');
  await expect(dialog.locator('#listen-file')).toHaveAttribute('aria-label','Choose an audio file');
  await expect(dialog.locator('.listen-help-near-actions')).toBeVisible();
  await dialog.locator('#listen-example').click();
  await expect(dialog.locator('#listen-progress')).toBeVisible();
  await expect(dialog.locator('.listen-result')).toHaveCount(0);
  await expect.poll(async()=>{
    const preview=await dialog.locator('#listen-note-preview').isVisible();
    const status=await dialog.locator('#listen-status').textContent();
    return preview?'notes':/failed|could not|unavailable|took too long|backend/i.test(status)?`error: ${status}`:'working';
  },{timeout:90000}).toBe('notes');
  await expect(dialog.locator('#listen-status')).toContainText(/ready|longer phrase|convincing match/i,{timeout:30000});
  await expect(dialog.locator('.listen-result').first()).toBeVisible();
  await expect(dialog.locator('.listen-result').first()).toContainText('Paul Desmond');
  await expect(dialog.locator('.listen-result').first()).toContainText('pattern similarity');
  await expect(dialog.locator('.listen-result').first()).toContainText('Alto sax');
  await expect(dialog.locator('#listen-result-explainer')).toBeVisible();
  await expect(dialog.locator('#listen-progress')).toBeHidden();
  await expect(dialog.locator('#listen-preview-details')).not.toHaveAttribute('open');
  await dialog.locator('#listen-preview-details > summary').click();
  await expect(dialog.locator('#listen-your-score svg')).toBeVisible();
  await expect(dialog.locator('#listen-play-detected')).toBeEnabled();
  await dialog.locator('#listen-play-detected').click();
  await expect(dialog.locator('#listen-play-detected')).toHaveAttribute('aria-label','Pause detected notes as MIDI');
  await dialog.locator('#listen-play-detected').click();
  await expect(dialog.locator('#listen-play-detected')).toHaveAttribute('aria-label','Resume detected notes as MIDI');
  await dialog.locator('#listen-play-detected').click();
  await expect(dialog.locator('#listen-play-detected')).toHaveAttribute('aria-label','Pause detected notes as MIDI');
  await expect(dialog.locator('.listen-result').first().locator('.listen-pair-side')).toHaveCount(2);
  await expect(dialog.locator('#listen-pair-score-0-b svg')).toBeVisible();
  await expect(dialog.locator('.listen-result').first().locator('.listen-alignment')).toBeVisible();
  await dialog.locator('[data-listen-play="match"]').first().click();
  await expect(dialog.locator('#listen-play-detected')).toHaveAttribute('aria-label','Play detected notes as MIDI');
  await expect(dialog.locator('[data-listen-play="match"]').first()).toHaveAttribute('aria-label',/Pause notes from Paul Desmond/);
  await dialog.locator('[data-listen-compare="0"]').click();
  await expect(dialog.locator('#listen-compare-0')).toBeHidden();
  await dialog.locator('[data-listen-compare="0"]').click();
  await expect(dialog.locator('#listen-pair-score-0-a svg')).toBeVisible();
  const midiPromise=page.waitForEvent('download');
  await dialog.locator('#listen-export-midi').click();
  const midi=await midiPromise;
  expect(midi.suggestedFilename()).toBe('stolen-moments-notes.mid');
  const midiBytes=require('node:fs').readFileSync(await midi.path());
  expect(midiBytes.toString('ascii',0,4)).toBe('MThd');
  expect(midiBytes.toString('ascii',14,18)).toBe('MTrk');
  const {Midi}=require('@tonejs/midi');
  expect(new Midi(midiBytes).tracks[0].notes.length).toBeGreaterThanOrEqual(8);
  const resultA11y=await new AxeBuilder({page}).include('#listen-dialog').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
  expect(resultA11y.violations.map(v=>v.id)).toEqual([]);
  await dialog.locator('#listen-example-kind').selectOption('silence');
  await dialog.locator('#listen-example').click();
  await expect(dialog.locator('.listen-result')).toHaveCount(0);
  await expect(dialog.locator('#listen-note-preview')).toBeHidden();
  await expect(dialog.locator('#listen-downloads')).toBeHidden();
  await expect(dialog.locator('#listen-status')).toContainText('No clear sound detected');
  await dialog.locator('#listen-close').click();
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});

test('higher and slower example recovers the same passage',async({page})=>{
  test.setTimeout(120000);
  await page.goto('/');
  await page.locator('#landing-prompt').click();
  await page.locator('#open-listen').click();
  await page.locator('#listen-example-kind').selectOption('transposed');
  await page.locator('#listen-example').click();
  await expect(page.locator('.listen-result').first()).toContainText('Paul Desmond',{timeout:90000});
});

test('uploaded WAV is transcribed and matched',async({page})=>{
  test.setTimeout(120000);
  await page.goto('/');
  await page.locator('#landing-prompt').click();
  await page.locator('#open-listen').click();
  await page.locator('#listen-file').setInputFiles(path.join(__dirname,'../static/listen/examples/clear.wav'));
  await expect(page.locator('.listen-result').first()).toContainText('Paul Desmond',{timeout:90000});
});

test('microphone permission failure leaves upload available',async({page,context})=>{
  await context.clearPermissions();
  await page.goto('/');
  await page.locator('#landing-prompt').click();
  await page.locator('#open-listen').click();
  await page.locator('#listen-record').click();
  await expect(page.locator('#listen-status')).toContainText(/denied|permission|device|record/i,{timeout:15000});
  await expect(page.locator('#listen-file')).toBeEnabled();
});

test('quiet example reports no sound without a match',async({page})=>{
  await page.goto('/');
  await page.locator('#landing-prompt').click();
  await page.locator('#open-listen').click();
  await page.locator('#listen-example-kind').selectOption('silence');
  await page.locator('#listen-example').click();
  await expect(page.locator('#listen-status')).toContainText('No clear sound detected');
  await expect(page.locator('.listen-result')).toHaveCount(0);
});

test('invalid audio file reports a recoverable error',async({page})=>{
  await page.goto('/');
  await page.locator('#landing-prompt').click();
  await page.locator('#open-listen').click();
  await page.locator('#listen-file').setInputFiles({name:'broken.wav',mimeType:'audio/wav',buffer:Buffer.from('not audio')});
  await expect(page.locator('#listen-dialog')).toHaveAttribute('data-mode','error');
  await expect(page.locator('#listen-record')).toBeEnabled();
});

test('dialog is keyboard usable and fits narrow screens',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await page.locator('#landing-prompt').click();
  await expect(page.locator('#landing')).toHaveAttribute('data-phase','open');
  await expect(page.locator('#open-listen')).toBeVisible();
  await expect(page.locator('.desk-actions')).not.toHaveAttribute('inert');
  await page.locator('#open-listen').focus();
  await expect(page.locator('#open-listen')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#listen-dialog')).toBeVisible();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  expect(overflow).toBe(false);
  const results=await new AxeBuilder({page}).include('#listen-dialog').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
  expect(results.violations.map(v=>v.id)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.locator('#listen-dialog')).toBeHidden();
  await expect(page.locator('#open-listen')).toBeFocused();
});

test('optional technical details appear only with debug flag',async({page})=>{
  await page.goto('/?listenDebug=1');
  await page.locator('#landing-prompt').click();
  await page.locator('#open-listen').click();
  await expect(page.locator('#listen-debug')).not.toHaveAttribute('hidden');
  await page.locator('#listen-debug summary').click();
  await expect(page.locator('#listen-debug-text')).toBeVisible();
});
