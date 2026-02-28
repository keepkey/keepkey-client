import { requestStorage } from '@extension/storage';
import { v4 as uuidv4 } from 'uuid';
import * as wallet from '../wallet';
import { createProviderRpcError } from '../utils';

const TAG = ' | solanaHandler | ';

// Vault REST API and Solana mainnet RPC
const VAULT_URL = 'http://localhost:1646';
const SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';

// Cached address from device
let cachedAddress: string | null = null;

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
  return Array.from(atob(b64), c => c.charCodeAt(0));
}

// BIP44 path for Solana: m/44'/501'/0'/0'
const SOLANA_ADDRESS_N = [
  0x80000000 + 44, // 0x8000002C
  0x80000000 + 501, // 0x800001F5
  0x80000000 + 0, // 0x80000000
  0x80000000 + 0, // 0x80000000
];

async function getSolanaAddress(): Promise<string> {
  if (cachedAddress) return cachedAddress;

  const sdk = wallet.getSdk();
  const result = await sdk.address.solanaGetAddress({ address_n: SOLANA_ADDRESS_N });

  const address = result.address || result;
  if (!address || typeof address !== 'string') {
    throw createProviderRpcError(-32603, 'Vault returned invalid Solana address');
  }

  cachedAddress = address;
  return address;
}

/** Build the event object for popup approval flow */
function buildEvent(requestInfo: any, method: string, params: any[]) {
  return {
    id: requestInfo.id || uuidv4(),
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
  return sdk.getClient?.()?.getApiKey?.() || '';
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
  const resp = await fetch(`${VAULT_URL}/solana/sign-transaction`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      raw_tx: txBase64,
      address_n: SOLANA_ADDRESS_N,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw createProviderRpcError(-32603, `Vault sign failed (${resp.status}): ${text}`);
  }

  const result = await resp.json();
  if (!result.signature && !result.serializedTx) {
    throw createProviderRpcError(-32603, 'Vault returned empty sign result');
  }

  return {
    signature: result.signature || '',
    serializedTx: result.serializedTx || result.serialized || '',
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
  const resp = await fetch(`${VAULT_URL}/solana/sign-message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      message: messageBase64,
      address_n: SOLANA_ADDRESS_N,
    }),
  });

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
  const response = await fetch(SOLANA_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: [signedTxBase64, { encoding: 'base64' }],
    }),
  });

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

      chrome.runtime.sendMessage({ action: 'signature_complete' }).catch(() => {});
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

      chrome.runtime.sendMessage({ action: 'signature_complete' }).catch(() => {});
      return signedTxArray;
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
          txHash: txSignature,
          explorerTxLink: 'https://solscan.io/tx/',
        })
        .catch(() => {});

      return txSignature;
    }

    default:
      throw createProviderRpcError(4200, `Unsupported Solana method: ${method}`);
  }
};
