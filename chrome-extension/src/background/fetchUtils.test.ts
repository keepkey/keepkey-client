import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithTimeout, fetchJsonWithTimeout } from './fetchUtils';

// Build a minimal Response-like stub — only the fields the helpers touch.
const resp = (status: number, body: unknown = '') =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
  }) as unknown as Response;

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  // Fake timers so retry backoff sleeps are deterministic and instant.
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Drive a fetchUtils promise to completion while flushing backoff timers.
// The swallowing `.catch` keeps a rejection from being "unhandled" during
// the timer advance; the original `p` is still returned so `expect().rejects`
// observes it normally.
async function run<T>(p: Promise<T>): Promise<T> {
  p.catch(() => {});
  await vi.advanceTimersByTimeAsync(5000); // covers 200+400+800ms backoffs, under the 8s budget
  return p;
}

describe('fetchWithTimeout', () => {
  it('returns the response on first success (no retry)', async () => {
    fetchMock.mockResolvedValueOnce(resp(200, 'ok'));
    const r = await run(fetchWithTimeout('https://x.test'));
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry a 4xx — returns it for the caller to handle', async () => {
    fetchMock.mockResolvedValue(resp(404, 'nope'));
    const r = await run(fetchWithTimeout('https://x.test', {}, { retries: 2 }));
    expect(r.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a 5xx up to the budget, then returns the last response', async () => {
    fetchMock.mockResolvedValue(resp(503, 'down'));
    const r = await run(fetchWithTimeout('https://x.test', {}, { retries: 2 }));
    expect(r.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it('recovers when a transient 5xx is followed by a success', async () => {
    fetchMock.mockResolvedValueOnce(resp(502)).mockResolvedValueOnce(resp(200, 'recovered'));
    const r = await run(fetchWithTimeout('https://x.test', {}, { retries: 2 }));
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a thrown network/timeout error, then succeeds', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down')).mockResolvedValueOnce(resp(200, 'ok'));
    const r = await run(fetchWithTimeout('https://x.test', {}, { retries: 2 }));
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws the last error after every attempt throws', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    await expect(run(fetchWithTimeout('https://x.test', {}, { retries: 1 }))).rejects.toThrow('boom');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('honors a custom retryOn predicate', async () => {
    fetchMock.mockResolvedValue(resp(429, 'rate limited'));
    // Default treats 429 as non-transient (4xx); a custom predicate opts in.
    const r = await run(fetchWithTimeout('https://x.test', {}, { retries: 1, retryOn: s => s === 429 }));
    expect(r.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('fetchJsonWithTimeout', () => {
  it('parses and returns JSON on success', async () => {
    fetchMock.mockResolvedValueOnce(resp(200, { hello: 'world' }));
    const data = await run(fetchJsonWithTimeout<{ hello: string }>('https://x.test'));
    expect(data).toEqual({ hello: 'world' });
  });

  it('throws with the status and url on a non-OK response', async () => {
    fetchMock.mockResolvedValue(resp(500, 'server error'));
    await expect(run(fetchJsonWithTimeout('https://x.test'))).rejects.toThrow(/HTTP 500 from https:\/\/x\.test/);
  });
});
