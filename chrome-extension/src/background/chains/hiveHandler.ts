import { requestStorage } from '@extension/storage';
import { v4 as uuidv4 } from 'uuid';
import * as wallet from '../wallet';
import { createProviderRpcError, createTimeoutError } from '../utils';
import { requireHiveFirmware } from '../firmware';

const TAG = ' | hiveHandler | ';

// Vault REST API (device signing) + Pioneer (chain reads / broadcast — the
// RPC source of truth; no direct Hive-node URLs, same policy as the vault).
const VAULT_URL = 'http://localhost:1646';
const PIONEER_URL = 'https://api.keepkey.info';
const HIVE_NETWORK_ID = 'hive:beeab0de';
const HIVE_DECIMALS = 3;

// SLIP-0048: m/48'/13'/role'/account'/0' (all hardened). Must match vault +
// firmware (hive.h HIVE_SLIP48_*) and Ledger's Hive app.
const H = 0x80000000;
const HIVE_ROLES = { owner: 0, active: 1, memo: 3, posting: 4 } as const;
function hiveAddressN(role: keyof typeof HIVE_ROLES = 'active', accountIndex = 0): number[] {
  return [H + 48, H + 13, H + HIVE_ROLES[role], H + accountIndex, H + 0];
}

// ponytail: single-account (index 0, active role) spike — multi-account and
// posting-key ops when a dApp actually needs them.
let cachedPubkey: string | null = null;
let cachedAccountName: string | null = null;

export function resetHiveState() {
  cachedPubkey = null;
  cachedAccountName = null;
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

/** Derive the active-role STM public key via the vault. */
async function getHivePublicKey(): Promise<string> {
  if (cachedPubkey) return cachedPubkey;
  const resp = await fetch(`${VAULT_URL}/addresses/hive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getApiKey()}` },
    body: JSON.stringify({ address_n: hiveAddressN('active', 0) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    if (resp.status === 403)
      throw createProviderRpcError(4100, 'Hive is disabled in the vault — enable it in Vault settings');
    if (resp.status === 501) throw createProviderRpcError(4100, `Hive requires firmware 7.15.0+: ${text}`);
    throw createProviderRpcError(-32603, `Vault /addresses/hive failed (${resp.status}): ${text}`);
  }
  const { address } = await resp.json();
  if (!address) throw createProviderRpcError(-32603, 'Vault returned no Hive public key');
  cachedPubkey = address;
  return address;
}

/** Resolve the on-chain account name owning our active key (Pioneer lookup). */
async function getHiveAccount(): Promise<{ name: string; pubkey: string }> {
  const pubkey = await getHivePublicKey();
  if (cachedAccountName) return { name: cachedAccountName, pubkey };
  const resp = await fetch(`${PIONEER_URL}/api/v1/hive/account/${encodeURIComponent(pubkey)}`, {
    signal: AbortSignal.timeout(20_000),
  });
  const data = await resp.json();
  if (!data.success || data.noAccount || !data.account?.name) {
    throw createProviderRpcError(
      4100,
      'No Hive account exists for this KeepKey yet — create one in the KeepKey Vault (Hive onboarding)',
    );
  }
  cachedAccountName = data.account.name;
  return { name: data.account.name, pubkey };
}

/** Build the event object for the side-panel approval flow */
function buildEvent(requestInfo: any, method: string, params: any[]) {
  if (!requestInfo.id) requestInfo.id = uuidv4();
  return {
    id: requestInfo.id,
    networkId: HIVE_NETWORK_ID,
    chain: 'hive',
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

/** Save event to storage + open side panel + wait for user approval */
async function requestUserApproval(
  event: any,
  requestInfo: any,
  method: string,
  params: any[],
  requireApproval: (networkId: string, requestInfo: any, chain: any, method: string, params: any) => Promise<any>,
) {
  await requestStorage.addEvent(event);
  chrome.runtime.sendMessage({ action: 'TRANSACTION_CONTEXT_UPDATED', id: event.id }).catch(() => {});
  const approval = await requireApproval(HIVE_NETWORK_ID, requestInfo, 'hive', method, params);
  if (!approval?.success) {
    throw createProviderRpcError(4001, 'User rejected the request');
  }
}

/**
 * Full transfer flow: build (Pioneer tx-params + account), approve
 * (side panel), sign (vault → device), broadcast (Pioneer).
 *
 * params[0] mirrors Hive Keychain's requestTransfer:
 * { to, amount: "1.000", memo?, currency: 'HIVE' }
 */
async function hiveTransfer(
  params: any[],
  requestInfo: any,
  requireApproval: (networkId: string, requestInfo: any, chain: any, method: string, params: any) => Promise<any>,
) {
  const { username, to, amount, memo, currency, enforce } = params[0] || {};
  if (!to || !amount) throw createProviderRpcError(-32602, 'Hive transfer requires { to, amount }');
  // ponytail: HIVE only — HBD needs Pioneer broadcast support first
  if (currency !== 'HIVE') {
    throw createProviderRpcError(4200, `Only HIVE transfers are supported (got ${currency ?? 'no currency'})`);
  }
  // Keychain contract: a memo starting with '#' must be encrypted with the
  // memo key. We can't do that yet — reject rather than leak it on-chain
  // as plaintext forever.
  if (typeof memo === 'string' && memo.startsWith('#')) {
    throw createProviderRpcError(
      4200,
      'Encrypted memos (starting with "#") are not supported — the memo would be broadcast as public plaintext',
    );
  }
  // Exact decimal-string validation (Keychain requires 3 decimals); no
  // parseFloat — "1foo" and rounding of "0.0006" must be rejected, not
  // silently coerced into a different transfer.
  if (typeof amount !== 'string' || !/^\d+(\.\d{1,3})?$/.test(amount)) {
    throw createProviderRpcError(
      -32602,
      `Invalid amount "${amount}" — expected a decimal string with up to 3 decimals`,
    );
  }
  const [whole, frac = ''] = amount.split('.');
  const amountBase = Number(whole) * 10 ** HIVE_DECIMALS + Number(frac.padEnd(HIVE_DECIMALS, '0'));
  if (!Number.isSafeInteger(amountBase) || amountBase <= 0) {
    throw createProviderRpcError(-32602, `Invalid amount "${amount}" — must be greater than zero`);
  }
  const amountStr = (amountBase / 10 ** HIVE_DECIMALS).toFixed(HIVE_DECIMALS) + ' HIVE';

  await requireHiveFirmware('Hive transfer');
  const from = await getHiveAccount();
  // Keychain semantics: the dApp may name the sending account. We control
  // exactly one account (index 0), so any mismatch is a hard reject — never
  // report success for a payment from a different account than requested.
  if (enforce === true && !username) {
    throw createProviderRpcError(-32602, 'enforce=true requires a username');
  }
  if (username && username !== from.name) {
    throw createProviderRpcError(
      4100,
      `This KeepKey controls @${from.name}, not @${username}${enforce ? ' (account enforced by the dApp)' : ''}`,
    );
  }

  const txParamsResp = await fetch(`${PIONEER_URL}/api/v1/hive/tx-params`, {
    signal: AbortSignal.timeout(20_000),
  }).then(r => r.json());
  if (!txParamsResp.success) {
    throw createProviderRpcError(-32603, `Hive tx-params failed: ${txParamsResp.error || 'unknown'}`);
  }

  // Approval first — the user sees resolved from/to/amount before the device round-trip
  const event = buildEvent(requestInfo, 'transfer', params);
  (event as any).unsignedTx = {
    from: from.name,
    memo: memo || '',
    refBlockNum: txParamsResp.refBlockNum,
    expiration: txParamsResp.expirationIso,
    caip: 'hive:beeab0de/slip44:1275',
    // Shape the generic approval renderer reads (RequestDetailsCard):
    // amount in base units, divided by 10^decimals for display.
    payment: {
      destination: to,
      amount: amountBase,
      decimals: HIVE_DECIMALS,
      symbol: 'HIVE',
    },
  };
  await requestUserApproval(event, requestInfo, 'transfer', params, requireApproval);

  // Sign on-device via the vault (serialization happens in firmware)
  let signResp: Response;
  try {
    signResp = await fetch(`${VAULT_URL}/hive/sign-transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getApiKey()}` },
      body: JSON.stringify({
        address_n: hiveAddressN('active', 0),
        ref_block_num: txParamsResp.refBlockNum,
        ref_block_prefix: txParamsResp.refBlockPrefix,
        expiration: txParamsResp.expirationUnix,
        from: from.name,
        to,
        amount: amountBase,
        asset_symbol: 'HIVE',
        memo: memo || undefined,
        chain_id: txParamsResp.chainId,
      }),
      // Wait on the user holding the device button
      signal: AbortSignal.timeout(300_000),
    });
  } catch (e: any) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') throw createTimeoutError('Vault signing timed out');
    throw createProviderRpcError(-32603, `Vault connection failed: ${e.message}`);
  }
  if (!signResp.ok) {
    const text = await signResp.text().catch(() => '');
    throw createProviderRpcError(-32603, `Vault Hive sign failed (${signResp.status}): ${text}`);
  }
  const { signature } = await signResp.json();
  if (!signature) throw createProviderRpcError(-32603, 'Vault returned no Hive signature');

  // Broadcast via Pioneer
  const bResp = await fetch(`${PIONEER_URL}/api/v1/hive/broadcast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ref_block_num: txParamsResp.refBlockNum,
      ref_block_prefix: txParamsResp.refBlockPrefix,
      expiration: txParamsResp.expirationIso,
      from: from.name,
      to,
      amount: amountStr,
      memo: memo || '',
      signature: signature.replace(/^0x/, ''),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const bData = await bResp.json().catch(() => ({}));
  if (!bData.success || !bData.txid) {
    throw createProviderRpcError(
      -32603,
      `Hive broadcast failed: ${bData.error || JSON.stringify(bData).slice(0, 200)}`,
    );
  }

  await requestStorage.updateEventById(event.id, { ...event, txid: bData.txid, status: 'broadcasted' } as any);
  chrome.runtime
    .sendMessage({
      action: 'transaction_complete',
      eventId: requestInfo.id,
      txHash: bData.txid,
      explorerTxLink: 'https://hiveblocks.com/tx/',
      networkId: HIVE_NETWORK_ID,
    })
    .catch(() => {});

  // Keychain-shaped result — dApps read response.result.id / .tx_id
  // (hive-tx.utils.ts returns { id, tx_id, confirmed }).
  return {
    id: bData.txid,
    tx_id: bData.txid,
    confirmed: Boolean(bData.blockNum ?? bData.block_num),
  };
}

/**
 * Keychain requestSignBuffer — dApp login. Firmware signs SHA256(message)
 * with the requested role's SLIP-48 key and we return the signature hex as
 * `result` with the STM pubkey beside it, exactly like Hive Keychain.
 */
async function hiveSignBuffer(
  params: any[],
  requestInfo: any,
  requireApproval: (networkId: string, requestInfo: any, chain: any, method: string, params: any) => Promise<any>,
) {
  const { username, message, method: keyRole, title } = params[0] || {};
  if (!message || typeof message !== 'string') {
    throw createProviderRpcError(-32602, 'signBuffer requires a message');
  }
  const role = String(keyRole || '').toLowerCase();
  // Owner is deliberately excluded (matches firmware — owner' is not a
  // signBuffer role; it exists for recovery/authority changes only).
  if (!['posting', 'active', 'memo'].includes(role)) {
    throw createProviderRpcError(-32602, `signBuffer key must be Posting, Active or Memo (got ${keyRole})`);
  }

  // Keychain contract: a message that JSON-parses to a serialized Node
  // Buffer ({type:'Buffer',data:[...]}) is signed as those raw bytes;
  // anything else is signed as the UTF-8 string.
  let payload = message;
  let isText = true;
  try {
    const o = JSON.parse(message, (_k, v) =>
      v !== null && typeof v === 'object' && v.type === 'Buffer' && Array.isArray(v.data) ? Uint8Array.from(v.data) : v,
    );
    if (o instanceof Uint8Array) {
      payload = Array.from(o)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      isText = false;
    }
  } catch {
    /* not JSON — sign the raw string */
  }

  await requireHiveFirmware('Hive message signing');
  const from = await getHiveAccount();
  if (username && username !== from.name) {
    throw createProviderRpcError(4100, `This KeepKey controls @${from.name}, not @${username}`);
  }

  const event = buildEvent(requestInfo, 'signBuffer', params);
  (event as any).unsignedTx = {
    from: from.name,
    messageUtf8: isText ? payload : undefined,
    message: isText ? undefined : payload,
    role,
    title: title || '',
  };
  await requestUserApproval(event, requestInfo, 'signBuffer', params, requireApproval);

  let resp: Response;
  try {
    resp = await fetch(`${VAULT_URL}/hive/sign-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getApiKey()}` },
      body: JSON.stringify({
        address_n: hiveAddressN(role as keyof typeof HIVE_ROLES, 0),
        message: payload,
        is_text: isText,
      }),
      signal: AbortSignal.timeout(300_000),
    });
  } catch (e: any) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') throw createTimeoutError('Vault signing timed out');
    throw createProviderRpcError(-32603, `Vault connection failed: ${e.message}`);
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw createProviderRpcError(-32603, `Vault Hive sign-message failed (${resp.status}): ${text}`);
  }
  const { signature, public_key } = await resp.json();
  if (!signature) throw createProviderRpcError(-32603, 'Vault returned no Hive message signature');

  chrome.runtime.sendMessage({ action: 'signature_complete', eventId: requestInfo.id }).catch(() => {});

  // Keychain shape: result = signature hex, publicKey beside it.
  return { result: signature, publicKey: public_key };
}

export const handleHiveRequest = async (
  method: string,
  params: any[],
  requestInfo: any,
  _ADDRESS: string,
  _KEEPKEY_WALLET: any,
  requireApproval: (networkId: string, requestInfo: any, chain: any, method: string, params: any) => Promise<any>,
): Promise<any> => {
  console.log(TAG, 'method:', method);
  switch (method) {
    case 'hive_handshake': {
      // Keychain-compat presence check — succeed without touching the device
      return true;
    }
    case 'hive_getAccount': {
      const account = await getHiveAccount();
      return account;
    }
    case 'hive_transfer': {
      return await hiveTransfer(params, requestInfo, requireApproval);
    }
    case 'hive_signBuffer': {
      return await hiveSignBuffer(params, requestInfo, requireApproval);
    }
    default:
      throw createProviderRpcError(4200, `Hive method ${method} not supported`);
  }
};
