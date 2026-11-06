import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  use: { baseURL: 'http://localhost:5187', launchOptions: { channel: 'chrome' } },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5187 --strictPort', url: 'http://localhost:5187', reuseExistingServer: false },
});
