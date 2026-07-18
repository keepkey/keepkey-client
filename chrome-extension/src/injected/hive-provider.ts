/**
 * KeepKey Hive provider — injects a `window.hive_keychain` shim mirroring
 * Hive Keychain's API surface (the de-facto standard Hive dApps call),
 * routing signing to the extension background (and ultimately the KeepKey
 * device via the vault REST API). Reads/broadcasts go through Pioneer.
 *
 * Scope (firmware 7.15.0+):
 *   - requestHandshake, requestTransfer, requestSignBuffer
 *   - clear-signed ops via HiveSignOperations: requestVote, requestPost
 *     (incl. comment_options/beneficiaries), requestCustomJson,
 *     requestBroadcast, requestSendToken (Hive Engine), requestDelegation,
 *     requestPowerUp/Down, requestSavingsOperation, requestConversion
 *
 * Out of scope (returned as keychain-style failures so dApps degrade
 * gracefully): authority management, witness/proposal ops, recurrent
 * transfers, swaps, encode/decode (memo-key crypto is on-device only).
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

    /** Vote on a post/comment (posting authority). */
    requestVote: function (
      account: string,
      permlink: string,
      author: string,
      weight: number,
      callback: KeychainCallback,
      rpc?: string,
    ) {
      const data = { type: 'vote', username: account, permlink, author, weight, rpc };
      dispatch('hive_vote', data, callback);
    },

    /** Blog post / comment (posting authority). comment_options unsupported in phase 1. */
    requestPost: function (
      account: string,
      title: string,
      body: string,
      parent_perm: string,
      parent_account: string | null,
      json_metadata: any,
      permlink: string,
      comment_options: any,
      callback: KeychainCallback,
      rpc?: string,
    ) {
      const data = {
        type: 'post',
        username: account,
        title,
        body,
        parent_perm,
        parent_username: parent_account,
        json_metadata,
        permlink,
        comment_options,
        rpc,
      };
      dispatch('hive_post', data, callback);
    },

    /** custom_json broadcast (posting by default; active when key='Active'). */
    requestCustomJson: function (
      account: string | null,
      id: string,
      key: string,
      json: string,
      display_msg: string,
      callback: KeychainCallback,
      rpc?: string,
    ) {
      const data = { type: 'custom', username: account, id, method: key || 'Posting', json, display_msg, rpc };
      dispatch('hive_customJson', data, callback);
    },

    /** Generic operations broadcast — device clear-sign op table only. */
    requestBroadcast: function (
      account: string,
      operations: any[],
      key: string,
      callback: KeychainCallback,
      rpc?: string,
    ) {
      const data = { type: 'broadcast', username: account, operations, method: key, rpc };
      dispatch('hive_broadcast', data, callback);
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

    /** Hive Engine token transfer (custom_json on ssc-mainnet-hive, active key). */
    requestSendToken: function (
      account: string,
      to: string,
      amount: string,
      memo: string,
      currency: string,
      callback: KeychainCallback,
      rpc?: string,
    ) {
      const data = { type: 'sendToken', username: account, to, amount, memo, currency, rpc };
      dispatch('hive_sendToken', data, callback);
    },

    /** Delegate HP/VESTS (delegate_vesting_shares, active key). */
    requestDelegation: function (
      username: string | null,
      delegatee: string,
      amount: string,
      unit: string,
      callback: KeychainCallback,
      rpc?: string,
    ) {
      const data = { type: 'delegation', username, delegatee, amount, unit, rpc };
      dispatch('hive_delegation', data, callback);
    },

    /** Power up — stake HIVE as HP (transfer_to_vesting, active key). */
    requestPowerUp: function (
      username: string,
      recipient: string,
      hive: string,
      callback: KeychainCallback,
      rpc?: string,
    ) {
      const data = { type: 'powerUp', username, recipient, hive, rpc };
      dispatch('hive_powerUp', data, callback);
    },

    /** Power down HP ('0.000' stops an active power-down) (withdraw_vesting, active key). */
    requestPowerDown: function (username: string, hive_power: string, callback: KeychainCallback, rpc?: string) {
      const data = { type: 'powerDown', username, hive_power, rpc };
      dispatch('hive_powerDown', data, callback);
    },

    /** Savings deposit/withdraw (transfer_to/from_savings, active key). */
    requestSavingsOperation: function (
      username: string,
      to: string,
      amount: string,
      currency: string,
      operation: string,
      memo: string | KeychainCallback,
      callback?: KeychainCallback | string,
      rpc?: string,
    ) {
      // Keychain quirk: memo is optional and position-shifted when omitted
      if (typeof memo === 'function') {
        rpc = callback as string | undefined;
        callback = memo;
        memo = '';
      }
      const data = { type: 'savings', username, to, amount, currency, operation, memo: memo || '', rpc };
      dispatch('hive_savings', data, callback as KeychainCallback);
    },

    /** HBD → HIVE conversion (convert op; collateralized HIVE → HBD unsupported). */
    requestConversion: function (
      username: string,
      amount: string,
      collaterized: boolean,
      callback: KeychainCallback,
      rpc?: string,
    ) {
      const data = { type: 'convert', username, amount, collaterized, rpc };
      dispatch('hive_conversion', data, callback);
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
    'requestSignTx',
    'requestSignedCall',
    'requestWitnessVote',
    'requestProxy',
    'requestCreateClaimedAccount',
    'requestCreateProposal',
    'requestRemoveProposal',
    'requestUpdateProposalVote',
    'requestAddAccount',
    'requestRecurrentTransfer',
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
