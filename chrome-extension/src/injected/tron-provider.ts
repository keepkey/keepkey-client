/**
 * KeepKey Tron provider — injects `window.tronLink` and `window.tronWeb`
 * shims that mirror TronLink's API surface, routing signing operations to
 * the extension background (and ultimately the KeepKey device via the
 * vault REST API) while delegating reads/builds/broadcasts to TronGrid.
 *
 * Scope of this MVP:
 *   - TransferContract (native TRX) signing
 *   - TriggerSmartContract `transfer(address,uint256)` signing (TRC20, e.g. USDT)
 *   - Read-only RPC and transactionBuilder.sendTrx via TronGrid
 *
 * Supported (firmware 7.14.1+):
 *   - signMessage / signMessageV2 — TIP-191 personal_sign
 *
 * Out of scope (not on tronWeb.trx; reachable only via tronLink.request):
 *   - tron_verifyMessage — boolean check against a known address. We
 *     don't expose verifyMessage / verifyMessageV2 on tronWeb.trx
 *     because TronWeb V2's contract is verifyMessageV2(message, sig)
 *     returning the recovered address, and our endpoint shape
 *     (address required, boolean returned) doesn't match.
 *     Verification is client-side anyway — use TronWeb's static
 *     utilities.
 *   - tron_signTypedHash (TIP-712 hash mode) — call
 *     window.tronLink.request({ method: 'tron_signTypedHash', params:
 *     [{ domainSeparatorHash, messageHash }] }) with pre-computed
 *     32-byte hashes. We don't ship a struct → hash implementation,
 *     so we don't expose _signTypedData / signTypedData on
 *     tronWeb.trx where the contract takes (domain, types, value).
 *   - Non-`transfer` smart contract calls (requires firmware display support)
 */

import type { ChainType } from './types';

type WalletRequestFn = (
  method: string,
  params: any[],
  chain: ChainType,
  callback: (error: any, result?: any) => void,
) => void;

const TRONGRID_URL = 'https://api.trongrid.io';

// Subset of bs58 used to convert between Tron base58 and hex addresses.
// A full base58 impl already lives in solana-wallet-standard.ts but it's
// scoped to that module, and duplicating ~20 lines here avoids having to
// widen that module's public surface for an unrelated chain.
const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Decode(str: string): Uint8Array {
  const bytes: number[] = [0];
  for (const char of str) {
    const idx = B58_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error('Invalid base58 character');
    let carry = idx;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const char of str) {
    if (char !== '1') break;
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

function toHexString(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** Tron base58 addresses decode to 25 bytes: 0x41 prefix + 20-byte hash + 4-byte checksum. */
function base58ToHex(addr: string): string {
  const bytes = base58Decode(addr);
  if (bytes.length !== 25 || bytes[0] !== 0x41) {
    throw new Error(`Invalid Tron address: ${addr}`);
  }
  return toHexString(bytes.slice(0, 21));
}

function isTronBase58(addr: string): boolean {
  if (typeof addr !== 'string' || addr.length !== 34 || !addr.startsWith('T')) return false;
  try {
    base58ToHex(addr);
    return true;
  } catch {
    return false;
  }
}

class EventEmitter {
  private events = new Map<string, Set<Function>>();
  on(event: string, handler: Function) {
    if (!this.events.has(event)) this.events.set(event, new Set());
    this.events.get(event)!.add(handler);
  }
  off(event: string, handler: Function) {
    this.events.get(event)?.delete(handler);
  }
  emit(event: string, ...args: any[]) {
    this.events.get(event)?.forEach(h => {
      try {
        h(...args);
      } catch {
        /* swallow to keep other listeners alive */
      }
    });
  }
}

/**
 * Bridges a one-shot `walletRequest` callback-style API into a Promise.
 * The injected pipeline is callback-based so response-by-requestId
 * dispatch is possible, but every consumer here wants a Promise.
 */
function promisifyRequest(walletRequest: WalletRequestFn, method: string, params: any[]): Promise<any> {
  return new Promise((resolve, reject) => {
    walletRequest(method, params, 'tron', (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

/**
 * TronGrid GETs are used for read-only queries. All POSTs here hit
 * TronGrid directly rather than routing through the extension — there's
 * nothing sensitive about reading chain state, and keeping the round-trip
 * short matters for dApp UX.
 *
 * Per-request timeout + one retry on 5xx/transient errors so a stalled
 * TronGrid edge can't hang dApp flows (most painful on broadcasts via
 * /wallet/broadcasttransaction). Lives inline because this file is
 * bundled into the injected script — it can't import from the
 * background's fetchUtils.
 */
const TRONGRID_TIMEOUT_MS = 8000;
const TRONGRID_BROADCAST_TIMEOUT_MS = 12000;
const isTransientTronStatus = (status: number) => status >= 500 && status < 600;

async function tronGridPost(path: string, body: any): Promise<any> {
  const isBroadcast = path.includes('broadcasttransaction');
  const timeoutMs = isBroadcast ? TRONGRID_BROADCAST_TIMEOUT_MS : TRONGRID_TIMEOUT_MS;
  const maxAttempts = 2;
  let lastErr: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await fetch(`${TRONGRID_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!resp.ok) {
        if (isTransientTronStatus(resp.status) && attempt < maxAttempts) {
          await new Promise(r => setTimeout(r, 200 * attempt));
          continue;
        }
        const text = await resp.text().catch(() => '');
        throw new Error(`TronGrid ${path} failed (${resp.status}): ${text}`);
      }
      return await resp.json();
    } catch (e: any) {
      lastErr = e;
      // Timeout / network — worth one retry. Bail on the second attempt
      // so a fully-down TronGrid doesn't lock the dApp for ~24s.
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, 200 * attempt));
        continue;
      }
    }
  }
  throw lastErr;
}

export class KeepKeyTronProvider {
  readonly tronWeb: any;
  readonly tronLink: any;

  private address: string | null = null;
  private hexAddress: string | null = null;
  private readonly emitter = new EventEmitter();
  private readonly walletRequest: WalletRequestFn;

  constructor(walletRequest: WalletRequestFn) {
    this.walletRequest = walletRequest;
    this.tronWeb = this.buildTronWeb();
    this.tronLink = this.buildTronLink();
  }

  /** Populate cached address state — called after a successful connect. */
  setAddress(address: string) {
    if (!address || !isTronBase58(address)) return;
    this.address = address;
    this.hexAddress = base58ToHex(address);

    this.tronWeb.ready = true;
    this.tronWeb.defaultAddress = {
      base58: address,
      hex: this.hexAddress,
      name: 'KeepKey',
      type: 1,
    };
    this.tronLink.ready = true;

    // TronLink fires `message` events with data.message.action = 'setAccount'
    // / 'setNode' / 'accountsChanged'. dApps often listen for these to
    // react to account changes without polling `defaultAddress`.
    this.fireMessage('setAccount', { address, name: 'KeepKey', type: 1 });
    this.fireMessage('accountsChanged', { address });
  }

  /** Emit a TronLink-compatible `message` event on the window. */
  private fireMessage(action: string, data: any) {
    try {
      window.postMessage(
        {
          message: {
            action,
            data,
          },
          isTronLink: true,
        },
        window.location.origin,
      );
    } catch {
      /* postMessage can fail in sandboxed frames; ignore */
    }
    this.emitter.emit(action, data);
  }

  private buildTronLink() {
    return {
      // Tron dApps have no multi-wallet discovery standard, so most
      // gate on this flag to decide whether to surface a "Connect
      // TronLink" button vs. a deep-link to install TronLink. We set
      // it to true to be treated as the compatible provider — our
      // approval UI still identifies as KeepKey, so there's no UX
      // deception, just detection-bypass.
      isTronLink: true,
      ready: false,
      tronWeb: null as any, // Populated below, after tronWeb exists.
      request: async ({ method, params }: { method: string; params?: any }): Promise<any> => {
        switch (method) {
          case 'tron_requestAccounts':
          case 'tron_accounts': {
            const address = await promisifyRequest(this.walletRequest, 'tron_requestAccounts', []);
            if (!address || typeof address !== 'string') {
              return { code: 4001, message: 'User denied account access' };
            }
            this.setAddress(address);
            return { code: 200, message: 'ok' };
          }
          default:
            // TronLink's request() passes arbitrary methods through —
            // mirror that rather than whitelisting, so future method
            // additions on the handler side work without changing this
            // file.
            return promisifyRequest(this.walletRequest, method, Array.isArray(params) ? params : [params]);
        }
      },
      on: (event: string, handler: Function) => this.emitter.on(event, handler),
      off: (event: string, handler: Function) => this.emitter.off(event, handler),
    };
  }

  private buildTronWeb() {
    const self = this;

    const trx = {
      sign: async (tx: any, privateKey?: string, useTronHeader?: boolean, options?: any) => {
        // `tronWeb.trx.sign` accepts two shapes:
        //   - a full transaction object: { txID, raw_data, raw_data_hex, ... }
        //   - a hex string: message to sign (requires useTronHeader handling)
        // We only implement the first shape here; message-string signing
        // uses signMessage.
        if (typeof tx === 'string') {
          throw new Error('tronWeb.trx.sign(message) not supported — use tronWeb.trx.signMessage()');
        }
        if (!tx || !tx.raw_data_hex) {
          throw new Error('tronWeb.trx.sign expects a built transaction with raw_data_hex');
        }
        // privateKey/useTronHeader/options are ignored — we always sign
        // with the KeepKey device, not an in-memory key. Throwing on a
        // passed-in key would break dApps that pass undefined defensively.
        void privateKey;
        void useTronHeader;
        void options;

        const signed = await promisifyRequest(self.walletRequest, 'tron_sign', [tx]);
        return signed;
      },

      // TIP-191 V1 — message is hex (with or without 0x).
      // privateKey arg is ignored (signing always happens on the device).
      signMessage: async (message: string, privateKey?: string) => {
        void privateKey;
        return await promisifyRequest(self.walletRequest, 'tron_signMessage', [message]);
      },

      // TIP-191 V2 — message is UTF-8 string.
      signMessageV2: async (message: string, privateKey?: string) => {
        void privateKey;
        return await promisifyRequest(self.walletRequest, 'signMessageV2', [message]);
      },

      // verifyMessage / verifyMessageV2 deliberately NOT exposed here.
      // TronWeb V2's verifyMessageV2(message, signature) returns the
      // recovered base58 address; our endpoint shape (address required,
      // boolean returned) doesn't match. Use TronWeb's static
      // verification utilities, or call tronLink.request({ method:
      // 'tron_verifyMessage', params: [{ address, signature, message,
      // isText? }] }) explicitly.

      sendRawTransaction: async (signedTx: any) => {
        return tronGridPost('/wallet/broadcasttransaction', signedTx);
      },

      broadcast: async (signedTx: any) => trx.sendRawTransaction(signedTx),

      getBalance: async (address?: string) => {
        const addr = address || self.address;
        if (!addr) throw new Error('No address — call tron_requestAccounts first');
        const result = await tronGridPost('/wallet/getaccount', { address: addr, visible: true });
        return typeof result?.balance === 'number' ? result.balance : 0;
      },

      getAccount: async (address?: string) => {
        const addr = address || self.address;
        if (!addr) throw new Error('No address — call tron_requestAccounts first');
        return tronGridPost('/wallet/getaccount', { address: addr, visible: true });
      },

      getUnconfirmedAccount: async (address?: string) => {
        const addr = address || self.address;
        if (!addr) throw new Error('No address — call tron_requestAccounts first');
        return tronGridPost('/wallet/getaccount', { address: addr, visible: true });
      },

      getTransaction: async (txId: string) => tronGridPost('/wallet/gettransactionbyid', { value: txId }),
    };

    const transactionBuilder = {
      sendTrx: async (to: string, amount: number, from?: string) => {
        const owner = from || self.address;
        if (!owner) throw new Error('No address — call tron_requestAccounts first');
        return tronGridPost('/wallet/createtransaction', {
          owner_address: owner,
          to_address: to,
          amount,
          visible: true,
        });
      },

      triggerSmartContract: async (
        contractAddress: string,
        functionSelector: string,
        options: any = {},
        parameters: any[] = [],
        issuerAddress?: string,
      ) => {
        const owner = issuerAddress || self.address;
        if (!owner) throw new Error('No address — call tron_requestAccounts first');
        return tronGridPost('/wallet/triggersmartcontract', {
          contract_address: contractAddress,
          function_selector: functionSelector,
          parameter: buildTriggerParameter(parameters),
          fee_limit: options.feeLimit ?? 100_000_000,
          call_value: options.callValue ?? 0,
          owner_address: owner,
          visible: true,
        });
      },
    };

    const utils = {
      isAddress: (addr: string) => isTronBase58(addr),
      fromSun: (sun: string | number) => String(Number(sun) / 1_000_000),
      toSun: (trx: string | number) => String(Math.round(Number(trx) * 1_000_000)),
      toHex: (addr: string) => base58ToHex(addr),
    };

    const tronWeb = {
      // Mirror the TronLink-compatibility flag — some dApps check here
      // rather than on window.tronLink.
      isTronLink: true,
      ready: false,
      defaultAddress: {
        base58: false as string | false,
        hex: false as string | false,
        name: false as string | false,
        type: -1,
      },
      fullNode: { host: TRONGRID_URL },
      solidityNode: { host: TRONGRID_URL },
      eventServer: { host: TRONGRID_URL },
      trx,
      transactionBuilder,
      utils,
      on: (event: string, handler: Function) => this.emitter.on(event, handler),
      off: (event: string, handler: Function) => this.emitter.off(event, handler),
      setAddress: (_addr: string) => {
        // TronLink no-ops this too — address selection is user-driven in
        // the extension UI, not dApp-driven.
      },
      isConnected: () => this.address !== null,
    };

    // Wire back-reference so `window.tronLink.tronWeb === window.tronWeb`
    // once both are created, matching what dApps expect.
    queueMicrotask(() => {
      if (this.tronLink) this.tronLink.tronWeb = tronWeb;
    });

    return tronWeb;
  }
}

/**
 * Encode parameters for triggerSmartContract. We accept the tronweb-style
 * `[{ type, value }]` array and emit the tightly-packed ABI-encoded hex
 * string TronGrid expects — matches the raw `parameter` field format.
 *
 * Kept intentionally minimal: supports `address` and `uint256`, which
 * covers `transfer(address,uint256)` and most TRC20 flows dApps build
 * via tronweb. Complex ABI types can be handled by dApps passing
 * pre-encoded hex.
 */
function buildTriggerParameter(parameters: { type: string; value: any }[]): string {
  if (!Array.isArray(parameters) || parameters.length === 0) return '';
  let out = '';
  for (const p of parameters) {
    if (p.type === 'address') {
      // TronGrid expects 32-byte right-padded address (hex without 0x41 prefix).
      const addr = String(p.value);
      const hex = addr.startsWith('T') ? base58ToHex(addr).slice(2) : addr.replace(/^0x/, '').replace(/^41/, '');
      out += hex.padStart(64, '0');
    } else if (p.type === 'uint256' || p.type === 'uint') {
      const v = BigInt(p.value);
      out += v.toString(16).padStart(64, '0');
    } else {
      // Pass-through for pre-encoded hex; caller owns correctness.
      const v = String(p.value).replace(/^0x/, '');
      out += v.padStart(64, '0');
    }
  }
  return out;
}
