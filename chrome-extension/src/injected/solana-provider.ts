/**
 * KeepKey legacy `window.solana` provider — a Phantom-compatible shim for
 * dApps that predate the Solana Wallet Standard and sniff the global
 * `window.solana` object directly (most of them via
 * `@solana/wallet-adapter-phantom`, which gates detection on
 * `window.solana.isPhantom === true`).
 *
 * This is the "masking" counterpart to the EVM `window.ethereum` /
 * `isMetaMask` shim: it is mounted only when Phantom masking is enabled
 * (default on) and only if nothing else has already claimed
 * `window.solana`. Modern dApps continue to discover KeepKey via the
 * Wallet Standard registry (see solana-wallet-standard.ts) regardless of
 * this provider.
 *
 * All signing routes through the exact same background RPC methods the
 * Wallet Standard wallet uses (`solana_connect`, `solana_signMessage`,
 * `solana_signTransaction`, `solana_signAndSendTransaction`,
 * `solana_disconnect`) — no new background handlers are required.
 *
 * Transaction handling is duck-typed so we never have to bundle
 * @solana/web3.js: the dApp hands us a `Transaction` or
 * `VersionedTransaction`, we serialize it with its own `serialize()`,
 * sign the bytes via the device, then graft the returned fee-payer
 * signature back onto the original object with its own `addSignature()`.
 */

import type { ChainType } from './types';
import { toProviderError } from './provider-error';

type WalletRequestFn = (
  method: string,
  params: any[],
  chain: ChainType,
  callback: (error: any, result?: any) => void,
) => void;

// ---------- Base58 (inline, no external dep) ----------

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Decode(str: string): Uint8Array {
  const bytes: number[] = [0];
  for (const char of str) {
    const idx = BASE58_ALPHABET.indexOf(char);
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

// ---------- PublicKey-like shape ----------
//
// dApps read `window.solana.publicKey` and typically call `.toString()`,
// `.toBase58()`, `.toBytes()` or `.equals()`. We expose a lightweight
// duck-typed object rather than constructing a web3.js PublicKey.

interface PublicKeyLike {
  toString(): string;
  toBase58(): string;
  toBytes(): Uint8Array;
  toBuffer(): Uint8Array;
  equals(other: any): boolean;
}

function makePublicKey(address: string): PublicKeyLike {
  const bytes = base58Decode(address);
  return {
    toString: () => address,
    toBase58: () => address,
    toBytes: () => bytes,
    toBuffer: () => bytes,
    equals: (other: any) => {
      try {
        return other?.toBase58?.() === address || other?.toString?.() === address;
      } catch {
        return false;
      }
    },
  };
}

// ---------- Transaction helpers (duck-typed, no web3.js) ----------

// VersionedTransaction exposes a `version` getter ('legacy' | 0) and a
// `.message`; legacy web3.js Transaction has neither.
function isVersionedTransaction(tx: any): boolean {
  return tx != null && typeof tx === 'object' && 'version' in tx && tx.message != null;
}

function serializeForSigning(tx: any): Uint8Array {
  if (!tx || typeof tx.serialize !== 'function') {
    throw new Error('Unsupported transaction: missing serialize()');
  }
  if (isVersionedTransaction(tx)) {
    // serialize() includes the (empty) signature placeholders.
    return new Uint8Array(tx.serialize());
  }
  // Legacy Transaction: allow serialization before the fee-payer has signed.
  return new Uint8Array(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
}

// Extract the fee-payer (signer index 0) signature — the first 64 bytes
// after the shortvec signature count. For any realistic transaction the
// count is < 128, so the shortvec prefix is a single byte.
function extractFeePayerSignature(signed: Uint8Array): Uint8Array {
  const count = signed[0];
  if (!count) throw new Error('Signed transaction has no signatures');
  if (count & 0x80) throw new Error('Unexpected multi-byte signature count');
  return signed.slice(1, 1 + 64);
}

// The fee payer is the signer at account index 0. Pull the PublicKey
// straight off the transaction the dApp gave us so we never construct one.
function feePayerKey(tx: any): any {
  if (isVersionedTransaction(tx)) {
    const keys = tx.message?.staticAccountKeys;
    if (keys && keys.length) return keys[0];
    throw new Error('Versioned transaction missing account keys');
  }
  if (tx.feePayer) return tx.feePayer;
  const sig0 = tx.signatures?.[0];
  if (sig0?.publicKey) return sig0.publicKey;
  throw new Error('Legacy transaction missing fee payer');
}

// ---------- Provider ----------

type EventName = 'connect' | 'disconnect' | 'accountChanged';

export class KeepKeySolanaProvider {
  readonly #walletRequest: WalletRequestFn;
  readonly #listeners = new Map<EventName, Set<Function>>();

  #publicKey: PublicKeyLike | null = null;
  #cachedAddress: string | null = null;

  // Identity flags. `isPhantom` is the impersonation that legacy
  // wallet-adapter-phantom dApps gate on; it is only ever set because the
  // user left Phantom masking enabled (see injected.ts mount gate).
  readonly isPhantom = true;
  readonly isKeepKey = true;

  constructor(walletRequest: WalletRequestFn) {
    this.#walletRequest = walletRequest;

    // Restore cached address from a previous session for an instant connect.
    // Shares the same cache key as the Wallet Standard wallet.
    try {
      const cached = localStorage.getItem('keepkey-solana');
      if (cached) {
        const { address } = JSON.parse(cached);
        if (address && typeof address === 'string') this.#cachedAddress = address;
      }
    } catch {
      /* ignore */
    }

    // Silent pre-fetch of the address (no popup) so connect() resolves
    // instantly. Does NOT mark the provider connected — dApps must call
    // connect() to transition state, matching Phantom's contract.
    this.#silentConnect();
  }

  get publicKey(): PublicKeyLike | null {
    return this.#publicKey;
  }

  get isConnected(): boolean {
    return this.#publicKey !== null;
  }

  // ---- Connection ----

  async connect(_opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: PublicKeyLike }> {
    if (this.#publicKey) return { publicKey: this.#publicKey };
    const address: string = this.#cachedAddress || (await this.#rpc('solana_connect', []));
    if (!address) throw new Error('Failed to connect to KeepKey');
    this.#setConnected(address);
    return { publicKey: this.#publicKey! };
  }

  async disconnect(): Promise<void> {
    await this.#rpc('solana_disconnect', []).catch(() => {});
    this.#publicKey = null;
    try {
      localStorage.removeItem('keepkey-solana');
    } catch {
      /* ignore */
    }
    this.#emit('disconnect');
  }

  // ---- Signing ----

  async signMessage(
    message: Uint8Array,
    _display?: 'utf8' | 'hex',
  ): Promise<{ signature: Uint8Array; publicKey: PublicKeyLike }> {
    await this.#ensureConnected();
    const sigArray: number[] = await this.#rpc('solana_signMessage', [Array.from(message)]);
    return { signature: new Uint8Array(sigArray), publicKey: this.#publicKey as PublicKeyLike };
  }

  async signTransaction<T = any>(transaction: T): Promise<T> {
    await this.#ensureConnected();
    const bytes = serializeForSigning(transaction);
    const signedArray: number[] = await this.#rpc('solana_signTransaction', [Array.from(bytes)]);
    const signed = new Uint8Array(signedArray);
    const signature = extractFeePayerSignature(signed);
    // Graft the device signature back onto the dApp's own object so it can
    // serialize/broadcast it. Both Transaction and VersionedTransaction
    // accept a 64-byte Uint8Array here.
    (transaction as any).addSignature(feePayerKey(transaction), signature);
    return transaction;
  }

  async signAllTransactions<T = any>(transactions: T[]): Promise<T[]> {
    const out: T[] = [];
    for (const tx of transactions) {
      out.push(await this.signTransaction(tx));
    }
    return out;
  }

  async signAndSendTransaction(
    transaction: any,
    _options?: any,
  ): Promise<{ signature: string; publicKey: PublicKeyLike }> {
    await this.#ensureConnected();
    const bytes = serializeForSigning(transaction);
    const signature: string = await this.#rpc('solana_signAndSendTransaction', [Array.from(bytes)]);
    return { signature, publicKey: this.#publicKey as PublicKeyLike };
  }

  // Generic dispatcher for dApps that drive the provider via request().
  async request({ method, params }: { method: string; params?: any }): Promise<any> {
    const p = Array.isArray(params) ? params : params != null ? [params] : [];
    switch (method) {
      case 'connect':
        return this.connect(p[0]);
      case 'disconnect':
        return this.disconnect();
      case 'signTransaction':
        return this.signTransaction(p[0]?.transaction ?? p[0]);
      case 'signAllTransactions':
        return this.signAllTransactions(p[0]?.transactions ?? p[0]);
      case 'signAndSendTransaction':
        return this.signAndSendTransaction(p[0]?.transaction ?? p[0], p[0]?.options ?? p[1]);
      case 'signMessage':
        return this.signMessage(p[0]?.message ?? p[0], p[0]?.display);
      default:
        throw new Error(`KeepKey (Solana): unsupported method "${method}"`);
    }
  }

  // ---- Events (EventEmitter-ish, Phantom surface) ----

  on(event: EventName, handler: Function): this {
    if (!this.#listeners.has(event)) this.#listeners.set(event, new Set());
    this.#listeners.get(event)!.add(handler);
    return this;
  }

  off(event: EventName, handler: Function): this {
    this.#listeners.get(event)?.delete(handler);
    return this;
  }

  removeListener(event: EventName, handler: Function): this {
    return this.off(event, handler);
  }

  removeAllListeners(event?: EventName): this {
    if (event) this.#listeners.delete(event);
    else this.#listeners.clear();
    return this;
  }

  // ---- Internal ----

  #emit(event: EventName, ...args: any[]) {
    this.#listeners.get(event)?.forEach(fn => {
      try {
        fn(...args);
      } catch {
        // swallow listener errors
      }
    });
  }

  #setConnected(address: string) {
    this.#publicKey = makePublicKey(address);
    this.#cachedAddress = address;
    try {
      localStorage.setItem('keepkey-solana', JSON.stringify({ address }));
    } catch {
      /* ignore */
    }
    this.#emit('connect', this.#publicKey);
  }

  async #ensureConnected() {
    if (this.#publicKey) return;
    await this.connect();
  }

  async #silentConnect() {
    try {
      const address: string = await this.#rpc('solana_connect', []);
      if (address && typeof address === 'string') {
        this.#cachedAddress = address;
        try {
          localStorage.setItem('keepkey-solana', JSON.stringify({ address }));
        } catch {
          /* ignore */
        }
      }
    } catch {
      // Vault not ready or device disconnected — connect() will retry later.
    }
  }

  #rpc(method: string, params: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
      this.#walletRequest(method, params, 'solana' as ChainType, (error, result) => {
        if (error) reject(toProviderError(error, `${method} failed`));
        else resolve(result);
      });
    });
  }
}
