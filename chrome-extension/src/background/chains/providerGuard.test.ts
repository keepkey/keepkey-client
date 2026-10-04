/**
 * The side-panel EVM Send must refuse to sign when the stored provider is on a
 * different chain than the asset being sent. SET_ASSET_CONTEXT leaves the old
 * provider in place when a network can't be resolved, and handleTransfer takes
 * chainId, nonce, fees and broadcast RPCs from that provider, so a silent pass
 * here means the tx is signed and broadcast on the wrong chain.
 */
import { describe, it, expect } from 'vitest';
import { assertDappChainMatchesProvider, assertProviderMatchesCaip, chainIdMatchesNetwork } from './providerGuard';

describe('assertProviderMatchesCaip', () => {
  it('passes when the provider chainId is the requested chain (hex or decimal)', () => {
    expect(() => assertProviderMatchesCaip('eip155:1/slip44:60', { chainId: '0x1' })).not.toThrow();
    expect(() => assertProviderMatchesCaip('eip155:1/slip44:60', { chainId: '1' })).not.toThrow();
    expect(() => assertProviderMatchesCaip('eip155:56/slip44:60', { chainId: '0x38' })).not.toThrow();
    expect(() => assertProviderMatchesCaip('eip155:56/slip44:60', { chainId: 56 })).not.toThrow();
  });

  it('accepts the bare CAIP-2 the network header stores as the asset caip', () => {
    expect(() => assertProviderMatchesCaip('eip155:8453', { chainId: '0x2105' })).not.toThrow();
  });

  it('throws when the provider is still on the previously selected chain', () => {
    expect(() => assertProviderMatchesCaip('eip155:8453/slip44:60', { chainId: '0x1' })).toThrow(
      /eip155:1 .*eip155:8453/,
    );
  });

  it('compares numerically, not by string prefix', () => {
    // 0x10 is chain 16, not chain 1 or 10.
    expect(() => assertProviderMatchesCaip('eip155:1/slip44:60', { chainId: '0x10' })).toThrow();
    expect(() => assertProviderMatchesCaip('eip155:10/slip44:60', { chainId: '0x10' })).toThrow();
    expect(() => assertProviderMatchesCaip('eip155:10/slip44:60', { chainId: '0xa' })).not.toThrow();
  });

  it('throws when there is no stored provider', () => {
    expect(() => assertProviderMatchesCaip('eip155:1/slip44:60', null)).toThrow(/No active EVM network/);
    expect(() => assertProviderMatchesCaip('eip155:1/slip44:60', undefined)).toThrow(/No active EVM network/);
  });

  it('throws when the provider chainId is missing or unparseable', () => {
    expect(() => assertProviderMatchesCaip('eip155:1/slip44:60', {})).toThrow(/no usable chainId/);
    expect(() => assertProviderMatchesCaip('eip155:1/slip44:60', { chainId: '1abc' })).toThrow(/no usable chainId/);
  });

  it('throws on a missing caip instead of defaulting to the provider chain', () => {
    expect(() => assertProviderMatchesCaip(undefined, { chainId: '0x1' })).toThrow(/no asset CAIP/);
    expect(() => assertProviderMatchesCaip('', { chainId: '0x1' })).toThrow(/no asset CAIP/);
  });

  it('throws on a non-EVM caip', () => {
    expect(() =>
      assertProviderMatchesCaip('bip122:000000000019d6689c085ae165831e93/slip44:0', { chainId: '0x1' }),
    ).toThrow(/Not an EVM asset/);
    expect(() => assertProviderMatchesCaip('cosmos:cosmoshub-4/slip44:118', { chainId: '0x1' })).toThrow(
      /Not an EVM asset/,
    );
  });

  it('throws coded errors, so methods.ts forwards the message instead of a generic one', () => {
    const thrown = (fn: () => void): { code?: number } => {
      try {
        fn();
      } catch (e) {
        return e as { code?: number };
      }
      throw new Error('expected a throw');
    };
    expect(thrown(() => assertProviderMatchesCaip('eip155:8453', { chainId: '0x1' })).code).toBe(4901);
    expect(thrown(() => assertProviderMatchesCaip(undefined, { chainId: '0x1' })).code).toBe(4000);
  });

  it('throws on a token caip even when the chain matches (only native sends are built)', () => {
    expect(() =>
      assertProviderMatchesCaip('eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', { chainId: '0x1' }),
    ).toThrow(/Token sends are not supported/);
  });
});

// SET_ASSET_CONTEXT uses this to decide whether a custom record may become the
// signing provider, and whether a Pioneer miss really leaves the wrong chain.
describe('chainIdMatchesNetwork', () => {
  it('is true when the chainId is the networkId (hex or decimal)', () => {
    expect(chainIdMatchesNetwork('eip155:1', '0x1')).toBe(true);
    expect(chainIdMatchesNetwork('eip155:56', '56')).toBe(true);
    expect(chainIdMatchesNetwork('eip155:8453', 8453)).toBe(true);
  });

  it('is false for another chain', () => {
    expect(chainIdMatchesNetwork('eip155:8453', '0x1')).toBe(false);
    expect(chainIdMatchesNetwork('eip155:1', '0x10')).toBe(false);
  });

  it('is false for a record with no usable chainId, e.g. a persisted { error } reply', () => {
    const errorRecord: { chainId?: string; error: string } = { error: 'Failed to fetch asset info' };
    expect(chainIdMatchesNetwork('eip155:8453', errorRecord.chainId)).toBe(false);
    expect(chainIdMatchesNetwork('eip155:1', 'nope')).toBe(false);
  });

  it('is false for a non-EVM or malformed networkId', () => {
    expect(chainIdMatchesNetwork('cosmos:cosmoshub-4', '0x1')).toBe(false);
    expect(chainIdMatchesNetwork('eip155:', '')).toBe(false);
    expect(chainIdMatchesNetwork('eip155:', undefined)).toBe(false);
  });
});

// dApp txs: signing overwrites tx.chainId with the provider's, and a side-panel
// network switch never reaches the page, so a mismatch must be refused.
describe('assertDappChainMatchesProvider', () => {
  it('passes when the dApp chainId is the provider chain (hex, decimal or number)', () => {
    expect(() => assertDappChainMatchesProvider('0x1', { chainId: '1' })).not.toThrow();
    expect(() => assertDappChainMatchesProvider(8453, { chainId: '0x2105' })).not.toThrow();
    expect(() => assertDappChainMatchesProvider('56', { chainId: 56 })).not.toThrow();
  });

  it('passes when the dApp did not set a chainId (it means the eth_chainId chain)', () => {
    expect(() => assertDappChainMatchesProvider(undefined, { chainId: '0x1' })).not.toThrow();
    expect(() => assertDappChainMatchesProvider(null, { chainId: '0x1' })).not.toThrow();
    expect(() => assertDappChainMatchesProvider('', { chainId: '0x1' })).not.toThrow();
  });

  it('refuses a tx built for another chain with 4901', () => {
    let err: any;
    try {
      assertDappChainMatchesProvider('0x1', { chainId: '0x2105' });
    } catch (e) {
      err = e;
    }
    expect(err?.code).toBe(4901);
    expect(err?.message).toMatch(/eip155:1 but KeepKey is on eip155:8453/);
  });

  it('refuses when the provider is missing or the dApp chainId is garbage', () => {
    expect(() => assertDappChainMatchesProvider('0x1', null)).toThrow(/no network/);
    expect(() => assertDappChainMatchesProvider('mainnet', { chainId: '0x1' })).toThrow(/mainnet/);
  });
});
