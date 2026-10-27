const {test,expect}=require('@playwright/test');
const path=require('node:path');

const fixture=path.join(__dirname,'../static/listen/examples/clear.wav');
test.use({
  permissions:['microphone'],
  launchOptions:{args:[
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-audio-capture=${fixture}`,
  ]},
});

test('microphone route records, stops and searches',async({page})=>{
  test.setTimeout(120000);
  await page.goto('/');
  await page.locator('#landing-prompt').click();
  await page.locator('#open-listen').click();
  await page.locator('#listen-record').click();
  await expect(page.locator('#listen-dialog')).toHaveAttribute('data-mode','recording',{timeout:15000});
  await page.waitForTimeout(8500);
  await page.locator('#listen-stop').click();
  await expect(page.locator('.listen-result').first()).toContainText('Paul Desmond',{timeout:90000});
  await expect(page.locator('#listen-dialog')).toHaveAttribute('data-mode','results');
});
