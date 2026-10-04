/**
 * wallet_getCapabilities must answer `{}` — "no batching on any chain" under
 * final EIP-5792. The early-draft reply keyed capabilities by address, which
 * viem Number()s into garbage chain ids. Malformed params get -32602.
 */
import { describe, it, expect } from 'vitest';
import { methodNotAvailableMessage, walletGetCapabilities } from './eip5792';

const LOWER = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
const CHECKSUMMED = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

describe('walletGetCapabilities', () => {
  it.each([LOWER, CHECKSUMMED])('returns {} for %s', address => {
    const caps = walletGetCapabilities([address]);
    expect(caps).toEqual({});
    expect(JSON.stringify(caps)).toBe('{}');
  });

  it('ignores the optional chainIds filter', () => {
    expect(walletGetCapabilities([LOWER, ['0x1', '0x2105']])).toEqual({});
    expect(walletGetCapabilities([LOWER, null])).toEqual({});
  });

  it.each([
    ['empty params', []],
    ['a null address', [null]],
    ['missing params', undefined],
    ['a short address', ['0x123']],
    ['no 0x prefix', [LOWER.slice(2)]],
  ])('rejects %s with -32602', (_label, params) => {
    expect(() => walletGetCapabilities(params)).toThrow(expect.objectContaining({ code: -32602 }));
  });
});

describe('methodNotAvailableMessage', () => {
  // viem's sendCalls experimental_fallback keys off this exact substring.
  it('uses the wording viem falls back on', () => {
    expect(methodNotAvailableMessage('wallet_sendCalls')).toContain('does not exist / is not available');
  });
});
