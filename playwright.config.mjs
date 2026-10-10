import { defineConfig } from '@playwright/test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Synthetic-only, loopback workerd and fresh local D1 state for every test run.
// CI can use Playwright's installed Chromium; cloud development can use system Chromium.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const state = mkdtempSync(join(tmpdir(), 'hospital-fabric-browser-'));
export default defineConfig({
  testDir: './tests',
  testMatch: 'console.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:9878',
    browserName: 'chromium',
    launchOptions: executablePath ? { executablePath } : {},
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npm run build && node node_modules/wrangler/bin/wrangler.js dev --config apps/worker/wrangler.jsonc --local --ip 127.0.0.1 --port 9878 --inspector-port 0 --persist-to ${JSON.stringify(state)} --var DEMO_API_KEY:synthetic-browser-test-token-only --var ALLOW_DEV_BOOTSTRAP:1`,
    url: 'http://127.0.0.1:9878/healthz',
    reuseExistingServer: false,
    timeout: 90_000,
    env: { WRANGLER_SEND_METRICS: 'false', XDG_CONFIG_HOME: state, WRANGLER_LOG_PATH: join(state, 'wrangler.log'), BROWSER: 'none', CI: '1' },
  },
});
