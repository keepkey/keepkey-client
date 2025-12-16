// Process polyfill for browser environment
if (typeof globalThis.process === 'undefined') {
  globalThis.process = {
    env: {},
    version: '',
    browser: true,
    nextTick: (callback: Function) => Promise.resolve().then(() => callback()),
    cwd: () => '/',
    platform: 'browser',
  } as any;
}
