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

// Read-only account info cache for the UI (list/receive/balance). TTL-bounded
// so the dashboard reflects balance changes, and an in-flight promise so the
// concurrent UI response paths (GET_APP_PUBKEYS/BALANCES, asset-context)
// share ONE vault round-trip instead of each hitting the device.
const HIVE_INFO_TTL_MS = 60_000;
let cachedInfo: HiveAccountInfo | null = null;
let cachedInfoAt = 0;
let inflightInfo: Promise<HiveAccountInfo> | null = null;

export function resetHiveState() {
  cachedPubkey = null;
  cachedAccountName = null;
  cachedInfo = null;
  cachedInfoAt = 0;
  inflightInfo = null;
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

/**
 * Read-only account info for the side-panel network list (name + address +
 * native balance). Soft-fails instead of throwing so a locked/disabled Hive
 * or an unregistered key just leaves Hive out of the list rather than
 * breaking the header. `address` is the Hive account name — that's the
 * user-facing identifier and the transfer destination.
 */
/** The full Hive account picture beyond liquid HIVE — display-only holdings. */
export type HiveHoldings = {
  hbd: string; // liquid HBD (stablecoin)
  hp: string; // Hive Power (staked HIVE, VESTS→HP)
  hiveSavings: string;
  hbdSavings: string;
  pendingHive: string;
  pendingHbd: string;
  pendingHp: string;
  hpDelegatedOut: string;
  hpDelegatedIn: string;
  rcPercent: number; // 0-100
  poweringDown: boolean;
  powerDownWeeklyHp: string;
};

export type HiveAccountInfo =
  | ({ ok: true; name: string; pubkey: string; hive: string; priceUsd: string } & HiveHoldings)
  | { ok: false; reason: string };

/**
 * HIVE price in USD from Pioneer. Pioneer's market map is keyed by the FULL
 * CAIP-19 (`hive:beeab0de/slip44:1275`) — the networkId or 'HIVE' ticker both
 * return 0 — so we must ask by HIVE_CAIP. Response: `{ data: [price], success }`.
 * Returns '0' on any failure (price simply unavailable that render).
 */
async function fetchHivePriceUsd(): Promise<string> {
  try {
    const resp = await fetch(`${PIONEER_URL}/api/v1/market/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([HIVE_CAIP]),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await resp.json();
    const price = data?.data?.[0];
    return Number.isFinite(Number(price)) && Number(price) > 0 ? String(price) : '0';
  } catch {
    return '0';
  }
}

async function fetchHiveAccountInfo(): Promise<HiveAccountInfo> {
  try {
    const pubkey = await getHivePublicKey();
    const resp = await fetch(`${PIONEER_URL}/api/v1/hive/account/${encodeURIComponent(pubkey)}`, {
      signal: AbortSignal.timeout(20_000),
    });
    const data = await resp.json();
    if (!data.success || data.noAccount || !data.account?.name) {
      return { ok: false, reason: 'no-account' };
    }
    cachedAccountName = data.account.name;
    const a = data.account;
    const priceUsd = await fetchHivePriceUsd();
    return {
      ok: true,
      name: a.name,
      pubkey,
      hive: a.hive ?? '0',
      priceUsd,
      hbd: a.hbd ?? '0',
      hp: a.hp ?? '0',
      hiveSavings: a.hiveSavings ?? '0',
      hbdSavings: a.hbdSavings ?? '0',
      pendingHive: a.pendingHive ?? '0',
      pendingHbd: a.pendingHbd ?? '0',
      pendingHp: a.pendingHp ?? '0',
      hpDelegatedOut: a.hpDelegatedOut ?? '0',
      hpDelegatedIn: a.hpDelegatedIn ?? '0',
      rcPercent: typeof a.rcPercent === 'number' ? a.rcPercent : 0,
      poweringDown: !!a.poweringDown,
      powerDownWeeklyHp: a.powerDownWeeklyHp ?? '0',
    };
  } catch (e: any) {
    return { ok: false, reason: e?.message || 'unavailable' };
  }
}

export async function getHiveAccountInfo(): Promise<HiveAccountInfo> {
  if (cachedInfo && Date.now() - cachedInfoAt < HIVE_INFO_TTL_MS) return cachedInfo;
  if (inflightInfo) return inflightInfo;
  inflightInfo = fetchHiveAccountInfo()
    .then(result => {
      // Cache successes; leave a failure uncached so the next call retries.
      if (result.ok) {
        cachedInfo = result;
        cachedInfoAt = Date.now();
      }
      return result;
    })
    .finally(() => {
      inflightInfo = null;
    });
  return inflightInfo;
}

/**
 * Non-blocking accessor for hot paths (GET_APP_PUBKEYS/BALANCES): returns the
 * last cached account info without awaiting the vault, and kicks off a refresh
 * when stale. First call before any warm-up returns null (Hive simply absent
 * that render); the async fetch fills it for the next.
 */
export function getCachedHiveInfo(): HiveAccountInfo | null {
  if (!cachedInfo || Date.now() - cachedInfoAt >= HIVE_INFO_TTL_MS) {
    getHiveAccountInfo().catch(() => {});
  }
  return cachedInfo;
}

export const HIVE_CAIP = 'hive:beeab0de/slip44:1275';
// HBD has no SLIP-44; use a stable token caip so it dedups distinctly from HIVE.
export const HBD_CAIP = 'hive:beeab0de/token:hbd';

/**
 * Synthetic pubkey/asset/balance rows for the read-only UI, built from a
 * resolved account. `address` is the Hive account name (the transfer target).
 * These enter the shared UI response paths (pubkeys, assets, balances,
 * pubkey-context) so every surface — list, receive, detail — agrees. They
 * never touch wallet.getPubkeys() (the fund-critical signing store).
 */
export function buildHiveUiRows(info: HiveAccountInfo | null) {
  if (!info || !info.ok) return null;
  const pubkey = {
    networks: [HIVE_NETWORK_ID],
    address: info.name,
    pubkey: info.pubkey,
    note: 'Hive account',
    symbol: 'HIVE',
  };
  const priceUsd = info.priceUsd ?? '0';
  const valueUsd = (parseFloat(info.hive || '0') * parseFloat(priceUsd)).toString();
  const asset = {
    networkId: HIVE_NETWORK_ID,
    caip: HIVE_CAIP,
    name: 'Hive',
    symbol: 'HIVE',
    priceUsd,
  };
  const balance = {
    networkId: HIVE_NETWORK_ID,
    caip: HIVE_CAIP,
    symbol: 'HIVE',
    balance: info.hive,
    isNative: true,
    priceUsd,
    valueUsd,
  };
  // HBD: receivable to the same account name, but Pioneer has no HBD price, so
  // show the quantity with USD marked unavailable (never fake the $1 peg).
  const hbdAsset = { networkId: HIVE_NETWORK_ID, caip: HBD_CAIP, name: 'Hive Backed Dollars', symbol: 'HBD' };
  const hbdBalance = {
    networkId: HIVE_NETWORK_ID,
    caip: HBD_CAIP,
    symbol: 'HBD',
    balance: info.hbd,
    isNative: false,
    priceUnavailable: true,
    valueUsd: '0',
  };
  // Display-only account breakdown for the asset-detail page.
  const holdings = {
    hp: info.hp,
    hbd: info.hbd,
    hiveSavings: info.hiveSavings,
    hbdSavings: info.hbdSavings,
    pendingHive: info.pendingHive,
    pendingHbd: info.pendingHbd,
    pendingHp: info.pendingHp,
    hpDelegatedOut: info.hpDelegatedOut,
    hpDelegatedIn: info.hpDelegatedIn,
    rcPercent: info.rcPercent,
    poweringDown: info.poweringDown,
    powerDownWeeklyHp: info.powerDownWeeklyHp,
  };
  return { pubkey, asset, balance, hbdAsset, hbdBalance, holdings };
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
      explorerTxLink: 'https://hivehub.dev/tx/',
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

// Firmware clear-sign op table — phase 1 + phase 2
// (handoff-hive-sign-operations-phase2.md). The vault serializer and the
// firmware both re-enforce this; the check here just fails fast with a
// clear dApp-facing error.
const SUPPORTED_OPS = new Set([
  'vote',
  'comment',
  'custom_json',
  'transfer_to_vesting',
  'withdraw_vesting',
  'convert',
  'comment_options',
  'transfer_to_savings',
  'transfer_from_savings',
  'claim_reward_balance',
  'delegate_vesting_shares',
  'account_update2',
]);

/** Strict "x.xxx" normalization — same no-parseFloat rule as hiveTransfer. */
function normalizeAmount3(amount: any, what: string): string {
  if (typeof amount !== 'string' || !/^\d+(\.\d{1,3})?$/.test(amount)) {
    throw createProviderRpcError(
      -32602,
      `Invalid ${what} "${amount}" — expected a decimal string with up to 3 decimals`,
    );
  }
  const [whole, frac = ''] = amount.split('.');
  const base = Number(whole) * 10 ** HIVE_DECIMALS + Number(frac.padEnd(HIVE_DECIMALS, '0'));
  if (!Number.isSafeInteger(base) || base <= 0) {
    throw createProviderRpcError(-32602, `Invalid ${what} "${amount}" — must be greater than zero`);
  }
  return (base / 10 ** HIVE_DECIMALS).toFixed(HIVE_DECIMALS);
}

/**
 * HP → VESTS via the vesting pool on Pioneer /hive/tx-params (Pioneer is the
 * RPC source of truth — no direct Hive-node calls, same policy as transfers).
 */
async function hpToVests(hp3: string): Promise<string> {
  const resp = await fetch(`${PIONEER_URL}/api/v1/hive/tx-params`, {
    signal: AbortSignal.timeout(20_000),
  }).then(r => r.json());
  if (!resp.success) throw createProviderRpcError(-32603, `Hive tx-params failed: ${resp.error || 'unknown'}`);
  const totalFund = parseFloat(resp.totalVestingFundHive);
  const totalShares = parseFloat(resp.totalVestingShares);
  if (!isFinite(totalFund) || !isFinite(totalShares) || totalFund <= 0 || totalShares <= 0) {
    throw createProviderRpcError(
      -32603,
      'Pioneer /hive/tx-params has no vesting pool — HP conversion needs an updated api.keepkey.info deploy',
    );
  }
  return ((parseFloat(hp3) * totalShares) / totalFund).toFixed(6);
}

// ponytail: epoch-seconds request id — unique enough for one-off
// conversions/withdrawals; per-account id tracking if a dApp ever collides.
const epochRequestId = () => Math.floor(Date.now() / 1000);

/** One-line device-preview summary per op for the side-panel approval. */
function opSummary(name: string, p: Record<string, any>): string {
  switch (name) {
    case 'vote':
      return `@${p.voter} → @${p.author}/${p.permlink} (${(Number(p.weight) / 100).toFixed(0)}%)`;
    case 'comment':
      return `@${p.author}: ${p.title || p.permlink}`;
    case 'custom_json':
      return `${p.id}: ${String(p.json).slice(0, 120)}`;
    case 'transfer_to_vesting':
      return `Power up ${p.amount} → @${p.to}`;
    case 'withdraw_vesting':
      return String(p.vesting_shares).startsWith('0.000000')
        ? `Stop power down (@${p.account})`
        : `Power down ${p.vesting_shares} from @${p.account}`;
    case 'convert':
      return `Convert ${p.amount} → HIVE (request ${p.requestid})`;
    case 'comment_options':
      return `Payout options for @${p.author}/${p.permlink}${
        (p.extensions?.[0]?.[1]?.beneficiaries ?? [])
          .map((b: any) => ` · ${(Number(b.weight) / 100).toFixed(1)}% → @${b.account}`)
          .join('') || ''
      }`;
    case 'transfer_to_savings':
      return `Savings deposit ${p.amount} → @${p.to}`;
    case 'transfer_from_savings':
      return `Savings withdraw ${p.amount} → @${p.to}`;
    case 'claim_reward_balance':
      return `Claim ${p.reward_hive}, ${p.reward_hbd}, ${p.reward_vests}`;
    case 'delegate_vesting_shares':
      return String(p.vesting_shares).startsWith('0.000000')
        ? `Remove delegation from @${p.delegatee}`
        : `Delegate ${p.vesting_shares} → @${p.delegatee}`;
    case 'account_update2':
      return `Update profile @${p.account}`;
    default:
      return name;
  }
}

/**
 * Shared path for vote/post/custom_json/broadcast: validate ops against the
 * firmware's phase-1 clear-sign table, approve, sign via the vault
 * (device parses + displays the Graphene bytes), broadcast via Pioneer
 * /hive/broadcast-ops. Returns Keychain's { id, tx_id, confirmed } shape.
 */
async function hiveSignAndBroadcastOps(
  displayType: string,
  operations: [string, Record<string, any>][],
  username: string | undefined,
  params: any[],
  requestInfo: any,
  requireApproval: (networkId: string, requestInfo: any, chain: any, method: string, params: any) => Promise<any>,
) {
  for (const op of operations) {
    if (!Array.isArray(op) || op.length !== 2 || !SUPPORTED_OPS.has(op[0])) {
      throw createProviderRpcError(
        4200,
        `Operation not in the KeepKey clear-sign table (got ${Array.isArray(op) ? op[0] : typeof op})`,
      );
    }
  }

  await requireHiveFirmware('Hive operations');
  const from = await getHiveAccount();
  if (username && username !== from.name) {
    throw createProviderRpcError(4100, `This KeepKey controls @${from.name}, not @${username}`);
  }

  const event = buildEvent(requestInfo, displayType, params);
  (event as any).unsignedTx = {
    from: from.name,
    operations: operations.map(([name, p]) => ({ op: name, summary: opSummary(name, p) })),
  };
  await requestUserApproval(event, requestInfo, displayType, params, requireApproval);

  // Sign — the vault serializes, the device parses + clear-signs
  let signResp: Response;
  try {
    signResp = await fetch(`${VAULT_URL}/hive/sign-operations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getApiKey()}` },
      body: JSON.stringify({ operations }),
      signal: AbortSignal.timeout(300_000),
    });
  } catch (e: any) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') throw createTimeoutError('Vault signing timed out');
    throw createProviderRpcError(-32603, `Vault connection failed: ${e.message}`);
  }
  if (!signResp.ok) {
    const text = await signResp.text().catch(() => '');
    throw createProviderRpcError(-32603, `Vault Hive sign-operations failed (${signResp.status}): ${text}`);
  }
  const signed = await signResp.json();
  if (!signed.signature) throw createProviderRpcError(-32603, 'Vault returned no Hive signature');

  // Broadcast the EXACT tx the device signed (header echoed by the vault)
  const bResp = await fetch(`${PIONEER_URL}/api/v1/hive/broadcast-ops`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ref_block_num: signed.ref_block_num,
      ref_block_prefix: signed.ref_block_prefix,
      expiration: signed.expiration,
      operations: signed.operations,
      signature: signed.signature.replace(/^0x/, ''),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const bData = await bResp.json().catch(() => ({}));
  if (!bData.success || !bData.txid) {
    throw createProviderRpcError(
      -32603,
      `Hive broadcast failed: ${bData.error || `HTTP ${bResp.status} — is /hive/broadcast-ops deployed?`}`,
    );
  }

  await requestStorage.updateEventById(event.id, { ...event, txid: bData.txid, status: 'broadcasted' } as any);
  chrome.runtime
    .sendMessage({
      action: 'transaction_complete',
      eventId: requestInfo.id,
      txHash: bData.txid,
      explorerTxLink: 'https://hivehub.dev/tx/',
      networkId: HIVE_NETWORK_ID,
    })
    .catch(() => {});

  return { id: bData.txid, tx_id: bData.txid, confirmed: Boolean(bData.blockNum ?? bData.block_num) };
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
    case 'transfer': {
      // Generic side-panel Send (Transfer.tsx) — adapt its payload shape
      // ({ recipient, amount: { amount, denom }, memo }) to the Keychain-shaped
      // hiveTransfer ({ to, amount, currency, memo }). Same build/sign/broadcast
      // path as the dApp hive_transfer; the sender account is derived on-device.
      const p = params?.[0] || {};
      return await hiveTransfer(
        [{ to: p.recipient, amount: p.amount?.amount, memo: p.memo, currency: p.amount?.denom || 'HIVE' }],
        requestInfo,
        requireApproval,
      );
    }
    case 'hive_signBuffer': {
      return await hiveSignBuffer(params, requestInfo, requireApproval);
    }
    case 'hive_vote': {
      const { username, permlink, author, weight } = params[0] || {};
      const from = await getHiveAccount();
      const voter = username || from.name;
      return await hiveSignAndBroadcastOps(
        'vote',
        [['vote', { voter, author, permlink, weight: Number(weight) }]],
        username,
        params,
        requestInfo,
        requireApproval,
      );
    }
    case 'hive_post': {
      const p = params[0] || {};
      const from = await getHiveAccount();
      const author = p.username || from.name;
      const permlink = p.permlink || `keepkey-${Date.now().toString(36)}`;
      const ops: [string, Record<string, any>][] = [
        [
          'comment',
          {
            parent_author: p.parent_username || '',
            parent_permlink: p.parent_perm,
            author,
            permlink,
            title: p.title || '',
            body: p.body,
            json_metadata:
              typeof p.json_metadata === 'string' ? p.json_metadata : JSON.stringify(p.json_metadata ?? {}),
          },
        ],
      ];
      if (p.comment_options) {
        // Keychain sends comment_options as a JSON string or object. Author +
        // permlink are forced to the comment's — the vault serializer rejects
        // any mismatch (beneficiary-redirect protection).
        let opts: any;
        try {
          opts = typeof p.comment_options === 'string' ? JSON.parse(p.comment_options) : p.comment_options;
        } catch {
          throw createProviderRpcError(-32602, 'comment_options is not valid JSON');
        }
        ops.push([
          'comment_options',
          {
            author,
            permlink,
            max_accepted_payout: opts.max_accepted_payout ?? '1000000.000 HBD',
            percent_hbd: opts.percent_hbd ?? opts.percent_steem_dollars ?? 10000,
            allow_votes: opts.allow_votes ?? true,
            allow_curation_rewards: opts.allow_curation_rewards ?? true,
            extensions: opts.extensions ?? [],
          },
        ]);
      }
      return await hiveSignAndBroadcastOps('post', ops, p.username, params, requestInfo, requireApproval);
    }
    case 'hive_customJson': {
      const p = params[0] || {};
      const from = await getHiveAccount();
      const account = p.username || from.name;
      const active = String(p.method || 'Posting').toLowerCase() === 'active';
      const op: [string, Record<string, any>] = [
        'custom_json',
        {
          required_auths: active ? [account] : [],
          required_posting_auths: active ? [] : [account],
          id: p.id,
          json: typeof p.json === 'string' ? p.json : JSON.stringify(p.json ?? {}),
        },
      ];
      return await hiveSignAndBroadcastOps('custom_json', [op], p.username, params, requestInfo, requireApproval);
    }
    case 'hive_broadcast': {
      const p = params[0] || {};
      if (!Array.isArray(p.operations) || p.operations.length === 0) {
        throw createProviderRpcError(-32602, 'requestBroadcast requires an operations array');
      }
      return await hiveSignAndBroadcastOps('broadcast', p.operations, p.username, params, requestInfo, requireApproval);
    }
    case 'hive_sendToken': {
      // Hive Engine token transfer = custom_json on ssc-mainnet-hive (active key)
      const p = params[0] || {};
      if (!p.to || !p.amount || !p.currency) {
        throw createProviderRpcError(-32602, 'sendToken requires { to, amount, currency }');
      }
      if (typeof p.amount !== 'string' || !/^\d+(\.\d+)?$/.test(p.amount)) {
        throw createProviderRpcError(-32602, `Invalid token amount "${p.amount}"`);
      }
      const from = await getHiveAccount();
      const account = p.username || from.name;
      const op: [string, Record<string, any>] = [
        'custom_json',
        {
          required_auths: [account],
          required_posting_auths: [],
          id: 'ssc-mainnet-hive',
          json: JSON.stringify({
            contractName: 'tokens',
            contractAction: 'transfer',
            contractPayload: { symbol: p.currency, to: p.to, quantity: p.amount, memo: p.memo || '' },
          }),
        },
      ];
      return await hiveSignAndBroadcastOps('sendToken', [op], p.username, params, requestInfo, requireApproval);
    }
    case 'hive_powerUp': {
      const p = params[0] || {};
      const from = await getHiveAccount();
      const account = p.username || from.name;
      const amount = normalizeAmount3(p.hive, 'power-up amount');
      const op: [string, Record<string, any>] = [
        'transfer_to_vesting',
        { from: account, to: p.recipient || account, amount: `${amount} HIVE` },
      ];
      return await hiveSignAndBroadcastOps('powerUp', [op], p.username, params, requestInfo, requireApproval);
    }
    case 'hive_powerDown': {
      const p = params[0] || {};
      const from = await getHiveAccount();
      const account = p.username || from.name;
      // Keychain contract: hive_power is HP; '0.000' stops an active power-down
      const stop = typeof p.hive_power === 'string' && /^0+(\.0{1,3})?$/.test(p.hive_power);
      const vests = stop ? '0.000000' : await hpToVests(normalizeAmount3(p.hive_power, 'power-down amount'));
      const op: [string, Record<string, any>] = ['withdraw_vesting', { account, vesting_shares: `${vests} VESTS` }];
      return await hiveSignAndBroadcastOps('powerDown', [op], p.username, params, requestInfo, requireApproval);
    }
    case 'hive_delegation': {
      const p = params[0] || {};
      if (!p.delegatee) throw createProviderRpcError(-32602, 'delegation requires a delegatee');
      const from = await getHiveAccount();
      const account = p.username || from.name;
      let vests: string;
      if (p.unit === 'VESTS') {
        if (typeof p.amount !== 'string' || !/^\d+\.\d{6}$/.test(p.amount)) {
          throw createProviderRpcError(-32602, `Invalid VESTS amount "${p.amount}" — requires exactly 6 decimals`);
        }
        vests = p.amount;
      } else if (p.unit === 'HP') {
        // '0.000' HP removes the delegation — skip the pool conversion
        vests = /^0+(\.0{1,3})?$/.test(String(p.amount))
          ? '0.000000'
          : await hpToVests(normalizeAmount3(p.amount, 'delegation amount'));
      } else {
        throw createProviderRpcError(-32602, `delegation unit must be HP or VESTS (got ${p.unit})`);
      }
      const op: [string, Record<string, any>] = [
        'delegate_vesting_shares',
        { delegator: account, delegatee: p.delegatee, vesting_shares: `${vests} VESTS` },
      ];
      return await hiveSignAndBroadcastOps('delegation', [op], p.username, params, requestInfo, requireApproval);
    }
    case 'hive_savings': {
      const p = params[0] || {};
      if (!['HIVE', 'HBD'].includes(p.currency)) {
        throw createProviderRpcError(-32602, `savings currency must be HIVE or HBD (got ${p.currency})`);
      }
      if (!['deposit', 'withdraw'].includes(p.operation)) {
        throw createProviderRpcError(-32602, `savings operation must be deposit or withdraw (got ${p.operation})`);
      }
      if (typeof p.memo === 'string' && p.memo.startsWith('#')) {
        throw createProviderRpcError(
          4200,
          'Encrypted memos (starting with "#") are not supported — the memo would be broadcast as public plaintext',
        );
      }
      const from = await getHiveAccount();
      const account = p.username || from.name;
      const to = p.to || account;
      const amount = `${normalizeAmount3(p.amount, 'savings amount')} ${p.currency}`;
      const op: [string, Record<string, any>] =
        p.operation === 'deposit'
          ? ['transfer_to_savings', { from: account, to, amount, memo: p.memo || '' }]
          : ['transfer_from_savings', { from: account, request_id: epochRequestId(), to, amount, memo: p.memo || '' }];
      return await hiveSignAndBroadcastOps('savings', [op], p.username, params, requestInfo, requireApproval);
    }
    case 'hive_conversion': {
      const p = params[0] || {};
      // collaterized=true is HIVE→HBD via collateralized_convert (op 48) —
      // not in the device clear-sign table.
      if (p.collaterized) {
        throw createProviderRpcError(4200, 'HIVE → HBD (collateralized) conversion is not supported yet');
      }
      const from = await getHiveAccount();
      const account = p.username || from.name;
      const op: [string, Record<string, any>] = [
        'convert',
        {
          owner: account,
          requestid: epochRequestId(),
          amount: `${normalizeAmount3(p.amount, 'conversion amount')} HBD`,
        },
      ];
      return await hiveSignAndBroadcastOps('conversion', [op], p.username, params, requestInfo, requireApproval);
    }
    default:
      throw createProviderRpcError(4200, `Hive method ${method} not supported`);
  }
};
