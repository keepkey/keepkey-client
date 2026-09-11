import { describe, it, expect } from 'vitest';
import { toProviderError } from './provider-error';

const VAULT_MESSAGE =
  'KeepKey Vault is not running. Open the KeepKey Vault desktop app, then try again. Get it at https://keepkey.com/launch';

describe('toProviderError', () => {
  it('wraps a bare string so dApp libraries can inspect it', () => {
    // The regression: the background sends failures as a plain string, and
    // rejecting with a primitive made wagmi/viem/ethers throw
    // "Cannot use 'in' operator to search for 'data' in <message>",
    // hiding the actual instruction from the user.
    const err = toProviderError(VAULT_MESSAGE);

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe(VAULT_MESSAGE);
    expect(err.code).toBe(-32603);
    expect(() => 'data' in err).not.toThrow();
  });

  it('preserves an existing Error, adding a code when missing', () => {
    const original = new Error('boom');
    const err = toProviderError(original);

    expect(err).toBe(original); // same reference — stack is not discarded
    expect(err.code).toBe(-32603);
  });

  it('does not clobber a code the caller already set', () => {
    const original = Object.assign(new Error('disconnected'), { code: 4900 });
    expect(toProviderError(original).code).toBe(4900);
  });

  it('rebuilds a structured error that lost its prototype over postMessage', () => {
    const err = toProviderError({ message: 'user rejected', code: 4001, data: { hint: 'x' } });

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('user rejected');
    expect(err.code).toBe(4001);
    expect(err.data).toEqual({ hint: 'x' });
  });

  it('falls back for null, undefined and empty values', () => {
    expect(toProviderError(null, 'eth_call failed').message).toBe('eth_call failed');
    expect(toProviderError(undefined, 'eth_call failed').message).toBe('eth_call failed');
    expect(toProviderError('', 'eth_call failed').message).toBe('eth_call failed');
    expect(toProviderError({}, 'eth_call failed').message).toBe('eth_call failed');
  });

  it('never throws, whatever it is handed', () => {
    for (const input of [0, false, Symbol('s'), 123n, [], () => {}]) {
      expect(() => toProviderError(input)).not.toThrow();
      expect(toProviderError(input)).toBeInstanceOf(Error);
    }
  });
});
