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
});

describe('pending request registry', () => {
  it('registers and settles pending approvals', () => {
    registerPending({
      id: 'req-1',
      method: 'personal_sign',
      params: ['hi'],
      origin: 'https://dapp.test',
      chain: 'ethereum',
      requestedAt: Date.now(),
    });
    expect(getPendingRequests().map(r => r.id)).toContain('req-1');
    settlePending('req-1');
    expect(getPendingRequests().map(r => r.id)).not.toContain('req-1');
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
