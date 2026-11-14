import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPortfolioEntries } from './portfolioBalances';

const API = 'https://api.keepkey.info';
const KEY = 'bex:0b6c1f2e-4d7a-4c1e-9f0a-2a3b4c5d6e7f';
const GATEWAY = `${API}/api/v1/portfolio/balances`;
const LEGACY = `${API}/api/v1/portfolio`;

const ETH = { caip: 'eip155:1/slip44:60', pubkey: '0xabc' };
const BTC = { caip: 'bip122:000000000019d6689c085ae165831e93/slip44:0', pubkey: 'xpub-test' };
const TRX = { caip: 'tron:27Lqcw/slip44:195', pubkey: 'TTestAddress' };

// Last commit's rows (final shape, as cachedBalances holds them).
const previous = [
  { networkId: 'eip155:1', caip: 'eip155:1/slip44:60', balance: '1', isNative: true },
  { networkId: 'eip155:1', caip: 'eip155:1/erc20:0xusdc', balance: '5', token: true },
  { networkId: 'bip122:000000000019d6689c085ae165831e93', caip: BTC.caip, balance: '0.1', isNative: true },
  { networkId: 'tron:27Lqcw', caip: 'tron:27Lqcw/slip44:195', balance: '10', isNative: true },
  { networkId: 'tron:27Lqcw', caip: 'tron:27Lqcw/trc20:TR7NHq', balance: '42', token: true },
  // custom-RPC chain row: not part of any request, so never carried
  { networkId: 'eip155:999', caip: 'eip155:999/slip44:60', balance: '3', isNative: true },
];

const json = (body: unknown, status = 200, servedBy = 'gateway') =>
  new Response(JSON.stringify(body), { status, headers: { 'x-kk-served-by': servedBy } });

const fetchMock = vi.fn();
const callsTo = (url: string) => fetchMock.mock.calls.filter(([u]) => String(u).split('?')[0] === url);

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  const store: Record<string, unknown> = {
    'keepkey-pioneer-query-key': KEY,
    'keepkey-pioneer-query-key-registered': `${API}\n${KEY}`,
  };
  vi.stubGlobal('chrome', {
    storage: { local: { get: async (k: string) => ({ [k]: store[k] }), set: async () => {} } },
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const route = (gateway: () => Response, legacy: () => Response) =>
  fetchMock.mockImplementation(async (url: string) => (String(url).startsWith(GATEWAY) ? gateway() : legacy()));

describe('fetchPortfolioEntries: requests', () => {
  it('sends non-Tron pubkeys to the gateway with the registered key and refreshReason', async () => {
    route(
      () => json({ balances: [] }),
      () => json({ balances: [] }, 200, 'green'),
    );
    await fetchPortfolioEntries([ETH, BTC, TRX], false, 'wallet-open', []);
    const [[url, init]] = callsTo(GATEWAY);
    expect(url).toBe(GATEWAY);
    expect(init.method).toBe('POST');
    expect((init.headers as Headers).get('Authorization')).toBe(KEY);
    expect(JSON.parse(init.body)).toEqual({ pubkeys: [ETH, BTC], refreshReason: 'wallet-open' });
  });

  it.each(['wallet-open', 'manual', 'automatic'] as const)('passes refreshReason %s through', async reason => {
    route(
      () => json({ balances: [] }),
      () => json({ balances: [] }),
    );
    await fetchPortfolioEntries([ETH], true, reason, []);
    const [[url, init]] = callsTo(GATEWAY);
    expect(url).toBe(`${GATEWAY}?forceRefresh=true`);
    expect(JSON.parse(init.body).refreshReason).toBe(reason);
  });

  it('keeps Tron on the exact 0.0.39 legacy request (URL, body, auth)', async () => {
    route(
      () => json({ balances: [] }),
      () => json({ balances: [] }, 200, 'green'),
    );
    await fetchPortfolioEntries([ETH, TRX], true, 'manual', []);
    const [[url, init]] = callsTo(LEGACY);
    expect(url).toBe(`${LEGACY}?forceRefresh=true`);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers.Authorization).toMatch(/^key:public-\d+$/);
    expect(JSON.parse(init.body)).toEqual({ pubkeys: [TRX] });
  });

  it('makes no legacy request without a Tron pubkey, and no gateway request with only Tron', async () => {
    route(
      () => json({ balances: [] }),
      () => json({ balances: [] }),
    );
    await fetchPortfolioEntries([ETH], false, 'automatic', []);
    expect(callsTo(LEGACY)).toHaveLength(0);
    fetchMock.mockClear();
    await fetchPortfolioEntries([TRX], false, 'automatic', []);
    expect(callsTo(GATEWAY)).toHaveLength(0);
    expect(callsTo(LEGACY)).toHaveLength(1);
  });

  it('logs each meta.failures entry', async () => {
    route(
      () => json({ balances: [], meta: { failures: [{ caip: 'eip155:4663/slip44:60', reason: 'rpc down' }] } }),
      () => json({ balances: [] }),
    );
    await fetchPortfolioEntries([ETH], false, 'automatic', []);
    expect(console.warn).toHaveBeenCalledWith('[fetchBalances] gateway dropped', 'eip155:4663/slip44:60', 'rpc down');
  });
});

describe('fetchPortfolioEntries: partial failure keeps last-known rows', () => {
  const gwRows = [{ caip: ETH.caip, balance: '2' }];
  const tronRows = [{ caip: 'tron:27lqcw/slip44:195', balance: '11' }];

  it('both ok: fresh rows from both, nothing carried', async () => {
    route(
      () => json({ balances: gwRows }),
      () => json({ balances: tronRows }, 200, 'green'),
    );
    const r = await fetchPortfolioEntries([ETH, TRX], false, 'automatic', previous);
    expect(r).toEqual({ entries: [...gwRows, ...tronRows], carried: [], error: null, lost: false });
  });

  it('gateway fails: Tron rows are fresh, gateway networks carry their last-known rows', async () => {
    route(
      () => json({ error: 'boom' }, 503, ''),
      () => json({ balances: tronRows }, 200, 'green'),
    );
    const r = await fetchPortfolioEntries([ETH, BTC, TRX], false, 'automatic', previous);
    expect(r.entries).toEqual(tronRows);
    expect(r.carried.map(b => b.caip)).toEqual(['eip155:1/slip44:60', 'eip155:1/erc20:0xusdc', BTC.caip]);
    expect(r.error).toMatch(/HTTP 503 from \/api\/v1\/portfolio\/balances/);
  });

  it('gateway 429 with an empty cache: the error is surfaced and the failed side is marked lost', async () => {
    route(
      () => json({ error: 'rate limited' }, 429),
      () => json({ balances: tronRows }, 200, 'green'),
    );
    const r = await fetchPortfolioEntries([ETH, BTC, TRX], true, 'wallet-open', []);
    expect(r.entries).toEqual(tronRows);
    expect(r.carried).toEqual([]);
    expect(r.error).toMatch(/HTTP 429/);
    // No cache at all: committing Tron alone would show a Tron-only wallet with
    // the error hidden, so the caller must not commit.
    expect(r.lost).toBe(true);
  });

  it('a failed side with last-known rows to keep is not lost', async () => {
    route(
      () => json({ error: 'rate limited' }, 429),
      () => json({ balances: tronRows }, 200, 'green'),
    );
    const r = await fetchPortfolioEntries([ETH, TRX], false, 'automatic', previous);
    expect(r.error).toMatch(/HTTP 429/);
    expect(r.lost).toBe(false);
  });

  it('with a cache, a failed side that had no rows is not lost (nothing of it to wipe)', async () => {
    route(
      () => json({ balances: gwRows }),
      () => json({ error: 'nope' }, 502, 'green'),
    );
    const noTron = previous.filter(b => !b.networkId.startsWith('tron:'));
    const r = await fetchPortfolioEntries([ETH, TRX], false, 'automatic', noTron);
    expect(r.carried).toEqual([]);
    expect(r.error).toMatch(/HTTP 502/);
    expect(r.lost).toBe(false);
  });

  it('Tron fails: gateway rows are fresh, Tron carries its last-known TRX + TRC-20 rows', async () => {
    route(
      () => json({ balances: gwRows }),
      () => json({ error: 'nope' }, 404, 'green'),
    );
    const r = await fetchPortfolioEntries([ETH, TRX], false, 'automatic', previous);
    expect(r.entries).toEqual(gwRows);
    expect(r.carried.map(b => b.caip)).toEqual(['tron:27Lqcw/slip44:195', 'tron:27Lqcw/trc20:TR7NHq']);
    expect(r.error).toMatch(/HTTP 404/);
  });

  it('both fail: no fresh rows, both sides carried', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const r = await fetchPortfolioEntries([ETH, TRX], false, 'automatic', previous);
    expect(r.entries).toEqual([]);
    expect(r.carried).toHaveLength(4);
    expect(r.error).toBeTruthy();
  });

  // gateway container/src/portfolio.ts: when Zerion throws for an address (cache-only
  // 409, provider budget 429/503) the native still comes from direct RPC, the token
  // rows are missing, and each of that address's EVM caips gets this failure.
  const TOKEN_DISCOVERY_DOWN = 'Token discovery unavailable; last known balances must be retained';

  it('a 200 with meta.failures for eip155:1 carries that network’s last-known rows it did not return', async () => {
    route(
      () =>
        json({
          balances: [{ caip: 'eip155:1/slip44:60', balance: '2' }],
          meta: { failures: [{ caip: ETH.caip, reason: TOKEN_DISCOVERY_DOWN }] },
        }),
      () => json({ balances: tronRows }, 200, 'green'),
    );
    const r = await fetchPortfolioEntries([ETH, BTC, TRX], false, 'automatic', previous);
    expect(r.entries.map(b => b.caip)).toEqual(['eip155:1/slip44:60', ...tronRows.map(b => b.caip)]);
    // The fresh native wins; only the ERC-20 row the response left out is carried.
    expect(r.carried.map(b => b.caip)).toEqual(['eip155:1/erc20:0xusdc']);
    expect(r.carried[0]).not.toBe(previous[1]);
    expect(r.error).toBeNull();
  });

  it('a failure that still returned the row (Price unavailable) carries nothing', async () => {
    route(
      () =>
        json({
          balances: [{ caip: 'eip155:1/slip44:60', balance: '2' }],
          meta: { failures: [{ caip: ETH.caip, reason: 'Price unavailable: timeout' }] },
        }),
      () => json({ balances: [] }),
    );
    const r = await fetchPortfolioEntries([ETH], false, 'automatic', previous);
    expect(r.carried).toEqual([]);
  });

  it('carried rows are copies, not the cached objects', async () => {
    route(
      () => json({ balances: gwRows }),
      () => json({}, 500),
    );
    const r = await fetchPortfolioEntries([ETH, TRX], false, 'automatic', previous);
    expect(r.carried[0]).toEqual(previous[3]);
    expect(r.carried[0]).not.toBe(previous[3]);
  });
});
