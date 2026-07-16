/**
 * KeepKey Hive provider — injects a `window.hive_keychain` shim mirroring
 * Hive Keychain's API surface (the de-facto standard Hive dApps call),
 * routing signing to the extension background (and ultimately the KeepKey
 * device via the vault REST API). Reads/broadcasts go through Pioneer.
 *
 * Scope of this MVP (firmware 7.15.0+):
 *   - requestHandshake — presence check
 *   - requestTransfer — native HIVE transfer (device-serialized + signed)
 *
 * Out of scope (returned as keychain-style failures so dApps degrade
 * gracefully): posting-key ops (vote/post/custom_json), requestSignBuffer
 * (firmware has no Hive message-sign message type), requestBroadcast
 * (generic ops need per-op firmware serialization), encode/decode (memo-key
 * crypto is on-device only).
 */

import type { ChainType } from './types';

type WalletRequestFn = (
  method: string,
  params: any[],
  chain: ChainType,
  callback: (error: any, result?: any) => void,
) => void;

interface KeychainResponse {
  success: boolean;
  error: string | null;
  message: string | null;
  request_id: number;
  result: any;
  data: any;
}

type KeychainCallback = (response: KeychainResponse) => void;

export function createHiveKeychainShim(walletRequest: WalletRequestFn) {
  let currentId = 1;

  function respond(callback: KeychainCallback | undefined, requestId: number, data: any, error: any, result?: any) {
    if (typeof callback !== 'function') return;
    const message = error ? error?.message || String(error) : null;
    const base = {
      success: !error,
      error: error ? (error?.code === 4001 ? 'user_cancel' : message) : null,
      message,
      request_id: requestId,
      result: error ? null : (result ?? null),
      data,
    };
    // A handler can return { result, ...extras } to control the top-level
    // response shape — Keychain puts e.g. publicKey beside result, not in it.
    if (!error && result && typeof result === 'object' && 'result' in result) {
      callback({ ...base, ...result });
      return;
    }
    callback(base);
  }

  function dispatch(method: string, data: any, callback?: KeychainCallback) {
    const requestId = currentId++;
    walletRequest(method, [data], 'hive', (error, result) => {
      respond(callback, requestId, data, error, result);
    });
  }

  function notSupported(type: string, data: any, callback?: KeychainCallback) {
    respond(callback, currentId++, data, {
      message: `KeepKey does not support Keychain request "${type}" yet`,
    });
  }

  const shim: Record<string, any> = {
    current_id: 1,

    /** dApp presence check — Keychain calls back with no arguments. */
    requestHandshake: function (callback: () => void) {
      dispatch('hive_handshake', {}, () => {
        if (typeof callback === 'function') callback();
      });
    },

    /** Native HIVE transfer, mirrors Keychain's signature exactly. */
    requestTransfer: function (
      account: string,
      to: string,
      amount: string,
      memo: string,
      currency: string,
      callback: KeychainCallback,
      enforce = false,
      rpc?: string,
    ) {
      const data = { type: 'transfer', username: account, to, amount, memo, enforce, currency, rpc };
      dispatch('hive_transfer', data, callback);
    },

    /** Message signing (dApp login), mirrors Keychain's signature exactly. */
    requestSignBuffer: function (
      account: string,
      message: string,
      key: string,
      callback: KeychainCallback,
      rpc?: string,
      title?: string,
    ) {
      const data = { type: 'signBuffer', username: account, message, method: key, rpc, title };
      dispatch('hive_signBuffer', data, callback);
    },
  };

  // The rest of Keychain's public surface (per public/hive_keychain.js).
  // Every method must exist — dApps call them unconditionally and a missing
  // function is a TypeError instead of a graceful keychain-style failure.
  // The callback can sit at a different position per method (trailing
  // optional rpc/params), so find it rather than fixing an arity.
  const UNSUPPORTED = [
    'requestEncodeMessage',
    'requestEncodeWithKeys',
    'requestVerifyKey',
    'requestAddAccountAuthority',
    'requestRemoveAccountAuthority',
    'requestAddKeyAuthority',
    'requestRemoveKeyAuthority',
    'requestBroadcast',
    'requestSignTx',
    'requestSignedCall',
    'requestPost',
    'requestVote',
    'requestCustomJson',
    'requestSendToken',
    'requestDelegation',
    'requestWitnessVote',
    'requestProxy',
    'requestPowerUp',
    'requestPowerDown',
    'requestCreateClaimedAccount',
    'requestCreateProposal',
    'requestRemoveProposal',
    'requestUpdateProposalVote',
    'requestAddAccount',
    'requestConversion',
    'requestRecurrentTransfer',
    'requestSavingsOperation',
    'requestSwap',
  ];
  for (const name of UNSUPPORTED) {
    shim[name] = (...args: any[]) => {
      const callback = args.find(a => typeof a === 'function');
      notSupported(name.replace(/^request/, ''), { type: name }, callback);
    };
  }

  return shim;
}
