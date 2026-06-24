import { requestStorage, accountsByNetworkStorage, assetContextStorage } from '@extension/storage';
import { SOLANA_DEVNET } from '../testnetPresets';
import { v4 as uuidv4 } from 'uuid';
import * as wallet from '../wallet';
import { createProviderRpcError, createTimeoutError } from '../utils';
import { requireMessageSigningFirmware } from '../firmware';

const TAG = ' | solanaHandler | ';

// Vault REST API and Solana mainnet RPC
const VAULT_URL = 'http://localhost:1646';
const SOLANA_MAINNET_RPC_URLS = [
  'https://api.mainnet-beta.solana.com',
  'https://mainnet.helius-rpc.com/?api-key=1d8740dc-e5f4-421c-b823-e1bad1889eff',
];

// Pick the cluster's RPC list from the active asset context. When the user
// has Solana Devnet selected, sign/broadcast must hit devnet — otherwise a
// devnet tx silently fails on mainnet. Defaults to mainnet.
async function getSolanaRpcUrls(): Promise<string[]> {
  try {
    const ctx = await assetContextStorage.get();
    if ((ctx as any)?.networkId === SOLANA_DEVNET.networkId) return SOLANA_DEVNET.rpcs;
  } catch {
    /* fall through to mainnet */
  }
  return SOLANA_MAINNET_RPC_URLS;
}

let cachedRpcUrl: string | null = null;
let cachedRpcTimestamp = 0;
const RPC_CACHE_TTL = 60000; // cache healthy RPC for 60s

async function getSolanaRpcUrl(): Promise<string> {
  const now = Date.now();
  const urls = await getSolanaRpcUrls();
  // Invalidate the cache if it points at a URL outside the active cluster
  // (e.g. user just switched mainnet <-> devnet).
  if (cachedRpcUrl && !urls.includes(cachedRpcUrl)) cachedRpcUrl = null;
  if (cachedRpcUrl && now - cachedRpcTimestamp < RPC_CACHE_TTL) {
    return cachedRpcUrl;
  }
  for (const url of urls) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
        signal: AbortSignal.timeout(3000),
      });
      if (resp.ok) {
        cachedRpcUrl = url;
        cachedRpcTimestamp = now;
        return url;
      }
    } catch {
      /* try next */
    }
  }
  return urls[0]; // fallback to primary
}

// Cached addresses keyed by BIP44 account index (m/44'/501'/<index>'/0').
// A single slot would pin whichever account derived first and return it for
// every other account (the multi-account "sign-from-0" footgun); keying by
// index lets each account resolve independently.
const cachedAddresses = new Map<number, string>();

/** Reset cached state (call when device disconnects or wallet re-inits) */
export function resetSolanaState() {
  cachedAddresses.clear();
}

/**
 * Prefetch the Solana pubkey at startup so the network shows up in the
 * dropdown without waiting for a dapp-initiated Solana call. Non-throwing —
 * silently skips when no device + no cached address.
 */
export async function prefetchSolanaPubkey(): Promise<void> {
  try {
    await getSolanaAddress();
  } catch (e: any) {
    console.log(TAG, 'Solana prefetch skipped:', e?.message || e);
  }
}

/**
 * Prefetch account 0 AND every persisted Solana account so multi-account
 * setups survive a service-worker restart / device reconnect. Best-effort per
 * account — a single account's derivation failure doesn't block the others.
 */
export async function prefetchSolanaAccounts(): Promise<void> {
  let indices: number[] = [0];
  try {
    indices = await accountsByNetworkStorage.getAccounts(SOLANA_NETWORK_ID);
  } catch {
    /* fall back to account 0 only */
  }
  for (const idx of indices) {
    try {
      await getSolanaAddress(idx);
    } catch (e: any) {
      console.log(TAG, `Solana prefetch account ${idx} skipped:`, e?.message || e);
    }
  }
}

/** Convert a number[] to base64 string (chunked to avoid call-stack limit) */
function toBase64(arr: number[]): string {
  const CHUNK = 8192;
  let str = '';
  for (let i = 0; i < arr.length; i += CHUNK) {
    str += String.fromCharCode(...arr.slice(i, i + CHUNK));
  }
  return btoa(str);
}

/** Convert a base64 string to number[] */
function fromBase64(b64: string): number[] {
  try {
    return Array.from(atob(b64), c => c.charCodeAt(0));
  } catch (e: any) {
    throw createProviderRpcError(-32603, `Failed to decode base64 response: ${e.message}`);
  }
}

// ---------- Solana tx builder (inline, no @solana/web3.js dep) ----------

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

/** Solana compact-u16 varint. 1 byte <128, 2 bytes <16384, else 3 bytes. */
function encodeCompactU16(n: number): number[] {
  if (n < 0 || n > 0xffff) throw new Error('compact-u16 out of range');
  if (n < 0x80) return [n];
  if (n < 0x4000) return [(n & 0x7f) | 0x80, (n >> 7) & 0x7f];
  return [(n & 0x7f) | 0x80, ((n >> 7) & 0x7f) | 0x80, (n >> 14) & 0x03];
}

async function getLatestBlockhash(): Promise<string> {
  const rpcUrl = await getSolanaRpcUrl();
  let resp: Response;
  try {
    resp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestBlockhash' }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e: any) {
    throw createProviderRpcError(-32603, `Solana RPC blockhash fetch failed: ${e.message}`);
  }
  const data = await resp.json().catch(() => ({}));
  const blockhash = data?.result?.value?.blockhash;
  if (!blockhash) throw createProviderRpcError(-32603, 'Solana RPC returned no blockhash');
  return blockhash;
}

/**
 * Build a legacy Solana System Program transfer transaction with a
 * 64-byte zero signature placeholder. Vault's /solana/sign-transaction
 * replaces bytes 1..65 with the real Ed25519 signature before returning.
 *
 * Layout:
 *   sig_count(cu16=1) | zero_sig(64) | header(3) | num_keys(cu16=3)
 *   sender(32) | recipient(32) | system_program(32=zeros)
 *   blockhash(32) | num_instructions(cu16=1)
 *   program_idx(u8=2) | num_accounts(cu16=2) | 0 1
 *   data_len(cu16=12) | instruction(u32_le=2) | lamports(u64_le)
 */
function buildSolanaTransferTx(
  senderBase58: string,
  recipientBase58: string,
  lamports: bigint,
  blockhashBase58: string,
): Uint8Array {
  const senderKey = base58Decode(senderBase58);
  const recipientKey = base58Decode(recipientBase58);
  const blockhashBytes = base58Decode(blockhashBase58);
  if (senderKey.length !== 32) throw createProviderRpcError(4000, 'Invalid sender pubkey');
  if (recipientKey.length !== 32)
    throw createProviderRpcError(4000, `Invalid recipient address (expected 32 bytes, got ${recipientKey.length})`);
  if (blockhashBytes.length !== 32) throw createProviderRpcError(-32603, 'Invalid blockhash length');

  const systemProgram = new Uint8Array(32); // 32 zero bytes

  const data = new Uint8Array(12);
  const dv = new DataView(data.buffer);
  dv.setUint32(0, 2, true); // SystemProgram::Transfer discriminator
  dv.setBigUint64(4, lamports, true);

  const out: number[] = [];
  // Signature section — placeholder
  out.push(...encodeCompactU16(1));
  for (let i = 0; i < 64; i++) out.push(0);
  // Message header: (num_required_signatures, num_readonly_signed, num_readonly_unsigned)
  out.push(1, 0, 1);
  // Account keys
  out.push(...encodeCompactU16(3));
  for (const b of senderKey) out.push(b);
  for (const b of recipientKey) out.push(b);
  for (const b of systemProgram) out.push(b);
  // Recent blockhash
  for (const b of blockhashBytes) out.push(b);
  // Instructions
  out.push(...encodeCompactU16(1));
  out.push(2); // program_id_index → systemProgram
  out.push(...encodeCompactU16(2));
  out.push(0, 1); // sender (signer), recipient
  out.push(...encodeCompactU16(12));
  for (const b of data) out.push(b);

  return new Uint8Array(out);
}

// BIP44 path for Solana: m/44'/501'/<account>'/0' — every level hardened
// (SLIP-0010 ed25519). The account index sits at array index 2; index 3 stays
// pinned at 0'. Account 0 is m/44'/501'/0'/0'.
function solanaAddressN(accountIndex: number): number[] {
  return [
    0x80000000 + 44, // 44'
    0x80000000 + 501, // 501'
    0x80000000 + accountIndex, // account'
    0x80000000 + 0, // 0'
  ];
}
const SOLANA_NETWORK_ID = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const solanaNote = (accountIndex: number) => `Solana account ${accountIndex}`;

// Resolve which Solana account a request targets so signing uses the matching
// derivation path. In-app Transfer threads `accountIndex` on the payload
// object; dApp wallet-standard threads the signing account's base58 address as
// `requestInfo.solanaAccountAddress`, which we map back to its account index
// via the cached pubkeys. Defaults to account 0 (prior single-account behavior).
function resolveSolanaAccountIndex(params: any[], requestInfo: any): number {
  const p = params?.[0];
  if (p && !Array.isArray(p) && typeof p.accountIndex === 'number') return p.accountIndex;
  // Wallet-standard sign methods thread the signing account's base58 address as
  // params[1].accountAddress; map it back to the derived account index.
  const addr = params?.[1]?.accountAddress || requestInfo?.solanaAccountAddress;
  if (typeof addr === 'string') {
    const match = wallet.getPubkeys(SOLANA_NETWORK_ID).find((pk: any) => pk.address === addr);
    if (match) return typeof match.accountIndex === 'number' ? match.accountIndex : 0;
    throw createProviderRpcError(4000, `Unknown Solana account: ${addr}`);
  }
  return 0;
}

async function getSolanaAddress(accountIndex = 0): Promise<string> {
  const cached = cachedAddresses.get(accountIndex);
  if (cached) return cached;

  // Try the persisted wallet pubkey cache first — works in watch-only mode.
  // Match by note (account index): getAddressForNetwork returns pubkeys[0] and
  // is account-blind, so it would hand account 0's address back for account N.
  const note = solanaNote(accountIndex);
  const cachedPubkey = wallet.getPubkeys(SOLANA_NETWORK_ID).find((pk: any) => pk.note === note);
  if (cachedPubkey?.address) {
    cachedAddresses.set(accountIndex, cachedPubkey.address);
    return cachedPubkey.address;
  }

  // Not cached — need the device.
  if (!wallet.isDeviceConnected()) {
    // Try one probe in case device was plugged in after start
    const reachable = await wallet.probeDevice();
    if (!reachable) {
      throw createProviderRpcError(
        -32603,
        'KeepKey device not connected and no cached Solana address. Plug in your device to derive one.',
      );
    }
  }

  const sdk = wallet.getSdk();
  const address_n = solanaAddressN(accountIndex);
  const result = await sdk.address.solanaGetAddress({ address_n });

  const address = result.address || result;
  if (!address || typeof address !== 'string') {
    throw createProviderRpcError(-32603, 'Vault returned invalid Solana address');
  }

  cachedAddresses.set(accountIndex, address);

  // Persist to the shared pubkey cache so future watch-only sessions have it.
  try {
    await wallet.addPubkey({
      note,
      networks: [SOLANA_NETWORK_ID],
      type: 'address',
      address,
      pubkey: address,
      addressNList: address_n,
      addressNListMaster: address_n,
      curve: 'ed25519',
      script_type: 'solana',
      accountIndex,
    });
  } catch (e) {
    console.warn(TAG, 'Failed to cache Solana address:', e);
  }

  return address;
}

/**
 * Derive (and persist) a specific Solana account on demand. Used by the
 * ADD_ACCOUNT background handler and the startup reload of persisted accounts,
 * which both need to materialize account N's pubkey outside the batch xpub flow.
 */
export async function deriveSolanaAccount(accountIndex: number): Promise<string> {
  return getSolanaAddress(accountIndex);
}

/** Build the event object for popup approval flow */
function buildEvent(requestInfo: any, method: string, params: any[]) {
  // Ensure requestInfo.id is set so callers downstream (including message payloads
  // that tag chrome.runtime events with eventId) reference the same id we store.
  if (!requestInfo.id) requestInfo.id = uuidv4();
  return {
    id: requestInfo.id,
    networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    chain: 'solana',
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
    type: method,
    request: params,
    status: 'request',
    timestamp: new Date().toISOString(),
  };
}

/** Save event to storage + open popup + wait for user approval */
async function requestUserApproval(
  event: any,
  requestInfo: any,
  method: string,
  params: any[],
  requireApproval: (networkId: string, requestInfo: any, chain: any, method: string, params: any) => Promise<any>,
) {
  await requestStorage.addEvent(event);
  chrome.runtime
    .sendMessage({
      action: 'TRANSACTION_CONTEXT_UPDATED',
      id: event.id,
    })
    .catch(() => {});

  const approval = await requireApproval(
    'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    requestInfo,
    'solana',
    method,
    params,
  );
  if (!approval?.success) {
    throw createProviderRpcError(4001, 'User rejected the request');
  }
}

/** Get the Bearer API key from the SDK for direct REST calls */
function getApiKey(): string {
  const sdk = wallet.getSdk();
  const key = sdk.getClient?.()?.getApiKey?.();
  if (!key) {
    throw createProviderRpcError(-32603, 'API key not available — vault may not be connected');
  }
  return key;
}

/**
 * Sign a Solana transaction via direct REST call to the vault.
 *
 * POST /solana/sign-transaction { raw_tx: base64, address_n: [...] }
 * Response: { signature: base64(64 bytes), serializedTx: base64(full signed tx) }
 *
 * The vault replaces the dummy 64-byte signature at bytes 1-64 in raw_tx
 * with the real Ed25519 signature from the device.
 */
async function signTransactionViaRest(
  txBase64: string,
  accountIndex = 0,
): Promise<{ signature: string; serializedTx: string }> {
  const apiKey = getApiKey();
  let resp: Response;
  try {
    resp = await fetch(`${VAULT_URL}/solana/sign-transaction`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        raw_tx: txBase64,
        address_n: solanaAddressN(accountIndex),
      }),
      // Wait on the user holding the device button — see the matching
      // comment in signMessageViaRest for the rationale.
      signal: AbortSignal.timeout(300_000),
    });
  } catch (e: any) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw createTimeoutError('Vault signing timed out');
    }
    throw createProviderRpcError(-32603, `Vault connection failed: ${e.message}`);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw createProviderRpcError(-32603, `Vault sign failed (${resp.status}): ${text}`);
  }

  const result = await resp.json();
  const serializedTx = result.serializedTx || result.serialized || '';
  if (!serializedTx) {
    throw createProviderRpcError(-32603, 'Vault returned no signed transaction data');
  }

  return {
    signature: result.signature || '',
    serializedTx,
  };
}

/**
 * Sign an arbitrary message via dedicated /solana/sign-message endpoint.
 *
 * Uses firmware message type 754 (SolanaSignMessage) which signs raw bytes
 * directly via Ed25519 — unlike type 752 (SolanaSignTx) which parses
 * bytes as a Solana transaction and fails on non-transaction data.
 *
 * Returns: { signature: base64(64 bytes), publicKey: base64(32 bytes) }
 */
async function signMessageViaRest(messageBase64: string, accountIndex = 0): Promise<number[]> {
  const apiKey = getApiKey();
  let resp: Response;
  try {
    resp = await fetch(`${VAULT_URL}/solana/sign-message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        message: messageBase64,
        address_n: solanaAddressN(accountIndex),
      }),
      // Hardware signing waits on the user reading the message and
      // confirming on-device. Match the injected-script callback ceiling
      // (5 min) so we never time out *before* the user has a chance to
      // act. Aborting earlier produced a red "Vault sign-message timed
      // out" panel even though the device was still happily waiting.
      signal: AbortSignal.timeout(300_000),
    });
  } catch (e: any) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw createTimeoutError('Vault sign-message timed out');
    }
    throw createProviderRpcError(-32603, `Vault connection failed: ${e.message}`);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw createProviderRpcError(-32603, `Vault sign-message failed (${resp.status}): ${text}`);
  }

  const result = await resp.json();
  console.log(TAG, 'signMessageViaRest result keys:', Object.keys(result));

  // Extract the 64-byte Ed25519 signature (base64-encoded)
  if (result.signature) {
    return fromBase64(result.signature);
  }

  throw createProviderRpcError(-32603, 'Vault returned no signature for message');
}

/**
 * POST /solana/sign-offchain-message — domain-separated envelope.
 *
 * Firmware constructs:
 *   "\xff" || "solana offchain" || version || format || length || msg
 * and Ed25519-signs the envelope (NOT the bare message). Verifiers must
 * reconstruct the same envelope before checking the signature — see the
 * `solana_signOffchainMessage` case below for the verifier guidance we
 * surface to dApps.
 *
 * version: 0 is the only currently-defined revision.
 * messageFormat:
 *   0 = restricted ASCII (printable + space, max 1212 bytes)
 *   1 = UTF-8           (max 1212 bytes; firmware rejects format 2)
 *
 * Response: 64-byte Ed25519 signature + 32-byte public key, hex.
 */
async function signOffchainMessageViaRest(
  messageHex: string,
  version: number,
  messageFormat: number,
  accountIndex = 0,
): Promise<{ publicKey: string; signature: string }> {
  const apiKey = getApiKey();
  let resp: Response;
  try {
    resp = await fetch(`${VAULT_URL}/solana/sign-offchain-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        address_n: solanaAddressN(accountIndex),
        message: messageHex,
        is_text: false, // Pre-encoded to hex above so the vault doesn't second-guess.
        version,
        message_format: messageFormat,
        show_display: true,
      }),
      signal: AbortSignal.timeout(300_000),
    });
  } catch (e: any) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw createTimeoutError('Vault Solana sign-offchain timed out');
    }
    throw createProviderRpcError(-32603, `Vault connection failed: ${e.message}`);
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw createProviderRpcError(-32603, `Vault Solana sign-offchain failed (${resp.status}): ${text}`);
  }
  const result = await resp.json();
  if (!result?.signature || !result?.publicKey) {
    throw createProviderRpcError(-32603, 'Vault returned no Solana off-chain signature');
  }
  return { publicKey: result.publicKey, signature: result.signature };
}

function bytesToHex(bytes: Uint8Array | number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += (bytes[i] & 0xff).toString(16).padStart(2, '0');
  return out;
}

/**
 * Encode bytes to base58 (Bitcoin alphabet — same as Solana). Pairs
 * with the existing `base58Decode` defined for the tx-builder path
 * above; both share `BASE58_ALPHABET`. Used in the rare "already
 * processed" broadcast-recovery path to derive the tx signature
 * locally from the signed bytes.
 */
function bytesToBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [0];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '';
  for (let i = 0; i < zeros; i++) out += '1';
  for (let i = digits.length - 1; i >= 0; i--) out += BASE58_ALPHABET[digits[i]];
  return out;
}

/**
 * A signed Solana transaction's first 64 bytes after the signature
 * count are the first signature, which IS the transaction's canonical
 * signature (and what `sendTransaction` returns). We can derive it
 * locally without an RPC round-trip — useful when an RPC reports
 * "already processed" (the tx is in mempool somewhere; the dApp still
 * needs the signature).
 *
 * Layout: [compact-u16 sig_count] [64-byte sig × N] [message]
 * For the >253 sig case the count is multi-byte, but real txs almost
 * always have 1–3 sigs (one byte). We read defensively just in case.
 */
function extractFirstSignatureBase58(signedTxBase64: string): string | null {
  try {
    const bin = atob(signedTxBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (bytes.length < 65) return null;
    // compact-u16: each byte uses low 7 bits + continuation bit. Start
    // by skipping continuation bytes to find the sig array offset.
    let cursor = 0;
    while (cursor < bytes.length && (bytes[cursor] & 0x80) !== 0 && cursor < 3) cursor++;
    cursor++; // include the final length byte
    if (bytes.length < cursor + 64) return null;
    return bytesToBase58(bytes.slice(cursor, cursor + 64));
  } catch {
    return null;
  }
}

/**
 * Classify a Solana sendTransaction error.
 *
 *  - 'transient'      → rate limit / network / 5xx, AND a few RPC-state
 *                       quirks ("blockhash not found" can be RPC
 *                       freshness for dApp-supplied txs; "account in
 *                       use" can be a transient race) — try next URL.
 *  - 'already-processed' → tx is already in mempool / processed.
 *                       Treat as success; pull sig from signed bytes.
 *  - 'definitive'     → tx-level reject (insufficient funds, signature
 *                       verification, block height exceeded — the
 *                       blockhash window has truly closed).
 */
type SolanaBroadcastErrorKind = 'transient' | 'already-processed' | 'definitive';
function classifySolanaBroadcastError(msg: string): SolanaBroadcastErrorKind {
  const m = msg.toLowerCase();
  if (m.includes('already processed')) return 'already-processed';
  if (
    m.includes('insufficient funds') ||
    m.includes('insufficient lamports') ||
    m.includes('block height exceeded') ||
    m.includes('invalid signature') ||
    m.includes('signature verification')
  ) {
    return 'definitive';
  }
  // Everything else — rate limit / network / 5xx, plus 'blockhash not
  // found' (RPC freshness) and 'account in use' (transient race) — is
  // worth trying the next URL.
  return 'transient';
}

/**
 * Broadcast a signed Solana transaction via Solana JSON-RPC.
 * Vault has NO broadcast endpoint — we send directly to Solana RPC.
 *
 * Iterates the active cluster's RPC URLs on transient failures. Health-checked URLs
 * sometimes pass `getHealth` but reject `sendTransaction` (rate-limit,
 * regional throttling), so the failover loop reaches further than the
 * pre-flight selection in `getSolanaRpcUrl`.
 */
async function broadcastTransaction(signedTxBase64: string): Promise<string> {
  const errors: { url: string; error: string }[] = [];
  // Try the cached/healthy URL first, then any others not yet attempted.
  const primary = await getSolanaRpcUrl();
  const clusterUrls = await getSolanaRpcUrls();
  const ordered = [primary, ...clusterUrls.filter(u => u !== primary)];

  for (const rpcUrl of ordered) {
    let response: Response;
    try {
      response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'sendTransaction',
          params: [signedTxBase64, { encoding: 'base64' }],
        }),
        signal: AbortSignal.timeout(15000),
      });
    } catch (e: any) {
      const errMsg = e.name === 'TimeoutError' || e.name === 'AbortError' ? 'broadcast timed out' : e.message;
      errors.push({ url: rpcUrl, error: errMsg });
      // Network/timeout — invalidate the cached health pick so the
      // next caller will retest and try another candidate first.
      cachedRpcUrl = null;
      continue;
    }

    if (!response.ok) {
      // 4xx is definitive (bad request / signature). 5xx + 429 are transient.
      const errMsg = `HTTP ${response.status}`;
      if (response.status >= 500 || response.status === 429) {
        errors.push({ url: rpcUrl, error: errMsg });
        cachedRpcUrl = null;
        continue;
      }
      throw createProviderRpcError(-32603, `Solana RPC broadcast failed: ${errMsg}`);
    }

    const result = await response.json();
    if (result.error) {
      const errMsg = result.error.message || JSON.stringify(result.error);
      const kind = classifySolanaBroadcastError(errMsg);

      if (kind === 'already-processed') {
        // Tx is already in mempool / processed somewhere. Recover the
        // signature from the signed bytes (it's deterministic; first
        // sig of the signed tx == tx signature). Returning preserves
        // dApp UX: the user sees a successful send and polls the
        // signature normally.
        const sig = extractFirstSignatureBase58(signedTxBase64);
        if (sig) {
          console.log(`[solana broadcast] ${rpcUrl} reports already-processed; using extracted sig ${sig}`);
          return sig;
        }
        // Fallback: extraction failed (malformed signedTx). Treat as
        // transient — maybe another RPC has the signature stored.
        console.warn(`[solana broadcast] ${rpcUrl} already-processed but sig extraction failed; trying next URL`);
        errors.push({ url: rpcUrl, error: errMsg });
        cachedRpcUrl = null;
        continue;
      }

      if (kind === 'transient') {
        errors.push({ url: rpcUrl, error: errMsg });
        cachedRpcUrl = null;
        continue;
      }
      // Definitive — won't recover on another RPC.
      throw createProviderRpcError(-32603, `Solana RPC error: ${errMsg}`);
    }

    return result.result; // transaction signature (base58)
  }

  // All candidates failed transient.
  console.error('[solana broadcast] all RPCs failed:', errors);
  const last = errors[errors.length - 1]?.error || 'unknown';
  if (/timed out|timeout/i.test(last)) {
    throw createTimeoutError('Solana RPC broadcast timed out');
  }
  throw createProviderRpcError(-32603, `All ${ordered.length} Solana RPCs failed broadcast: ${last}`);
}

export const handleSolanaRequest = async (
  method: string,
  params: any[],
  requestInfo: any,
  ADDRESS: string,
  KEEPKEY_WALLET: any,
  requireApproval: (networkId: string, requestInfo: any, chain: any, method: string, params: any) => Promise<any>,
): Promise<any> => {
  const tag = TAG + ' | handleSolanaRequest | ';
  console.log(tag, 'method:', method);

  switch (method) {
    // ---- Connect ----
    case 'solana_connect': {
      const address = await getSolanaAddress();
      console.log(tag, 'Connected with address:', address);
      return address;
    }

    // ---- Disconnect ----
    case 'solana_disconnect': {
      cachedAddresses.clear();
      console.log(tag, 'Disconnected');
      return true;
    }

    // ---- Get public key ----
    case 'solana_getPublicKey': {
      return await getSolanaAddress();
    }

    // ---- Enumerate accounts (wallet-standard multi-account) ----
    // Returns every derived Solana account (address + index) so the injected
    // wallet-standard can expose them all. Sign requests carry the chosen
    // account's address, which the sign handlers map back to its index.
    case 'solana_getAccounts': {
      const existing = wallet
        .getPubkeys(SOLANA_NETWORK_ID)
        .filter((pk: any) => pk.address)
        .map((pk: any) => ({
          address: pk.address as string,
          accountIndex: typeof pk.accountIndex === 'number' ? pk.accountIndex : 0,
        }));
      if (existing.length === 0) {
        const addr = await getSolanaAddress(0);
        return [{ address: addr, accountIndex: 0 }];
      }
      return existing.sort((a, b) => a.accountIndex - b.accountIndex);
    }

    // ---- Sign message ----
    // Uses /solana/sign-transaction endpoint — device signs raw bytes.
    case 'solana_signMessage': {
      const messageArray: number[] = params[0];
      if (!messageArray || !Array.isArray(messageArray)) {
        throw createProviderRpcError(4000, 'Invalid params: expected message as number[]');
      }

      const event = buildEvent(requestInfo, method, params);
      await requestUserApproval(event, requestInfo, method, params, requireApproval);

      // Direct REST call — vault signs whatever raw bytes it receives
      const messageBase64 = toBase64(messageArray);
      const signatureArray = await signMessageViaRest(messageBase64, resolveSolanaAccountIndex(params, requestInfo));

      chrome.runtime.sendMessage({ action: 'signature_complete', eventId: requestInfo.id }).catch(() => {});
      return signatureArray;
    }

    // ---- Sign transaction ----
    case 'solana_signTransaction': {
      const txArray: number[] = params[0];
      if (!txArray || !Array.isArray(txArray)) {
        throw createProviderRpcError(4000, 'Invalid params: expected transaction as number[]');
      }

      const txEvent = buildEvent(requestInfo, method, params);
      await requestUserApproval(txEvent, requestInfo, method, params, requireApproval);

      const txBase64 = toBase64(txArray);
      const txSignResult = await signTransactionViaRest(txBase64, resolveSolanaAccountIndex(params, requestInfo));

      // Return the fully signed transaction (vault replaces dummy sig at bytes 1-64)
      const signedTxArray = fromBase64(txSignResult.serializedTx);

      chrome.runtime.sendMessage({ action: 'signature_complete', eventId: requestInfo.id }).catch(() => {});
      return signedTxArray;
    }

    // ---- Transfer (side-panel Send flow) ----
    // Payload shape from Transfer.tsx:
    //   params[0] = { caip, amount: { amount, denom }, recipient, memo, isMax }
    // Build SOL transfer tx locally, stash it on the approval event so
    // Transaction.tsx can render sender/recipient/amount, then sign via
    // vault and broadcast via Solana RPC.
    case 'transfer': {
      const payload = params?.[0] || {};
      const recipient: string = payload.recipient;
      const amountSol: string = payload?.amount?.amount ?? payload?.amount ?? '';

      if (!recipient) throw createProviderRpcError(4000, 'Missing recipient');
      if (!amountSol) throw createProviderRpcError(4000, 'Missing amount');

      const amountFloat = parseFloat(amountSol);
      if (!Number.isFinite(amountFloat) || amountFloat <= 0) {
        throw createProviderRpcError(4000, 'Invalid SOL amount');
      }
      // 1 SOL = 1_000_000_000 lamports. Round to avoid FP leftovers.
      const lamports = BigInt(Math.round(amountFloat * 1e9));
      if (lamports <= 0n) throw createProviderRpcError(4000, 'Amount too small');

      // sender and signer MUST use the same account or the built tx won't
      // match the signature. Both derive from acctIdx.
      const acctIdx = typeof payload.accountIndex === 'number' ? payload.accountIndex : 0;
      const sender = await getSolanaAddress(acctIdx);
      const blockhash = await getLatestBlockhash();
      const txBytes = buildSolanaTransferTx(sender, recipient, lamports, blockhash);
      const txBase64 = toBase64(Array.from(txBytes));

      if (!requestInfo.id) requestInfo.id = uuidv4();
      const event = {
        id: requestInfo.id,
        networkId: SOLANA_NETWORK_ID,
        chain: 'solana',
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
          from: sender,
          to: recipient,
          amount: amountSol,
          lamports: lamports.toString(),
          blockhash,
          txBase64,
        },
        type: 'transfer',
        request: params,
        status: 'request',
        timestamp: new Date().toISOString(),
      };
      // @ts-expect-error
      const saved = await requestStorage.addEvent(event);
      if (!saved) throw createProviderRpcError(-32603, 'Failed to create approval event');
      chrome.runtime.sendMessage({ action: 'TRANSACTION_CONTEXT_UPDATED', id: event.id }).catch(() => {});

      const approval = await requireApproval(SOLANA_NETWORK_ID, requestInfo, 'solana', method, params);
      if (!approval?.success) {
        throw createProviderRpcError(4001, 'User denied transaction');
      }

      const signResult = await signTransactionViaRest(txBase64, acctIdx);
      const txSignature = await broadcastTransaction(signResult.serializedTx);

      // Persist txid so the approval UI's success state can show it.
      try {
        const stored = await requestStorage.getEventById(requestInfo.id);
        if (stored) {
          stored.txid = txSignature;
          stored.status = 'broadcasted';
          await requestStorage.updateEventById(requestInfo.id, stored);
        }
      } catch (e) {
        console.warn(tag, 'Failed to persist txid on event:', e);
      }

      chrome.runtime
        .sendMessage({
          action: 'transaction_complete',
          eventId: requestInfo.id,
          txHash: txSignature,
          explorerTxLink: 'https://solscan.io/tx/',
          networkId: SOLANA_NETWORK_ID,
        })
        .catch(() => {});

      return txSignature;
    }

    // ---- Sign and send transaction ----
    case 'solana_signAndSendTransaction': {
      const sendTxArray: number[] = params[0];
      if (!sendTxArray || !Array.isArray(sendTxArray)) {
        throw createProviderRpcError(4000, 'Invalid params: expected transaction as number[]');
      }

      const sendEvent = buildEvent(requestInfo, method, params);
      await requestUserApproval(sendEvent, requestInfo, method, params, requireApproval);

      // Sign via direct REST call
      const sendBase64 = toBase64(sendTxArray);
      const signResult = await signTransactionViaRest(sendBase64, resolveSolanaAccountIndex(params, requestInfo));

      // Broadcast via Solana RPC (vault has no broadcast endpoint)
      const txSignature = await broadcastTransaction(signResult.serializedTx);

      chrome.runtime
        .sendMessage({
          action: 'transaction_complete',
          eventId: requestInfo.id,
          txHash: txSignature,
          explorerTxLink: 'https://solscan.io/tx/',
          networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        })
        .catch(() => {});

      return txSignature;
    }

    // ---- Sign off-chain message (domain-separated envelope) ----
    //
    // CRITICAL — verifier guidance for callers:
    //
    // The signature returned here is over the Solana off-chain envelope
    // (https://github.com/solana-labs/solana/blob/master/docs/src/proposals/off-chain-message-signing.md),
    // NOT the bare message bytes. Verifiers MUST reconstruct:
    //
    //   "\xff" || "solana offchain" || version (1B) || format (1B)
    //                                || length (2B LE) || message
    //
    // and Ed25519-verify against THAT envelope using the returned
    // `publicKey`. Verifying against the bare bytes will always fail.
    //
    // Use this method when you specifically need the off-chain envelope
    // (some authenticators / dApps require it). For Wallet Standard
    // bare-message signing, keep using `solana_signMessage`.
    case 'solana_signOffchainMessage': {
      await requireMessageSigningFirmware('Solana off-chain message signing');
      const arg = (params || [])[0];
      let messageBytes: number[];
      let version = 0;
      // Default to UTF-8 (format 1). Format 0 (restricted ASCII) is
      // stricter and most modern callers use UTF-8.
      let messageFormat = 1;

      if (Array.isArray(arg)) {
        messageBytes = arg as number[];
      } else if (typeof arg === 'string') {
        messageBytes = Array.from(new TextEncoder().encode(arg));
      } else if (arg && typeof arg === 'object') {
        const msg = (arg as any).message;
        if (Array.isArray(msg)) {
          messageBytes = msg as number[];
        } else if (typeof msg === 'string') {
          messageBytes = Array.from(new TextEncoder().encode(msg));
        } else {
          throw createProviderRpcError(4000, 'solana_signOffchainMessage: missing message');
        }
        if (typeof (arg as any).version === 'number') version = (arg as any).version;
        if (typeof (arg as any).messageFormat === 'number') {
          messageFormat = (arg as any).messageFormat;
        } else if (typeof (arg as any).message_format === 'number') {
          messageFormat = (arg as any).message_format;
        }
      } else {
        throw createProviderRpcError(4000, 'solana_signOffchainMessage: invalid params');
      }

      if (messageBytes.length === 0) {
        throw createProviderRpcError(4000, 'solana_signOffchainMessage: empty message');
      }
      if (messageBytes.length > 1212) {
        // Firmware rejects > 1212 bytes for both format 0 and 1.
        throw createProviderRpcError(
          4000,
          `solana_signOffchainMessage: message too long (${messageBytes.length} bytes; max 1212 for off-chain spec)`,
        );
      }

      const event = buildEvent(requestInfo, method, params);
      // Decorate the event with the envelope-signing hint so the
      // approval card can warn the user about the verification model.
      (event as any).unsignedTx = {
        kind: 'sign-offchain-message',
        version,
        messageFormat,
        message: bytesToHex(messageBytes),
        // Used by the approval UI to render the message in plain text
        // when format=1 (UTF-8). Falls back to hex on decode failure.
        messageUtf8: tryDecodeUtf8(messageBytes),
        verifyAgainst: 'envelope', // hint for any downstream UI
      };
      await requestUserApproval(event, requestInfo, method, params, requireApproval);

      const { publicKey, signature } = await signOffchainMessageViaRest(
        bytesToHex(messageBytes),
        version,
        messageFormat,
        resolveSolanaAccountIndex(params, requestInfo),
      );

      try {
        const stored = await requestStorage.getEventById(requestInfo.id);
        if (stored) {
          stored.signature = signature;
          stored.publicKey = publicKey;
          stored.status = 'completed';
          await requestStorage.updateEventById(requestInfo.id, stored);
        }
      } catch (e) {
        console.warn(tag, 'Failed to persist off-chain signature on event:', e);
      }
      chrome.runtime.sendMessage({ action: 'signature_complete', eventId: requestInfo.id }).catch(() => {});

      // Return both — caller needs `publicKey` to identify which device
      // identity signed (Solana off-chain spec ties signer identity to
      // the envelope) and `signature` to verify. Both hex.
      return { publicKey, signature };
    }

    default:
      throw createProviderRpcError(4200, `Unsupported Solana method: ${method}`);
  }
};

/** Best-effort UTF-8 decode for the approval card; returns null on invalid bytes. */
function tryDecodeUtf8(bytes: number[]): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return null;
  }
}
