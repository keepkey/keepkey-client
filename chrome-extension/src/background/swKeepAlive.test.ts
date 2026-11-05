import { afterEach, describe, expect, it, vi } from 'vitest';

describe('holdServiceWorker', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('pings an extension API while held and stops after the last release', async () => {
    vi.useFakeTimers();
    const getPlatformInfo = vi.fn(() => Promise.resolve({}));
    vi.stubGlobal('chrome', { runtime: { getPlatformInfo } });
    const { holdServiceWorker, activeHolds, KEEPALIVE_INTERVAL_MS } = await import('./swKeepAlive');

    const a = holdServiceWorker();
    const b = holdServiceWorker();
    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS * 3);
    expect(getPlatformInfo).toHaveBeenCalledTimes(3);

    a();
    a(); // double release is a no-op
    expect(activeHolds()).toBe(1);
    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS);
    expect(getPlatformInfo).toHaveBeenCalledTimes(4);

    b();
    expect(activeHolds()).toBe(0);
    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS * 5);
    expect(getPlatformInfo).toHaveBeenCalledTimes(4);
  });
});
