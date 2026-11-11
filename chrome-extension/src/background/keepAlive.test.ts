import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withServiceWorkerKeepAlive } from './keepAlive';

describe('interactive request worker lifetime', () => {
  const getPlatformInfo = vi.fn().mockResolvedValue({});
  beforeEach(() => {
    vi.useFakeTimers();
    getPlatformInfo.mockClear();
    vi.stubGlobal('chrome', { runtime: { getPlatformInfo } });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps calling a Chrome API beyond ten minutes and stops once the signature arrives', async () => {
    let sign!: (signature: string) => void;
    const result = withServiceWorkerKeepAlive(
      () =>
        new Promise<string>(resolve => {
          sign = resolve;
        }),
    );
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    expect(getPlatformInfo.mock.calls.length).toBeGreaterThan(30);
    sign('signed');
    await expect(result).resolves.toBe('signed');
    const calls = getPlatformInfo.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getPlatformInfo).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up when the operation fails', async () => {
    await expect(
      withServiceWorkerKeepAlive(async () => {
        throw new Error('User rejected');
      }),
    ).rejects.toThrow('User rejected');
    expect(vi.getTimerCount()).toBe(0);
  });
});
