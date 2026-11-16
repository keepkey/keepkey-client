import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSwapStatus } from '../../../pages/side-panel/src/swap/swapApi';
import { swapTiming } from '../../../pages/side-panel/src/swap/swapTiming';

afterEach(() => vi.unstubAllGlobals());
describe('live swap status reads', () => {
  it('coalesces polling and manual refresh while a request is in flight', async () => {
    let finish!: (value: unknown) => void;
    const sendMessage = vi.fn((_message, callback) => {
      finish = callback;
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    const a = fetchSwapStatus('coalesce');
    const b = fetchSwapStatus('coalesce', true);
    expect(a).toBe(b);
    expect(sendMessage).toHaveBeenCalledOnce();
    finish({ ok: true, status: 200, data: { status: 'completed', receivedOutput: '0.006011' } });
    expect(await a).toMatchObject({ status: 'completed' });
  });
  it('surfaces errors and allows the next manual refresh to retry', async () => {
    const sendMessage = vi.fn((_message, callback) =>
      callback({ ok: false, status: 502, error: 'Provider unavailable' }),
    );
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    await expect(fetchSwapStatus('retry')).rejects.toThrow('Provider unavailable');
    await expect(fetchSwapStatus('retry', true)).rejects.toThrow('Provider unavailable');
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[1][0]).toMatchObject({ action: 'status', txid: 'retry', rescan: true });
  });
  it('retains the initial registration 404 as a waiting state', async () => {
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: (_message: unknown, callback: (v: unknown) => void) => callback({ ok: false, status: 404 }),
      },
    });
    expect(await fetchSwapStatus('not-registered')).toBeNull();
  });
});
describe('swap time display', () => {
  it('keeps elapsed time moving past the quoted estimate', () => {
    expect(swapTiming(1000, 44000, 42)).toEqual({ elapsed: '00:43', estimate: '00:42', overdue: true });
    expect(swapTiming(1000, 302000, 42).elapsed).toBe('05:01');
  });
  it('uses the original submission time when reopening and freezes at settlement', () => {
    expect(swapTiming(1000, 900000, 42, 61000)).toEqual({ elapsed: '01:00', estimate: '00:42', overdue: false });
  });
  it('does not invent a nine-minute estimate when the provider supplied none', () => {
    expect(swapTiming(1000, 2000)).toEqual({ elapsed: '00:01', estimate: undefined, overdue: false });
    expect(swapTiming(2000, 1000).elapsed).toBe('00:00');
  });
});
