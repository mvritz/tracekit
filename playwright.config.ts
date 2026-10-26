import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3000', trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'cargo run --locked -p tracekit-collector',
      url: 'http://127.0.0.1:4319/healthz',
      reuseExistingServer: !process.env.CI,
      timeout: 180000,
    },
    {
      command: 'pnpm --filter @tracekit/dashboard dev',
      url: 'http://127.0.0.1:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
    },
  ],
});
