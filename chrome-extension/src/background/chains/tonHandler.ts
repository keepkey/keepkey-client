/**
 * TON (Toncoin) signing handler.
 *
 * The vault owns the hard parts — v4R2 BOC construction, seqno +
 * wallet-state discovery, signed-BOC assembly, TonCenter broadcast,
 * and a body-hash tamper check — behind three REST endpoints:
 *
 *   POST /ton/build-transfer    → { build, bodyHash, feeEstimate, ... }
 *   POST /ton/sign-transaction  → { signature }   (device signs bodyHash)
 *   POST /ton/finalize-transfer → { boc, txid, broadcasted }
 *
 * This handler just stitches those together and plugs into the
 * existing requireApproval / requestStorage flow so the sidebar's
 * approval overlay works identically to every other chain.
 */
import { requestStorage } from '@extension/storage';
import { v4 as uuidv4 } from 'uuid';
import * as wallet from '../wallet';
import { createProviderRpcError } from '../utils';
import { requireMessageSigningFirmware } from '../firmware';

const TAG = ' | tonHandler | ';
const VAULT_URL = 'http://localhost:1646';

// BIP-44 for TON is THREE levels, not five. SLIP-44 607.
// Path: m/44'/607'/0' — verified against the vault SDK test
// (projects/keepkey-sdk/tests/ton/get-address.js) which derives
// UQDzK5bpDKByFoIQuwKR33N3eEdmHNv9XQnSKFIdvklO51Nr from the hardware.
// Sending five levels makes firmware reject with
// {"error":"Failed to derive private key","code":9} because the TON
// derivation path table only accepts the 3-level shape.
const TON_ADDRESS_N = [
  0x80000000 + 44, // 44'
  0x80000000 + 607, // 607'
  0x80000000 + 0, // 0'
];

const TON_NETWORK_ID = 'ton:-239';
const TON_PUBKEY_NOTE = 'TON account 0';

let cachedAddress: string | null = null;

export function resetTonState() {
  cachedAddress = null;
}

/** Bearer API key from the vault SDK — matches the Solana handler's auth path. */
function getApiKey(): string {
  const sdk = wallet.getSdk();
  const key = sdk.getClient?.()?.getApiKey?.();
  if (!key) {
    throw createProviderRpcError(-32603, 'API key not available — vault may not be connected');
  }
  return key;
}

/** TON addresses are either 48-char UQ/EQ base64url or a 0:hex/−1:hex
 *  raw form. If we get anything ETH-shaped (0x + 40 hex) that's a bug
 *  upstream and we must not persist it — otherwise the sidebar ends up
 *  displaying an ETH address under the TON row and Pioneer's accountInfo
 *  endpoint 422s on every balance call. */
function isPlausibleTonAddress(addr: string): boolean {
  if (!addr || typeof addr !== 'string') return false;
  if (/^0x[0-9a-fA-F]{40}$/.test(addr)) return false; // ETH — reject
  if (/^(UQ|EQ|kQ|0Q)[A-Za-z0-9_-]{46}$/.test(addr)) return true; // user/bounce/testnet
  if (/^(0|-1):[0-9a-fA-F]{64}$/.test(addr)) return true; // raw
  return false;
}

/** Fetch the device's TON address; cache on the shared pubkey store so
 *  watch-only sessions work without replugging the device. */
export async function getTonAddress(): Promise<string> {
  if (cachedAddress) return cachedAddress;

  const walletAddress = wallet.getAddressForNetwork(TON_NETWORK_ID);
  if (walletAddress) {
    // A previous bad cache could hand us an ETH-shaped string — refuse
    // to reuse it and fall through to a fresh device derivation.
    if (isPlausibleTonAddress(walletAddress)) {
      cachedAddress = walletAddress;
      return walletAddress;
    }
    console.warn(TAG, 'Discarding implausible cached TON address:', walletAddress);
  }

  if (!wallet.isDeviceConnected()) {
    const reachable = await wallet.probeDevice();
    if (!reachable) {
      throw createProviderRpcError(
        -32603,
        'KeepKey device not connected and no cached TON address. Plug in your device to derive one.',
      );
    }
  }

  const apiKey = getApiKey();
  let resp: Response;
  try {
    resp = await fetch(`${VAULT_URL}/addresses/ton`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ address_n: TON_ADDRESS_N, show_display: false }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (e: any) {
    throw createProviderRpcError(-32603, `Vault TON address fetch failed: ${e.message}`);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw createProviderRpcError(-32603, `Vault TON address fetch failed (${resp.status}): ${text}`);
  }

  const result = (await resp.json()) as { address?: string };
  const address = result.address;
  console.log(TAG, '/addresses/ton returned:', address);
  if (!address || typeof address !== 'string') {
    throw createProviderRpcError(-32603, 'Vault returned invalid TON address');
  }
  if (!isPlausibleTonAddress(address)) {
    // Hard stop — don't pollute the pubkey cache with a non-TON-shaped
    // string, which is what makes the sidebar display e.g. the ETH
    // address under the TON row and causes Pioneer's /ton/accountInfo
    // to 422 every poll.
    throw createProviderRpcError(
      -32603,
      `Vault returned implausible TON address (got "${address}") — check the vault's /addresses/ton handler and the address_n [44', 607', 0', 0, 0]`,
    );
  }
  cachedAddress = address;

  try {
    await wallet.addPubkey({
      note: TON_PUBKEY_NOTE,
      networks: [TON_NETWORK_ID],
      type: 'address',
      address,
      pubkey: address,
      addressNList: TON_ADDRESS_N,
      addressNListMaster: TON_ADDRESS_N,
      curve: 'ed25519',
      script_type: 'ton',
      accountIndex: 0,
    });
  } catch (e) {
    console.warn(TAG, 'Failed to cache TON address:', e);
  }

  return address;
}

export async function prefetchTonAddress(): Promise<void> {
  try {
    await getTonAddress();
  } catch (e: any) {
    console.log(TAG, 'TON prefetch skipped:', e?.message || e);
  }
}

/** Convert a decimal TON amount string (e.g. "0.01") to nanoTON integer
 *  string. TON has 9 decimals. Takes care of fractional parts without
 *  relying on floating-point. */
function tonToNano(amountTon: string): string {
  const trimmed = (amountTon || '0').trim();
  const parts = trimmed.split('.');
  const whole = parts[0] || '0';
  const frac = (parts[1] || '').slice(0, 9).padEnd(9, '0');
  if (!/^\d+$/.test(whole) || !/^\d+$/.test(frac)) {
    throw createProviderRpcError(4000, `Invalid TON amount: ${amountTon}`);
  }
  return String(BigInt(whole) * 1_000_000_000n + BigInt(frac));
}

interface TonBuildResponse {
  build: any;
  bodyHash: string;
  rawTx: string;
  seqno: number;
  expireAt: number;
  needsDeploy: boolean;
  feeEstimate: string;
}

async function buildTransferViaRest(params: {
  fromAddress: string;
  toAddress: string;
  amountNano: string;
  memo?: string;
}): Promise<TonBuildResponse> {
  const apiKey = getApiKey();
  let resp: Response;
  try {
    resp = await fetch(`${VAULT_URL}/ton/build-transfer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(30000),
    });
  } catch (e: any) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw createProviderRpcError(-32603, 'Vault TON build timed out');
    }
    throw createProviderRpcError(-32603, `Vault connection failed: ${e.message}`);
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw createProviderRpcError(-32603, `Vault TON build failed (${resp.status}): ${text}`);
  }
  return (await resp.json()) as TonBuildResponse;
}

async function signTransactionViaRest(bodyHashHex: string, toAddress: string, amountNano: string): Promise<string> {
  const apiKey = getApiKey();
  let resp: Response;
  try {
    resp = await fetch(`${VAULT_URL}/ton/sign-transaction`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        raw_tx: bodyHashHex,
        address_n: TON_ADDRESS_N,
        to_address: toAddress,
        amount: amountNano,
      }),
      signal: AbortSignal.timeout(120_000), // device confirmation can take a while
    });
  } catch (e: any) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw createProviderRpcError(-32603, 'Vault TON signing timed out');
    }
    throw createProviderRpcError(-32603, `Vault connection failed: ${e.message}`);
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw createProviderRpcError(-32603, `Vault TON sign failed (${resp.status}): ${text}`);
  }
  const result = (await resp.json()) as { signature?: unknown };
  console.log(TAG, 'sign-transaction response shape:', typeof result.signature, result);
  // The vault's /ton/sign-transaction handler does `return json(result)`
  // without hex-encoding, unlike /tron/sign-transaction. Depending on
  // hdwallet's internal shape for tonSignTx, `signature` can arrive as:
  //   - hex string (ideal)                          → use as-is
  //   - node-shaped Buffer `{type:"Buffer",data:[…]}` → decode data array
  //   - number[] (JSON-serialized Uint8Array)       → hex-encode the bytes
  // Normalize all three to a 64-byte hex string before handing to
  // /ton/finalize-transfer, which strictly requires a hex string.
  const sig = normalizeToHex(result.signature);
  if (!sig) {
    throw createProviderRpcError(-32603, `Vault returned unrecognized TON signature shape: ${JSON.stringify(result)}`);
  }
  if (sig.length !== 128) {
    throw createProviderRpcError(
      -32603,
      `Vault TON signature has wrong length (got ${sig.length} hex chars, expected 128 for 64 bytes)`,
    );
  }
  return sig;
}

/** Coerce any of the plausible signature encodings into lowercase hex. */
function normalizeToHex(value: unknown): string | null {
  if (typeof value === 'string') {
    // Strip 0x prefix if someone added it; finalize expects raw hex.
    return value.replace(/^0x/i, '').toLowerCase();
  }
  if (Array.isArray(value)) {
    return bytesToHex(value as number[]);
  }
  if (value && typeof value === 'object') {
    const asBuffer = value as { type?: string; data?: unknown };
    if (asBuffer.type === 'Buffer' && Array.isArray(asBuffer.data)) {
      return bytesToHex(asBuffer.data as number[]);
    }
    // Last-ditch: a Uint8Array-like object where numeric indices carry the bytes.
    const keys = Object.keys(value as object);
    const numericOnly = keys.length > 0 && keys.every(k => /^\d+$/.test(k));
    if (numericOnly) {
      const bytes = keys.map(k => (value as any)[k]).filter(v => typeof v === 'number');
      if (bytes.length > 0) return bytesToHex(bytes);
    }
  }
  return null;
}

function bytesToHex(bytes: number[]): string {
  return bytes.map(b => (b & 0xff).toString(16).padStart(2, '0')).join('');
}

/**
 * POST /ton/sign-message — bare Ed25519 signature over arbitrary bytes.
 *
 * Firmware fences this behind the AdvancedMode policy: with AdvancedMode
 * disabled (the default), the device returns a Failure that surfaces here
 * as a vault HTTP error containing some variant of "AdvancedMode" in the
 * body. Detect that and rewrite the message into something a dApp /
 * end-user can act on, instead of "vault returned 400".
 */
async function tonSignMessageViaRest(
  message: string,
  isText: boolean,
): Promise<{ publicKey: string; signature: string }> {
  const apiKey = getApiKey();
  let resp: Response;
  try {
    resp = await fetch(`${VAULT_URL}/ton/sign-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        address_n: TON_ADDRESS_N,
        message,
        is_text: isText,
        show_display: true,
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e: any) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw createProviderRpcError(-32603, 'Vault TON sign-message timed out');
    }
    throw createProviderRpcError(-32603, `Vault connection failed: ${e.message}`);
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    if (/advanced\s*mode/i.test(text)) {
      // Translate the firmware-policy failure into a clear, actionable
      // message — there's no automatic recovery, the user must enable
      // AdvancedMode on the device first.
      throw createProviderRpcError(
        4200,
        'TON message signing requires Advanced Mode on your KeepKey. Open the KeepKey Vault desktop app → Settings → Security and enable "Advanced Mode", then retry.',
      );
    }
    throw createProviderRpcError(-32603, `Vault TON sign-message failed (${resp.status}): ${text}`);
  }
  const result = await resp.json();
  if (!result?.signature || !result?.publicKey) {
    throw createProviderRpcError(-32603, 'Vault returned no TON message signature');
  }
  return { publicKey: result.publicKey, signature: result.signature };
}

async function finalizeTransferViaRest(build: any, signature: string): Promise<{ txid: string; boc: string }> {
  const apiKey = getApiKey();
  let resp: Response;
  try {
    resp = await fetch(`${VAULT_URL}/ton/finalize-transfer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ build, signature, broadcast: true }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (e: any) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw createProviderRpcError(-32603, 'Vault TON finalize timed out');
    }
    throw createProviderRpcError(-32603, `Vault connection failed: ${e.message}`);
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw createProviderRpcError(-32603, `Vault TON finalize failed (${resp.status}): ${text}`);
  }
  const result = (await resp.json()) as { txid?: string; boc?: string; broadcasted?: boolean };
  if (!result.txid) {
    throw createProviderRpcError(-32603, 'Vault returned no TON txid');
  }
  return { txid: result.txid, boc: result.boc || '' };
}

export const handleTonRequest = async (
  method: string,
  params: any[],
  requestInfo: any,
  _ADDRESS: string,
  _KEEPKEY_WALLET: any,
  requireApproval: (networkId: string, requestInfo: any, chain: any, method: string, params: any) => Promise<any>,
): Promise<any> => {
  const tag = TAG + ' | handleTonRequest | ';

  switch (method) {
    case 'request_accounts': {
      const address = await getTonAddress();
      return [address];
    }

    case 'request_balance': {
      // Balance lives in the sidebar's cached balances (Pioneer /api/v1/ton/accountInfo).
      return [null];
    }

    case 'transfer': {
      const p = params[0] || {};
      const to = p.to || p.recipient;
      const rawAmount = typeof p.amount === 'object' ? p.amount?.amount : p.amount;
      const memo = typeof p.memo === 'string' ? p.memo : undefined;

      if (!to) throw createProviderRpcError(4000, 'Missing TON recipient');
      if (!rawAmount) throw createProviderRpcError(4000, 'Missing TON amount');

      const amountNano = tonToNano(String(rawAmount));
      const fromAddress = await getTonAddress();

      // Build first so we have the unsigned body ready to display before
      // we pop the approval UI. Without the build step the approval card
      // would render with blank fee/bodyHash/seqno fields.
      let built: TonBuildResponse;
      try {
        built = await buildTransferViaRest({ fromAddress, toAddress: to, amountNano, memo });
      } catch (e: any) {
        console.error(tag, 'build failed:', e);
        throw e;
      }

      requestInfo.id = uuidv4();
      chrome.runtime.sendMessage({ action: 'TRANSACTION_CONTEXT_UPDATED', id: requestInfo.id }).catch(() => {});

      const event = {
        id: requestInfo.id,
        networkId: TON_NETWORK_ID,
        href: requestInfo.href,
        language: requestInfo.language,
        platform: requestInfo.platform,
        referrer: requestInfo.referrer,
        requestTime: requestInfo.requestTime,
        scriptSource: requestInfo.scriptSource,
        siteUrl: requestInfo.siteUrl,
        userAgent: requestInfo.userAgent,
        injectScriptVersion: requestInfo.version,
        chain: 'ton',
        requestInfo,
        // Shape roughly matches other-chain events so the generic
        // OtherTransaction / Tendermint cards can render the key bits.
        unsignedTx: {
          to,
          amount: rawAmount,
          amountNano,
          memo,
          fromAddress,
          bodyHash: built.bodyHash,
          seqno: built.seqno,
          expireAt: built.expireAt,
          needsDeploy: built.needsDeploy,
          feeEstimate: built.feeEstimate,
        },
        type: 'transfer',
        request: params,
        status: 'request',
        timestamp: new Date().toISOString(),
      };
      // @ts-expect-error requestStorage event shape is open
      const eventSaved = await requestStorage.addEvent(event);
      if (!eventSaved) throw Error('Failed to create TON event');

      const result = await requireApproval(TON_NETWORK_ID, requestInfo, 'ton', method, params[0]);
      if (!result?.success) {
        throw createProviderRpcError(4001, 'User denied TON transaction');
      }

      let signature: string;
      try {
        signature = await signTransactionViaRest(built.bodyHash, to, amountNano);
      } catch (e: any) {
        chrome.runtime
          .sendMessage({
            action: 'transaction_error',
            eventId: requestInfo.id,
            error: e?.message || 'TON signing failed',
          })
          .catch(() => {});
        throw e;
      }

      let txid: string;
      try {
        const finalized = await finalizeTransferViaRest(built.build, signature);
        txid = finalized.txid;
      } catch (e: any) {
        chrome.runtime
          .sendMessage({
            action: 'transaction_error',
            eventId: requestInfo.id,
            error: e?.message || 'TON broadcast failed',
          })
          .catch(() => {});
        throw e;
      }

      chrome.runtime
        .sendMessage({
          action: 'transaction_complete',
          eventId: requestInfo.id,
          txHash: txid,
          // tonviewer uses the external-message hash (what finalize returns) for lookup.
          explorerTxLink: 'https://tonviewer.com/transaction/',
          networkId: TON_NETWORK_ID,
        })
        .catch(() => {});

      return txid;
    }

    // Bare Ed25519 SignMessage. AdvancedMode-gated firmware-side; we
    // map that policy failure to a user-actionable error inside
    // tonSignMessageViaRest. dApps pass either a UTF-8 string (default)
    // or hex bytes via { message, isText: false }.
    case 'ton_signMessage':
    case 'signMessage': {
      await requireMessageSigningFirmware('TON message signing');
      const arg = (params || [])[0];
      let messageForVault: string;
      let isText: boolean;
      let displayMessage: unknown;
      if (typeof arg === 'string') {
        messageForVault = arg;
        isText = true;
        displayMessage = arg;
      } else if (Array.isArray(arg)) {
        messageForVault = (arg as number[]).map(b => (b & 0xff).toString(16).padStart(2, '0')).join('');
        isText = false;
        displayMessage = messageForVault;
      } else if (arg && typeof arg === 'object') {
        const msg = (arg as any).message;
        const explicitIsText = (arg as any).isText ?? (arg as any).is_text;
        if (typeof msg === 'string') {
          messageForVault = msg;
          isText = explicitIsText !== false; // default true
          displayMessage = msg;
        } else if (Array.isArray(msg)) {
          messageForVault = (msg as number[]).map(b => (b & 0xff).toString(16).padStart(2, '0')).join('');
          isText = false;
          displayMessage = messageForVault;
        } else {
          throw createProviderRpcError(4000, `${method}: missing or unsupported message field`);
        }
      } else {
        throw createProviderRpcError(4000, `${method}: missing message param`);
      }

      if (!requestInfo.id) requestInfo.id = uuidv4();
      const fromAddress = await getTonAddress();
      const event = {
        id: requestInfo.id,
        networkId: TON_NETWORK_ID,
        chain: 'ton' as const,
        href: requestInfo.href,
        language: requestInfo.language,
        platform: requestInfo.platform,
        referrer: requestInfo.referrer,
        requestTime: requestInfo.requestTime,
        scriptSource: requestInfo.scriptSource,
        siteUrl: requestInfo.siteUrl,
        userAgent: requestInfo.userAgent,
        injectScriptVersion: requestInfo.version,
        requestInfo,
        unsignedTx: {
          kind: 'sign-message',
          from: fromAddress,
          message: displayMessage,
          isText,
        },
        type: method,
        request: params,
        status: 'request' as const,
        timestamp: new Date().toISOString(),
      };
      const saved = await requestStorage.addEvent(event);
      if (!saved) throw createProviderRpcError(-32603, 'Failed to create approval event');
      chrome.runtime.sendMessage({ action: 'TRANSACTION_CONTEXT_UPDATED', id: event.id }).catch(() => {});

      const approval = await requireApproval(TON_NETWORK_ID, requestInfo, 'ton', method, params);
      if (!approval?.success) {
        throw createProviderRpcError(4001, 'User denied TON message signing');
      }

      const { publicKey, signature } = await tonSignMessageViaRest(messageForVault, isText);

      try {
        const stored = await requestStorage.getEventById(requestInfo.id);
        if (stored) {
          stored.signature = signature;
          stored.publicKey = publicKey;
          stored.status = 'completed';
          await requestStorage.updateEventById(requestInfo.id, stored);
        }
      } catch (e) {
        console.warn(tag, 'Failed to persist TON message signature:', e);
      }
      chrome.runtime.sendMessage({ action: 'signature_complete', eventId: requestInfo.id }).catch(() => {});

      return { publicKey, signature };
    }

    default:
      throw createProviderRpcError(4200, `TON method not supported: ${method}`);
  }
};
