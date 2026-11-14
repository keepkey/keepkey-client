import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureQueryKey, pioneerFetch } from './pioneerKey';

const API = 'https://api.keepkey.info';
const KEY = 'keepkey-pioneer-query-key';
const REG = 'keepkey-pioneer-query-key-registered';
const OLD_KEY = 'bex:0b6c1f2e-4d7a-4c1e-9f0a-2a3b4c5d6e7f'; // 0.0.39 shape, 40 chars

let store: Record<string, unknown>;
const fetchMock = vi.fn();

const res = (status: number, servedBy?: string, body = '{}', extra: Record<string, string> = {}) =>
  new Response(status === 204 ? null : body, {
    status,
    headers: { ...(servedBy ? { 'x-kk-served-by': servedBy } : {}), ...extra },
  });

const registerCalls = () => fetchMock.mock.calls.filter(([url]) => url === `${API}/api/v1/user/register`);

beforeEach(() => {
  store = {};
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (k: string) => (k in store ? { [k]: store[k] } : {}),
        set: async (o: Record<string, unknown>) => void Object.assign(store, o),
      },
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ensureQueryKey', () => {
  it('fresh install: mints a bex: key, registers it once with the gateway body, persists the flag', async () => {
    fetchMock.mockResolvedValue(res(200, 'gateway'));
    const key = await ensureQueryKey();
    expect(key).toMatch(/^bex:[0-9a-f-]{36}$/);
    expect(store[KEY]).toBe(key);
    expect(store[REG]).toBe(`${API}\n${key}`);
    const [[url, init]] = registerCalls();
    expect(url).toBe(`${API}/api/v1/user/register`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ username: key.slice(0, 32), queryKey: key });
  });

  it('0.0.39 upgrade: keeps the existing key, registers exactly once, then never again (worker restart)', async () => {
    store[KEY] = OLD_KEY;
    fetchMock.mockResolvedValue(res(200, 'gateway'));
    expect(await ensureQueryKey()).toBe(OLD_KEY);
    expect(await ensureQueryKey()).toBe(OLD_KEY);
    expect(registerCalls()).toHaveLength(1);
    expect(store[REG]).toBe(`${API}\n${OLD_KEY}`);
  });

  it('re-registers when the flag belongs to a different key', async () => {
    store[KEY] = OLD_KEY;
    store[REG] = `${API}\nbex:some-other-key-that-was-registered-before`;
    fetchMock.mockResolvedValue(res(200, 'gateway'));
    await ensureQueryKey();
    expect(registerCalls()).toHaveLength(1);
  });

  it('force=true re-registers even with a matching flag', async () => {
    store[KEY] = OLD_KEY;
    store[REG] = `${API}\n${OLD_KEY}`;
    fetchMock.mockResolvedValue(res(200, 'gateway'));
    await ensureQueryKey(true);
    expect(registerCalls()).toHaveLength(1);
  });

  it('replaces a stored key that is too short or has whitespace', async () => {
    store[KEY] = 'key:public-123';
    fetchMock.mockResolvedValue(res(200, 'gateway'));
    const key = await ensureQueryKey();
    expect(key).not.toBe('key:public-123');
    expect(key).toMatch(/^bex:/);
  });

  it('treats 409 as registered', async () => {
    store[KEY] = OLD_KEY;
    fetchMock.mockResolvedValue(res(409, 'gateway'));
    expect(await ensureQueryKey()).toBe(OLD_KEY);
    expect(store[REG]).toBe(`${API}\n${OLD_KEY}`);
  });

  it('403 credential_disabled rotates to a new key once', async () => {
    store[KEY] = OLD_KEY;
    fetchMock.mockResolvedValueOnce(res(403, 'gateway')).mockResolvedValueOnce(res(200, 'gateway'));
    const key = await ensureQueryKey();
    expect(key).not.toBe(OLD_KEY);
    expect(store[KEY]).toBe(key);
    expect(store[REG]).toBe(`${API}\n${key}`);
    expect(registerCalls()).toHaveLength(2);
  });

  it('403 on the rotated key too: throws, no further rotation', async () => {
    store[KEY] = OLD_KEY;
    fetchMock.mockResolvedValue(res(403, 'gateway'));
    await expect(ensureQueryKey()).rejects.toThrow('pioneer key disabled');
    expect(registerCalls()).toHaveLength(2);
  });

  it('400 throws without retrying', async () => {
    store[KEY] = OLD_KEY;
    fetchMock.mockResolvedValue(res(400, 'gateway'));
    await expect(ensureQueryKey()).rejects.toThrow('pioneer register rejected key');
    expect(registerCalls()).toHaveLength(1);
    expect(store[REG]).toBeUndefined();
  });

  it('429 honours Retry-After (capped) and retries', async () => {
    vi.useFakeTimers();
    store[KEY] = OLD_KEY;
    fetchMock
      .mockResolvedValueOnce(res(429, undefined, '{}', { 'Retry-After': '3' }))
      .mockResolvedValueOnce(res(200, 'gateway'));
    const p = ensureQueryKey();
    await vi.advanceTimersByTimeAsync(2_999);
    expect(registerCalls()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2_000 + 1); // Retry-After 3s, then the 2s schedule slot
    expect(await p).toBe(OLD_KEY);
    expect(registerCalls()).toHaveLength(2);
  });

  it('network errors walk the short retry schedule, then throw', async () => {
    vi.useFakeTimers();
    store[KEY] = OLD_KEY;
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const p = ensureQueryKey();
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(22_000);
    await expect(p).rejects.toThrow('pioneer register failed');
    expect(registerCalls()).toHaveLength(4);
  });

  it('concurrent callers share one registration', async () => {
    store[KEY] = OLD_KEY;
    fetchMock.mockResolvedValue(res(200, 'gateway'));
    const [a, b, c] = await Promise.all([ensureQueryKey(), ensureQueryKey(), ensureQueryKey(true)]);
    expect(new Set([a, b, c])).toEqual(new Set([OLD_KEY]));
    expect(registerCalls()).toHaveLength(1);
  });
});

describe('pioneerFetch', () => {
  beforeEach(() => {
    store[KEY] = OLD_KEY;
    store[REG] = `${API}\n${OLD_KEY}`;
  });

  const dataCalls = () => fetchMock.mock.calls.filter(([url]) => url !== `${API}/api/v1/user/register`);

  it('sends the raw key in Authorization (no Bearer), drops x-api-key, keeps the init', async () => {
    fetchMock.mockResolvedValue(res(200, 'gateway', '[1]'));
    const r = await pioneerFetch('/api/v1/market/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'junk' },
      body: '["x"]',
    });
    expect(r.status).toBe(200);
    const [[url, init]] = fetchMock.mock.calls;
    expect(url).toBe(`${API}/api/v1/market/info`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe('["x"]');
    const h = init.headers as Headers;
    expect(h.get('Authorization')).toBe(OLD_KEY);
    expect(h.get('x-api-key')).toBeNull();
    expect(h.get('Content-Type')).toBe('application/json');
    expect(registerCalls()).toHaveLength(0);
  });

  it('a gateway non-ok is returned as-is (no re-register, no retry)', async () => {
    fetchMock.mockResolvedValue(res(429));
    const r = await pioneerFetch('/api/v1/portfolio/balances');
    expect(r.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a green answer re-registers once and retries once', async () => {
    fetchMock
      .mockResolvedValueOnce(res(404, 'green')) // keyed read replayed to green
      .mockResolvedValueOnce(res(200, 'gateway')) // force re-register
      .mockResolvedValueOnce(res(200, 'gateway', '{"balances":[]}'));
    const r = await pioneerFetch('/api/v1/portfolio/balances', { method: 'POST', body: '{}' });
    expect(r.headers.get('x-kk-served-by')).toBe('gateway');
    expect(registerCalls()).toHaveLength(1);
    expect(dataCalls()).toHaveLength(2);
  });

  it('still green after the retry: warns and returns the green response', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock
      .mockResolvedValueOnce(res(200, 'green'))
      .mockResolvedValueOnce(res(200, 'gateway'))
      .mockResolvedValueOnce(res(200, 'green', '{"data":[0.2]}'));
    const r = await pioneerFetch('/api/v1/market/info');
    expect(r.headers.get('x-kk-served-by')).toBe('green');
    expect(await r.json()).toEqual({ data: [0.2] });
    expect(dataCalls()).toHaveLength(2);
    expect(warn).toHaveBeenCalledWith('[pioneer] keyed call still served by green', '/api/v1/market/info', 200);
    warn.mockRestore();
  });
});
