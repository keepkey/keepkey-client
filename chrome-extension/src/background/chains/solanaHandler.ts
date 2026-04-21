import { requestStorage } from '@extension/storage';
import { v4 as uuidv4 } from 'uuid';
import * as wallet from '../wallet';
import { createProviderRpcError } from '../utils';

const TAG = ' | solanaHandler | ';

// Vault REST API and Solana mainnet RPC
const VAULT_URL = 'http://localhost:1646';
const SOLANA_RPC_URLS = [
  'https://api.mainnet-beta.solana.com',
  'https://mainnet.helius-rpc.com/?api-key=1d8740dc-e5f4-421c-b823-e1bad1889eff',
];

let cachedRpcUrl: string | null = null;
let cachedRpcTimestamp = 0;
const RPC_CACHE_TTL = 60000; // cache healthy RPC for 60s

async function getSolanaRpcUrl(): Promise<string> {
  const now = Date.now();
  if (cachedRpcUrl && now - cachedRpcTimestamp < RPC_CACHE_TTL) {
    return cachedRpcUrl;
  }
  for (const url of SOLANA_RPC_URLS) {
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
  return SOLANA_RPC_URLS[0]; // fallback to primary
}

// Cached address from device
let cachedAddress: string | null = null;

/** Reset cached state (call when device disconnects or wallet re-inits) */
export function resetSolanaState() {
  cachedAddress = null;
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

// BIP44 path for Solana: m/44'/501'/0'/0'
const SOLANA_ADDRESS_N = [
  0x80000000 + 44, // 0x8000002C
  0x80000000 + 501, // 0x800001F5
  0x80000000 + 0, // 0x80000000
  0x80000000 + 0, // 0x80000000
];

const SOLANA_NETWORK_ID = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const SOLANA_PUBKEY_NOTE = 'Solana account 0';

async function getSolanaAddress(): Promise<string> {
  if (cachedAddress) return cachedAddress;

  // Try the persisted wallet pubkey cache first — works in watch-only mode.
  const walletAddress = wallet.getAddressForNetwork(SOLANA_NETWORK_ID);
  if (walletAddress) {
    cachedAddress = walletAddress;
    return walletAddress;
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
  const result = await sdk.address.solanaGetAddress({ address_n: SOLANA_ADDRESS_N });

  const address = result.address || result;
  if (!address || typeof address !== 'string') {
    throw createProviderRpcError(-32603, 'Vault returned invalid Solana address');
  }

  cachedAddress = address;

  // Persist to the shared pubkey cache so future watch-only sessions have it.
  try {
    await wallet.addPubkey({
      note: SOLANA_PUBKEY_NOTE,
      networks: [SOLANA_NETWORK_ID],
      type: 'address',
      address,
      pubkey: address,
      addressNList: SOLANA_ADDRESS_N,
      addressNListMaster: SOLANA_ADDRESS_N,
      curve: 'ed25519',
      script_type: 'solana',
      accountIndex: 0,
    });
  } catch (e) {
    console.warn(TAG, 'Failed to cache Solana address:', e);
  }

  return address;
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
  // @ts-expect-error
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
async function signTransactionViaRest(txBase64: string): Promise<{ signature: string; serializedTx: string }> {
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
        address_n: SOLANA_ADDRESS_N,
      }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (e: any) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw createProviderRpcError(-32603, 'Vault signing timed out');
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
async function signMessageViaRest(messageBase64: string): Promise<number[]> {
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
        address_n: SOLANA_ADDRESS_N,
      }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (e: any) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw createProviderRpcError(-32603, 'Vault sign-message timed out');
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
 * Broadcast a signed Solana transaction via Solana JSON-RPC.
 * Vault has NO broadcast endpoint — we send directly to Solana RPC.
 */
async function broadcastTransaction(signedTxBase64: string): Promise<string> {
  const rpcUrl = await getSolanaRpcUrl();
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
      signal: AbortSignal.timeout(30000),
    });
  } catch (e: any) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw createProviderRpcError(-32603, 'Solana RPC broadcast timed out');
    }
    throw createProviderRpcError(-32603, `Solana RPC connection failed: ${e.message}`);
  }

  if (!response.ok) {
    throw createProviderRpcError(-32603, `Solana RPC broadcast failed: ${response.status}`);
  }

  const result = await response.json();
  if (result.error) {
    throw createProviderRpcError(-32603, `Solana RPC error: ${result.error.message}`);
  }

  return result.result; // transaction signature (base58)
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
      cachedAddress = null;
      console.log(tag, 'Disconnected');
      return true;
    }

    // ---- Get public key ----
    case 'solana_getPublicKey': {
      return await getSolanaAddress();
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
      const signatureArray = await signMessageViaRest(messageBase64);

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
      const txSignResult = await signTransactionViaRest(txBase64);

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

      const sender = await getSolanaAddress();
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

      const signResult = await signTransactionViaRest(txBase64);
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
      const signResult = await signTransactionViaRest(sendBase64);

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

    default:
      throw createProviderRpcError(4200, `Unsupported Solana method: ${method}`);
  }
};
