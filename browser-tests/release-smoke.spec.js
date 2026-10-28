const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

async function expectAccessible(page, where) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const summary = results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`).join('\n');
  expect(summary, `Accessibility violations on ${where}`).toBe('');
}

test('mobile landing, archive, pair details, deep links, and method assets', async ({ page }) => {
  const pageErrors = [];
  const failedLocalResponses = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('response', response => {
    if (response.url().startsWith('http://127.0.0.1:8766') && response.status() >= 400) {
      failedLocalResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.goto('/');
  const landing = page.locator('#landing');
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(landing).toHaveAttribute('data-phase', 'closed');
    await expect(page.locator('.desk-actions')).toBeHidden();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow, `closed landing overflows at ${width}px`).toBe(false);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(landing).toHaveAttribute('data-phase', 'closed');
  await expect(page.locator('.desk-actions')).toBeHidden();
  await expect(page.locator('#close-deck')).toBeHidden();
  await expect(page.locator('.archive-content')).toBeHidden();
  await expectAccessible(page, 'closed landing');

  await page.locator('#landing-prompt').focus();
  await page.keyboard.press('Enter');
  await expect(landing).toHaveAttribute('data-phase', 'open', { timeout: 10_000 });
  await expect(page.locator('.desk-actions')).toBeVisible();
  await expect(page.locator('.archive-content')).toBeVisible();
  await expect(page.locator('.landing-feature-link')).toHaveCount(0);
  await expect(page.locator('#result-count')).not.toHaveText('—', { timeout: 60_000 });
  await expect(page.locator('.crate-card').first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect.poll(() => page.locator('.crate').evaluate(el => el.getBoundingClientRect().bottom)).toBeGreaterThan(800);
  await expect.poll(() => page.locator('.crate').evaluate(el => el.getBoundingClientRect().bottom)).toBeLessThan(880);
  await expect(page.locator('#open-shelf')).toBeFocused();
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow, `archive overflows at ${width}px`).toBe(false);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const id of ['open-shelf', 'open-sort']) {
    const box = await page.locator(`#${id}`).boundingBox();
    expect(box && box.width >= 44 && box.height >= 44, `${id} is a 44px touch target`).toBeTruthy();
  }

  await page.locator('.crate-card').first().click();
  await expect(page.locator('#stage')).toHaveClass(/has-pair/);
  await expect(page.locator('#stage .stage-cta')).toBeVisible();
  await page.locator('#stage .stage-cta').click();
  const dialog = page.locator('#pair-dialog');
  await expect(dialog).toHaveAttribute('open', '');
  await expect(dialog.locator('.score-panel.a')).toBeVisible({ timeout: 60_000 });
  await expect(dialog.locator('.score-panel.b')).toBeVisible();
  const playA=dialog.locator('.score-panel.a .score-play');
  const playB=dialog.locator('.score-panel.b .score-play');
  await playA.click();
  await expect(playA).toHaveAttribute('aria-label',/^Pause MIDI transcription/);
  await playA.click();
  await expect(playA).toHaveAttribute('aria-label',/^Resume MIDI transcription/);
  await playA.click();
  await expect(playA).toHaveAttribute('aria-label',/^Pause MIDI transcription/);
  await playB.click();
  await expect(playA).toHaveAttribute('aria-label',/^Play MIDI transcription/);
  await expect(playB).toHaveAttribute('aria-label',/^Pause MIDI transcription/);
  await expect(dialog.locator('.album-kind, .portrait-tag')).toHaveCount(0);
  await expect(dialog.locator('.alignment-panel')).toBeHidden();
  await dialog.getByRole('button', { name: /Compare notes/ }).click();
  await expect(dialog.locator('.alignment-panel')).toBeVisible();
  await expectAccessible(page, 'pair detail');
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow, `pair detail overflows at ${width}px`).toBe(false);
  }
  await page.setViewportSize({ width: 390, height: 844 });

  const pairUrl = new URL(page.url());
  const pairKey = pairUrl.searchParams.get('pair');
  expect(pairKey).toBeTruthy();
  await dialog.getByRole('button', { name: 'Close pair detail' }).click();
  await expect(dialog).not.toHaveAttribute('open', '');
  await expect.poll(() => new URL(page.url()).searchParams.has('pair')).toBe(false);

  await page.goto(`/?pair=${encodeURIComponent(pairKey)}`);
  await expect(page.locator('#landing')).toHaveAttribute('data-phase', 'open');
  await expect(page.locator('#pair-dialog')).toHaveAttribute('open', '');
  await expect(page.locator('#pair-dialog .score-panel.a')).toBeVisible({ timeout: 60_000 });

  await page.goto('/?pair=obsolete-release-smoke-key');
  await expect(page.locator('#pair-dialog')).not.toHaveAttribute('open', '');
  await expect(page.locator('#result-count')).not.toHaveText('—', { timeout: 60_000 });
  await expect(page.locator('.toast')).toContainText('no longer available');
  await expect.poll(() => new URL(page.url()).searchParams.has('pair')).toBe(false);

  const methodCss = page.waitForResponse(response => response.url().includes('/method.css'));
  const stylesCss = page.waitForResponse(response => response.url().includes('/styles.css'));
  await page.locator('.method-entry a').click();
  await expect(page).toHaveURL(/method\.html$/);
  await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible();
  await expectAccessible(page, 'method page');
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow, `method page overflows at ${width}px`).toBe(false);
  }
  expect((await methodCss).status()).toBeLessThan(400);
  expect((await stylesCss).status()).toBeLessThan(400);
  await expect.poll(() => failedLocalResponses).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('the no-Worker fallback still browses the default archive', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => Object.defineProperty(window, 'Worker', { configurable: true, value: undefined }));
  const page = await context.newPage();
  await page.goto('/#explore');
  await expect(page.locator('#result-count')).toHaveText('213,870', { timeout: 60_000 });
  await expect(page.locator('.crate-card').first()).toBeVisible();
  await context.close();
});
