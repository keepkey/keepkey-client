/**
 * window.hive_keychain shim. skatehive.app reads `hive_keychain?.isKeepKey`
 * to offer Hive login through the KeepKey button, and calls Keychain's
 * requestSignBuffer for it.
 */
import { describe, expect, it, vi } from 'vitest';
import { createHiveKeychainShim } from './hive-provider';

const make = () => {
  const walletRequest = vi.fn((_method: string, _params: any[], _chain: any, cb: (e: any, r?: any) => void) =>
    cb(null, { result: 'sig', publicKey: 'STM7key' }),
  );
  return { shim: createHiveKeychainShim(walletRequest), walletRequest };
};

describe('createHiveKeychainShim', () => {
  it('identifies itself as KeepKey', () => {
    const { shim } = make();
    expect(shim.isKeepKey).toBe(true);
    expect(typeof shim.requestSignBuffer).toBe('function');
  });

  it('requestSignBuffer (login) reaches the background with account, message, key and title', () => {
    const { shim, walletRequest } = make();
    const callback = vi.fn();
    shim.requestSignBuffer('sopadevs', 'Login to Skatehive 1764171600000', 'Posting', callback, undefined, 'Login');
    expect(walletRequest).toHaveBeenCalledWith(
      'hive_signBuffer',
      [
        {
          type: 'signBuffer',
          username: 'sopadevs',
          message: 'Login to Skatehive 1764171600000',
          method: 'Posting',
          rpc: undefined,
          title: 'Login',
        },
      ],
      'hive',
      expect.any(Function),
    );
    // Keychain's response shape: publicKey beside result.
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, result: 'sig', publicKey: 'STM7key' }),
    );
  });

  it('unsupported Keychain methods fail gracefully through the callback', () => {
    const { shim, walletRequest } = make();
    const callback = vi.fn();
    shim.requestWitnessVote('sopadevs', 'witness', true, callback);
    expect(walletRequest).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});

describe('Hive request timeouts', () => {
  it('Hive Keychain requests wait like other interactive requests (approval card, key import/unlock)', async () => {
    const { requestTimeoutFor, INTERACTIVE_REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS } =
      await import('./requestTimeouts');
    for (const m of [
      'hive_post',
      'hive_vote',
      'hive_customJson',
      'hive_broadcast',
      'hive_delegation',
      'hive_powerUp',
      'hive_signBuffer',
      'hive_sendToken',
    ]) {
      expect(requestTimeoutFor(m), m).toBe(INTERACTIVE_REQUEST_TIMEOUT_MS);
    }
    expect(requestTimeoutFor('hive_handshake')).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
    expect(requestTimeoutFor('hive_getAccount')).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
  });
});

describe('requestAccount', () => {
  it('returns the account name: { success: true, result: name }', () => {
    const walletRequest = vi.fn((_m: string, _p: any[], _c: any, cb: (e: any, r?: any) => void) =>
      cb(null, 'sopadevs'),
    );
    const shim = createHiveKeychainShim(walletRequest);
    const callback = vi.fn();
    shim.requestAccount(callback);
    expect(walletRequest).toHaveBeenCalledWith(
      'hive_requestAccount',
      [{ type: 'requestAccount', rpc: undefined }],
      'hive',
      expect.any(Function),
    );
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ success: true, result: 'sopadevs', error: null }));
  });

  it('a rejected approval answers { success: false, error: "user_rejected" }', () => {
    const shim = createHiveKeychainShim((_m, _p, _c, cb) => cb({ code: 4001, message: 'User rejected the request' }));
    const callback = vi.fn();
    shim.requestAccount(callback);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: 'user_rejected', result: null }),
    );
  });

  it('other failures pass their message through', () => {
    const shim = createHiveKeychainShim((_m, _p, _c, cb) =>
      cb({ code: 4100, message: 'No Hive account exists for this KeepKey yet' }),
    );
    const callback = vi.fn();
    shim.requestAccount(callback);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: 'No Hive account exists for this KeepKey yet' }),
    );
  });
});
