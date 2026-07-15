import { describe, it, expect } from 'vitest';
import {
  recordProviderCall,
  getLogs,
  registerPending,
  settlePending,
  getPendingRequests,
  recordSite,
  getConnectedSites,
} from './providerLog';

const entry = (over: Partial<Parameters<typeof recordProviderCall>[0]> = {}) => ({
  ts: Date.now(),
  origin: 'https://dapp.test',
  chain: 'ethereum',
  method: 'eth_chainId',
  params: [],
  durationMs: 1,
  ...over,
});

describe('providerLog ring buffer', () => {
  it('records calls and filters by pattern (method, origin, errorMessage)', () => {
    recordProviderCall(
      entry({ method: 'wallet_switchEthereumChain', errorCode: -32002, errorMessage: 'already pending' }),
    );
    recordProviderCall(entry({ method: 'eth_requestAccounts' }));

    expect(getLogs({ pattern: 'switchEthereum' })).toHaveLength(1);
    expect(getLogs({ pattern: 'already pending' })[0].errorCode).toBe(-32002);
    expect(getLogs({ pattern: 'no-such-thing' })).toHaveLength(0);
  });

  it('filters by since and caps by limit, newest last', () => {
    const cutoff = Date.now() + 1000;
    recordProviderCall(entry({ ts: cutoff + 1, method: 'later_call' }));
    const since = getLogs({ since: cutoff });
    expect(since.every(e => e.ts >= cutoff)).toBe(true);

    for (let i = 0; i < 10; i++) recordProviderCall(entry({ method: `m${i}` }));
    const limited = getLogs({ limit: 3 });
    expect(limited).toHaveLength(3);
    expect(limited[2].method).toBe('m9');
  });

  it('caps the buffer at 500 entries', () => {
    for (let i = 0; i < 600; i++) recordProviderCall(entry());
    expect(getLogs({ limit: 10_000 }).length).toBeLessThanOrEqual(500);
  });

  it('never throws on unserializable params/results', () => {
    // Runs on the success path of every provider call — a stringify failure
    // here must not surface as a dApp-visible error.
    const circular: any = { self: null };
    circular.self = circular;
    expect(() => recordProviderCall(entry({ method: 'circular_call', params: circular }))).not.toThrow();
    expect(() => recordProviderCall(entry({ method: 'bigint_call', result: { v: 1n } }))).not.toThrow();
    expect(getLogs({ pattern: 'bigint_call' })[0].result).toBe('[unserializable]');
  });
});

describe('pending request registry', () => {
  const pending = (over: Partial<Omit<Parameters<typeof registerPending>[0], never>> = {}) => ({
    id: 'req-1',
    method: 'personal_sign',
    params: ['hi'],
    origin: 'https://dapp.test',
    chain: 'ethereum',
    requestedAt: Date.now(),
    ...over,
  });

  it('registers and settles pending approvals by internal key', () => {
    const key = registerPending(pending());
    expect(getPendingRequests().map(r => r.key)).toContain(key);
    settlePending(key);
    expect(getPendingRequests().map(r => r.key)).not.toContain(key);
  });

  it('keeps two tabs separate when the dApps supply the SAME id', () => {
    // dApp ids are per-page counters — both tabs say id 1.
    const a = registerPending(pending({ id: '1', origin: 'https://a.test' }));
    const b = registerPending(pending({ id: '1', origin: 'https://b.test' }));
    expect(a).not.toBe(b);
    expect(getPendingRequests().filter(r => r.id === '1')).toHaveLength(2);

    // Settling one must not evict the other's prompt.
    settlePending(a);
    const left = getPendingRequests().filter(r => r.id === '1');
    expect(left).toHaveLength(1);
    expect(left[0].origin).toBe('https://b.test');
    settlePending(b);
  });

  it('ignores a null/undefined key (register never ran)', () => {
    const before = getPendingRequests().length;
    settlePending(null);
    settlePending(undefined);
    expect(getPendingRequests()).toHaveLength(before);
  });
});

describe('connected sites', () => {
  it('aggregates chains per origin and ignores empty origins', () => {
    recordSite('https://swaps.pro', 'ethereum');
    recordSite('https://swaps.pro', 'thorchain');
    recordSite('', 'ethereum');

    const site = getConnectedSites().find(s => s.origin === 'https://swaps.pro');
    expect(site?.chains.sort()).toEqual(['ethereum', 'thorchain']);
    expect(getConnectedSites().some(s => s.origin === '')).toBe(false);
  });
});
