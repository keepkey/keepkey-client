import { describe, it, expect } from 'vitest';
import { getLastResortRpcs } from './lastResortRpcs';

describe('getLastResortRpcs', () => {
  it('returns the configured fallback URLs for a known chain', () => {
    const eth = getLastResortRpcs('eip155:1');
    expect(eth.length).toBeGreaterThan(0);
    expect(eth.every(u => u.startsWith('https://'))).toBe(true);
  });

  it('returns an empty list for an unknown chain', () => {
    expect(getLastResortRpcs('eip155:999999')).toEqual([]);
  });

  it('returns a defensive copy (callers cannot mutate the source table)', () => {
    const a = getLastResortRpcs('eip155:1');
    const originalLength = a.length;
    a.push('https://evil.example');
    const b = getLastResortRpcs('eip155:1');
    expect(b).toHaveLength(originalLength);
    expect(b).not.toContain('https://evil.example');
  });

  it('uses caip-2 (eip155:N) network ids, not bare hex chainIds', () => {
    // Guards against a caller passing "0x1" and silently getting no fallback.
    expect(getLastResortRpcs('0x1')).toEqual([]);
    expect(getLastResortRpcs('eip155:1').length).toBeGreaterThan(0);
  });

  it('lists no endpoint that requires an API key (per module contract)', () => {
    for (const id of ['eip155:1', 'eip155:10', 'eip155:137', 'eip155:42161']) {
      for (const url of getLastResortRpcs(id)) {
        expect(url).not.toMatch(/(api[_-]?key|\/v[0-9]+\/[A-Za-z0-9]{20,})/i);
      }
    }
  });
});
