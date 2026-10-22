import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 120000,
  use: { baseURL: 'http://localhost:5174' },
  webServer: { command: 'npm run dev', url: 'http://localhost:5174', reuseExistingServer: !process.env.CI },
});
