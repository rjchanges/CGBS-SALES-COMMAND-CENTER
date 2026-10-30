import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
  webServer: [
    { command: 'npm --prefix ../../packages/shared run build && npm run dev --prefix ../api', url: 'http://127.0.0.1:4100/api/health', reuseExistingServer: !process.env.CI, timeout: 120_000 },
    { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI, timeout: 120_000 },
  ],
});

