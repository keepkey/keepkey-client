import { defineConfig } from 'vitest/config';

// Unit-test runner for the background service-worker logic. Scope is the
// pure, money-path modules first (fee floors, RPC failover classification,
// chain config) — the code that decides what gets signed and broadcast.
// `node` environment: these units have no DOM/chrome.* dependency. Tests
// that need to mock chrome.* or fetch declare their own stubs per-file.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Keep the e2e (WebdriverIO) specs out of the unit runner.
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
