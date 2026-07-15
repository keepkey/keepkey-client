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
  const { to, amount, memo, currency } = params[0] || {};
  if (!to || !amount) throw createProviderRpcError(-32602, 'Hive transfer requires { to, amount }');
  // ponytail: HIVE only — HBD needs Pioneer broadcast support first
  if (currency && currency !== 'HIVE') {
    throw createProviderRpcError(4200, `Only HIVE transfers are supported (got ${currency})`);
  }
  const parsed = parseFloat(amount);
  if (!isFinite(parsed) || parsed <= 0) throw createProviderRpcError(-32602, `Invalid amount: ${amount}`);
  const amountBase = Math.round(parsed * 10 ** HIVE_DECIMALS);
  const amountStr = (amountBase / 10 ** HIVE_DECIMALS).toFixed(HIVE_DECIMALS) + ' HIVE';

  await requireHiveFirmware('Hive transfer');
  const from = await getHiveAccount();

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
    to,
    amount: amountStr,
    memo: memo || '',
    refBlockNum: txParamsResp.refBlockNum,
    expiration: txParamsResp.expirationIso,
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

  return { txid: bData.txid };
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
    default:
      throw createProviderRpcError(4200, `Hive method ${method} not supported`);
  }
};
