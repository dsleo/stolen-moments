const {test,expect}=require('@playwright/test');

test('model and catalog load under a GitHub Pages style subpath',async({page})=>{
  test.setTimeout(120000);
  await page.route('**/stolen-moments/**',async route=>{
    const original=new URL(route.request().url());
    const local=new URL(original);
    local.pathname=original.pathname.replace(/^\/stolen-moments(?=\/)/,'');
    const response=await route.fetch({url:local.href});
    await route.fulfill({response});
  });
  await page.goto('/stolen-moments/');
  await page.locator('#landing-prompt').click();
  await page.locator('#open-listen').click();
  await page.locator('#listen-example').click();
  await expect(page.locator('.listen-result').first()).toContainText('Paul Desmond',{timeout:90000});
});
