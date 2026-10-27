const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './browser-tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:8766',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'python3 -m http.server 8766 --bind 127.0.0.1 --directory static',
    url: 'http://127.0.0.1:8766',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
