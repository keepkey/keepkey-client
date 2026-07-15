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
    callback({
      success: !error,
      error: error ? (error?.code === 4001 ? 'user_cancel' : message) : null,
      message,
      request_id: requestId,
      result: error ? null : (result ?? null),
      data,
    });
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

  return {
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

    // ── Unsupported Keychain surface — fail fast, keychain-style ──────
    requestSignBuffer: function (_a: string, _m: string, _k: string, callback: KeychainCallback) {
      notSupported('signBuffer', { type: 'signBuffer' }, callback);
    },
    requestBroadcast: function (_a: string, _ops: any[], _k: string, callback: KeychainCallback) {
      notSupported('broadcast', { type: 'broadcast' }, callback);
    },
    requestSignTx: function (_a: string, _tx: any, _k: string, callback: KeychainCallback) {
      notSupported('signTx', { type: 'signTx' }, callback);
    },
    requestVote: function (_a: string, _p: string, _au: string, _w: number, callback: KeychainCallback) {
      notSupported('vote', { type: 'vote' }, callback);
    },
    requestCustomJson: function (
      _a: string,
      _id: string,
      _k: string,
      _j: string,
      _d: string,
      callback: KeychainCallback,
    ) {
      notSupported('custom_json', { type: 'custom' }, callback);
    },
    requestPost: function (...args: any[]) {
      const callback = args.find(a => typeof a === 'function');
      notSupported('post', { type: 'post' }, callback);
    },
    requestEncodeMessage: function (_u: string, _r: string, _m: string, _k: string, callback: KeychainCallback) {
      notSupported('encode', { type: 'encode' }, callback);
    },
    requestVerifyKey: function (_a: string, _m: string, _k: string, callback: KeychainCallback) {
      notSupported('decode', { type: 'decode' }, callback);
    },
  };
}
