import { requestStorage, assetContextStorage } from '@extension/storage';
import { v4 as uuidv4 } from 'uuid';
import * as wallet from '../wallet';
import { createProviderRpcError } from '../utils';

const TAG = ' | tronHandler | ';

const VAULT_URL = 'http://localhost:1646';

// TronGrid is the canonical public JSON-RPC for Tron mainnet. The vault's
// own txbuilder (projects/keepkey-vault-v11/.../txbuilder/index.ts) uses
// the same `createtransaction` endpoint, so we stay on-path with the
// firmware-signing flow.
const TRONGRID_URL = 'https://api.trongrid.io';

// m/44'/195'/0'/0/0 — standard Tron account 0
const TRON_ADDRESS_N = [0x80000000 + 44, 0x80000000 + 195, 0x80000000 + 0, 0, 0];

const TRON_NETWORK_ID = 'tron:27Lqcw';
const TRON_CAIP = 'tron:27Lqcw/slip44:195';
const TRON_PUBKEY_NOTE = 'Tron account 0';

// Cached address from device — populated lazily on first call.
let cachedAddress: string | null = null;

/** Reset cached state (called when the device disconnects or wallet re-inits). */
export function resetTronState() {
  cachedAddress = null;
}

/**
 * Prefetch the Tron address at startup so it shows up in the network
 * dropdown without waiting for a user-initiated Tron action. Non-throwing —
 * silently skips when no device and no cached address.
 */
export async function prefetchTronPubkey(): Promise<void> {
  try {
    await getTronAddress();
  } catch (e: any) {
    console.log(TAG, 'Tron prefetch skipped:', e?.message || e);
  }
}

async function getTronAddress(): Promise<string> {
  if (cachedAddress) return cachedAddress;

  // Persisted pubkey cache — works in watch-only mode.
  const walletAddress = wallet.getAddressForNetwork(TRON_NETWORK_ID);
  if (walletAddress) {
    cachedAddress = walletAddress;
    return walletAddress;
  }

  if (!wallet.isDeviceConnected()) {
    const reachable = await wallet.probeDevice();
    if (!reachable) {
      throw createProviderRpcError(
        -32603,
        'KeepKey device not connected and no cached Tron address. Plug in your device to derive one.',
      );
    }
  }

  const sdk = wallet.getSdk();
  const result = await sdk.address.tronGetAddress({ address_n: TRON_ADDRESS_N });
  const address = result?.address || (result as any);
  if (!address || typeof address !== 'string') {
    throw createProviderRpcError(-32603, 'Vault returned invalid Tron address');
  }

  cachedAddress = address;

  try {
    await wallet.addPubkey({
      note: TRON_PUBKEY_NOTE,
      networks: [TRON_NETWORK_ID],
      type: 'address',
      address,
      pubkey: address,
      addressNList: TRON_ADDRESS_N,
      addressNListMaster: TRON_ADDRESS_N,
      curve: 'secp256k1',
      script_type: 'tron',
      accountIndex: 0,
    });
  } catch (e) {
    console.warn(TAG, 'Failed to cache Tron address:', e);
  }

  return address;
}

/** Build event object for the side-panel approval flow. */
function buildEvent(requestInfo: any, method: string, params: any[], unsignedTx?: any) {
  if (!requestInfo.id) requestInfo.id = uuidv4();
  return {
    id: requestInfo.id,
    networkId: TRON_NETWORK_ID,
    chain: 'tron',
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
    unsignedTx,
    type: method,
    request: params,
    status: 'request',
    timestamp: new Date().toISOString(),
  };
}

/** Bearer key for authenticated vault calls. */
function getApiKey(): string {
  const sdk = wallet.getSdk();
  const key = sdk.getClient?.()?.getApiKey?.();
  if (!key) {
    throw createProviderRpcError(-32603, 'API key not available — vault may not be connected');
  }
  return key;
}

/**
 * TRON amounts are quoted in sun: 1 TRX = 1,000,000 sun. Float multiplication
 * drifts at 6 decimals, so route through integer strings to avoid a dust
 * rounding loss on any amount the user actually types.
 */
function trxToSun(trxAmount: string): number {
  const [whole, frac = ''] = String(trxAmount).split('.');
  const fracPadded = (frac + '000000').slice(0, 6);
  const sunStr = `${whole}${fracPadded}`.replace(/^0+/, '') || '0';
  const sun = Number(sunStr);
  if (!Number.isFinite(sun)) {
    throw createProviderRpcError(4000, `Invalid TRX amount: ${trxAmount}`);
  }
  return sun;
}

/** Ask TronGrid to build the raw protobuf transaction (raw_data_hex). */
async function buildTronTransfer(from: string, to: string, sunAmount: number): Promise<any> {
  let resp: Response;
  try {
    resp = await fetch(`${TRONGRID_URL}/wallet/createtransaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        owner_address: from,
        to_address: to,
        amount: sunAmount,
        visible: true, // Pass base58 addresses (not hex) — simpler for the UI layer.
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e: any) {
    throw createProviderRpcError(-32603, `TronGrid createtransaction failed: ${e.message}`);
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw createProviderRpcError(-32603, `TronGrid build failed (${resp.status}): ${text}`);
  }
  const tx: any = await resp.json();
  if (tx?.Error) {
    // TronGrid returns `{Error: "no OwnerAccount"}` for unactivated accounts —
    // surface that as a readable message instead of the raw API string.
    if (String(tx.Error).includes('no OwnerAccount')) {
      throw createProviderRpcError(
        -32603,
        `Account ${from} is not activated on Tron. Send TRX to this address first to activate it.`,
      );
    }
    throw createProviderRpcError(-32603, `TronGrid build error: ${tx.Error}`);
  }
  if (!tx?.raw_data_hex) {
    throw createProviderRpcError(-32603, 'TronGrid did not return raw_data_hex');
  }
  return tx;
}

/**
 * Base58 → 21-byte hex for Tron. Prefixed with 0x41; ABI encoding
 * for a Solidity `address` drops the 0x41 and left-pads the remaining
 * 20 bytes into a 32-byte slot.
 *
 * Inline minimal decoder to avoid a bs58 dep in the background bundle.
 * Matches the injected-side decoder in tron-provider.ts so the two
 * sides encode/decode consistently.
 */
const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58DecodeToHex(addr: string): string {
  const bytes: number[] = [0];
  for (const char of addr) {
    const idx = B58_ALPHABET.indexOf(char);
    if (idx === -1) throw createProviderRpcError(4000, `Invalid base58 character in address: ${addr}`);
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
  for (const char of addr) {
    if (char !== '1') break;
    bytes.push(0);
  }
  const full = bytes.reverse();
  // Drop the 4-byte checksum; keep 0x41 + 20-byte hash
  const payload = full.slice(0, 21);
  if (payload.length !== 21 || payload[0] !== 0x41) {
    throw createProviderRpcError(4000, `Invalid Tron address: ${addr}`);
  }
  return payload.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Convert a human-readable token amount ("1.5") to integer base units
 * using the token's decimals. Float math drifts at high decimals, so
 * we route through a padded-string conversion, matching trxToSun's
 * approach for the native 6-decimal case.
 */
function toBaseUnits(amount: string, decimals: number): bigint {
  const [whole, frac = ''] = String(amount).split('.');
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  const joined = `${whole}${fracPadded}`.replace(/^0+/, '') || '0';
  try {
    return BigInt(joined);
  } catch {
    throw createProviderRpcError(4000, `Invalid token amount: ${amount}`);
  }
}

/**
 * ABI-encode the parameters for TRC-20 `transfer(address,uint256)`.
 * Returns 128 hex chars: 64 for the address (20 bytes left-padded to
 * 32), 64 for the amount (uint256 big-endian).
 */
function encodeTrc20TransferParam(recipientBase58: string, amount: bigint): string {
  const hex21 = base58DecodeToHex(recipientBase58); // "41xxxx...20bytes"
  const hex20 = hex21.slice(2); // strip the 0x41 prefix for ABI encoding
  const addrPadded = hex20.padStart(64, '0');
  const amountPadded = amount.toString(16).padStart(64, '0');
  return addrPadded + amountPadded;
}

/**
 * Extract the TRC-20 contract address from an asset caip.
 * Accepts both `tron:27Lqcw/token:T...` (our canonical) and
 * `tron:0x2b6653dc/token:T...` (Pioneer's alternate) forms.
 * Returns null for native-TRX caips.
 */
function parseTrc20Caip(caip: string): string | null {
  const m = String(caip || '').match(/^tron:[^/]+\/(?:token|trc20):(T[1-9A-HJ-NP-Za-km-z]{33})$/);
  return m ? m[1] : null;
}

/**
 * Ask TronGrid to build the unsigned TriggerSmartContract tx for a
 * TRC-20 `transfer(address,uint256)`. Same response shape as
 * /createtransaction so signing + broadcast reuse the native path.
 */
async function buildTrc20Transfer(
  from: string,
  contractAddress: string,
  recipient: string,
  amountBaseUnits: bigint,
): Promise<any> {
  let resp: Response;
  try {
    resp = await fetch(`${TRONGRID_URL}/wallet/triggersmartcontract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        owner_address: from,
        contract_address: contractAddress,
        function_selector: 'transfer(address,uint256)',
        parameter: encodeTrc20TransferParam(recipient, amountBaseUnits),
        // 100 TRX fee limit — matches the ballpark TronLink uses for
        // USDT transfers. Too low and the tx revert-burns energy
        // without moving tokens.
        fee_limit: 100_000_000,
        call_value: 0,
        visible: true,
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e: any) {
    throw createProviderRpcError(-32603, `TronGrid triggersmartcontract failed: ${e.message}`);
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw createProviderRpcError(-32603, `TronGrid TRC-20 build failed (${resp.status}): ${text}`);
  }
  const body: any = await resp.json();
  if (body?.result?.result !== true) {
    const msg = body?.result?.message
      ? Buffer.from(String(body.result.message), 'hex').toString('utf8').trim()
      : JSON.stringify(body?.result || body);
    throw createProviderRpcError(-32603, `TronGrid TRC-20 build rejected: ${msg}`);
  }
  const tx = body?.transaction;
  if (!tx?.raw_data_hex) {
    throw createProviderRpcError(-32603, 'TronGrid did not return raw_data_hex for TRC-20 build');
  }
  return tx;
}

/**
 * Sign the raw tx via the vault. Returns the 65-byte signature as a hex string.
 * The vault's handler emulates emuWrap for the device, so this call may block
 * until the user confirms on the KeepKey.
 */
async function signTronViaRest(
  rawDataHex: string,
  toAddress: string,
  amountRaw: string | number | bigint,
): Promise<string> {
  const apiKey = getApiKey();
  let resp: Response;
  try {
    resp = await fetch(`${VAULT_URL}/tron/sign-transaction`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        addressNList: TRON_ADDRESS_N,
        raw_tx: rawDataHex,
        to_address: toAddress,
        // Stringify without going through Number — 18-decimal TRC-20
        // amounts exceed Number.MAX_SAFE_INTEGER in base units and
        // would silently round before hitting the vault. Handle bigint
        // explicitly since String(bigint) works but the intent is
        // clearer and future-proofed.
        amount: typeof amountRaw === 'bigint' ? amountRaw.toString() : String(amountRaw),
      }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (e: any) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw createProviderRpcError(-32603, 'Vault Tron signing timed out');
    }
    throw createProviderRpcError(-32603, `Vault connection failed: ${e.message}`);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw createProviderRpcError(-32603, `Vault Tron sign failed (${resp.status}): ${text}`);
  }

  const result = await resp.json();
  const signature = result?.signature;
  if (!signature || typeof signature !== 'string') {
    throw createProviderRpcError(-32603, 'Vault returned no Tron signature');
  }
  return signature;
}

/**
 * Convert a Tron hex address (e.g. `41xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`)
 * to its base58 form (T...). Uses SHA-256 double-hash for the checksum,
 * via WebCrypto (available in service workers).
 *
 * Only used from the tron_sign path when the tx was built without
 * `visible: true` and comes through with hex addresses — we normalise to
 * base58 for the approval UI and vault signing hint.
 */
async function hexAddressToBase58(hexAddr: string): Promise<string> {
  const hex = hexAddr.toLowerCase().replace(/^0x/, '');
  if (hex.length !== 42 || !hex.startsWith('41')) {
    throw new Error(`Invalid Tron hex address: ${hexAddr}`);
  }
  const payload = Uint8Array.from(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  const h1 = new Uint8Array(await crypto.subtle.digest('SHA-256', payload));
  const h2 = new Uint8Array(await crypto.subtle.digest('SHA-256', h1));
  const checksum = h2.slice(0, 4);
  const full = new Uint8Array(payload.length + 4);
  full.set(payload, 0);
  full.set(checksum, payload.length);

  const ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const digits: number[] = [0];
  for (const byte of full) {
    let carry = byte;
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
  // Leading zero bytes → leading '1's.
  let out = '';
  for (const b of full) {
    if (b !== 0) break;
    out += '1';
  }
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHA[digits[i]];
  return out;
}

interface DecodedTronTx {
  kind: 'trx-transfer' | 'trc20-transfer' | 'contract-call';
  ownerAddress: string; // base58
  toAddress: string; // base58 — recipient for transfers, contract address for generic calls
  // Raw base-units as a DECIMAL STRING so 18-decimal TRC-20 amounts
  // survive the trip to the vault. Going through Number would truncate
  // at ~2^53 base units (9e15 — fine for 6-decimal TRX/USDT, broken
  // for 18-decimal tokens).
  amountRaw: string;
  displayAmount: string; // human-readable
  contractAddress?: string; // base58, non-native
  functionSelector?: string; // hex, contract-call only
}

/**
 * Decode the first contract from a tronweb-built transaction into the
 * fields we need for approval UX and the vault signing hint.
 *
 * Supports:
 *   - TransferContract (native TRX)
 *   - TriggerSmartContract with `transfer(address,uint256)` (TRC20)
 *
 * Throws on any other contract type so dApps fail fast with a clear
 * message instead of the device rejecting an un-parseable tx.
 */
async function decodeTronTx(tx: any): Promise<DecodedTronTx> {
  const contract = tx?.raw_data?.contract?.[0];
  if (!contract) throw createProviderRpcError(4000, 'Transaction has no contract');

  const value = contract.parameter?.value;
  if (!value) throw createProviderRpcError(4000, 'Contract has no parameter value');

  const visible = tx.visible === true;
  const normalizeAddr = async (addr: string): Promise<string> => {
    if (!addr) throw createProviderRpcError(4000, 'Missing address');
    if (addr.startsWith('T') && addr.length === 34) return addr;
    if (visible) return addr;
    return hexAddressToBase58(addr);
  };

  if (contract.type === 'TransferContract') {
    const v = value as { amount: number; owner_address: string; to_address: string };
    return {
      kind: 'trx-transfer',
      ownerAddress: await normalizeAddr(v.owner_address),
      toAddress: await normalizeAddr(v.to_address),
      amountRaw: String(v.amount),
      displayAmount: String(v.amount / 1_000_000),
    };
  }

  if (contract.type === 'TriggerSmartContract') {
    const v = value as { contract_address: string; owner_address: string; data: string; call_value?: number };
    const data = String(v.data || '')
      .toLowerCase()
      .replace(/^0x/, '');
    const selector = data.slice(0, 8);
    const contractAddress = await normalizeAddr(v.contract_address);
    const ownerAddress = await normalizeAddr(v.owner_address);

    // transfer(address,uint256) — the canonical TRC20 transfer path.
    // Decode to show the real recipient + token amount in the approval
    // UI; this is by far the most common smart-contract call on Tron.
    if (selector === 'a9059cbb' && data.length >= 8 + 64 * 2) {
      const recipientHex = data.slice(8 + 24, 8 + 64);
      const amountHex = data.slice(8 + 64, 8 + 64 * 2);
      const amount = BigInt('0x' + amountHex);
      // Tron hex addresses are prefixed with 0x41. ABI `address` pads to
      // 20 bytes (no prefix), so re-prepend before base58-encoding.
      const recipientBase58 = await hexAddressToBase58('41' + recipientHex);
      return {
        kind: 'trc20-transfer',
        ownerAddress,
        toAddress: recipientBase58,
        amountRaw: amount.toString(),
        displayAmount: amount.toString(),
        contractAddress,
      };
    }

    // Generic contract call (swaps, stake, approve, etc.). The firmware
    // parses the raw_data itself and signs based on what it finds; our
    // hints here are purely for the side-panel approval UI. Route
    // `call_value` (TRX attached to the call) to amountRaw so swaps
    // that spend native TRX display the right outgoing amount.
    const callValue = typeof v.call_value === 'number' ? v.call_value : 0;
    return {
      kind: 'contract-call',
      ownerAddress,
      toAddress: contractAddress,
      amountRaw: String(callValue),
      displayAmount: String(callValue / 1_000_000),
      contractAddress,
      functionSelector: selector,
    };
  }

  throw createProviderRpcError(4200, `Tron contract type "${contract.type}" is not supported by KeepKey yet.`);
}

/** Broadcast a signed Tron tx via TronGrid. Returns the txid. */
async function broadcastTron(signedTx: any): Promise<string> {
  let resp: Response;
  try {
    resp = await fetch(`${TRONGRID_URL}/wallet/broadcasttransaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signedTx),
      signal: AbortSignal.timeout(30000),
    });
  } catch (e: any) {
    throw createProviderRpcError(-32603, `TronGrid broadcast failed: ${e.message}`);
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw createProviderRpcError(-32603, `TronGrid broadcast failed (${resp.status}): ${text}`);
  }
  const result = await resp.json();
  if (result?.code && result.code !== 'SUCCESS' && !result?.result) {
    const msg = result.message
      ? Buffer.from(String(result.message), 'hex').toString('utf8').trim()
      : JSON.stringify(result);
    throw createProviderRpcError(-32603, `Tron broadcast rejected: ${msg}`);
  }
  const txid = result?.txid || signedTx?.txID;
  if (!txid) throw createProviderRpcError(-32603, 'Tron broadcast returned no txid');
  return String(txid);
}

export const handleTronRequest = async (
  method: string,
  params: any[],
  requestInfo: any,
  _ADDRESS: string,
  _KEEPKEY_WALLET: any,
  requireApproval: (networkId: string, requestInfo: any, chain: any, method: string, params: any) => Promise<any>,
): Promise<any> => {
  const tag = TAG + ' | handleTronRequest | ';
  console.log(tag, 'method:', method);

  switch (method) {
    case 'request_accounts':
    case 'tron_requestAccounts':
    case 'tron_connect':
    case 'tron_getAccount': {
      return await getTronAddress();
    }

    case 'request_pubkeys': {
      return wallet.getPubkeys(TRON_NETWORK_ID);
    }

    // dApp flow (window.tronWeb.trx.sign). Payload: params[0] is a full
    // transaction built by tronweb — { txID, raw_data, raw_data_hex, ... }.
    // We parse the first contract to extract display hints (to_address,
    // amount) the vault / firmware need, run the approval loop, then
    // return the signed tx for the dApp to broadcast itself.
    case 'tron_sign':
    case 'signTransaction': {
      const tx = params?.[0];
      if (!tx || typeof tx !== 'object' || !tx.raw_data_hex) {
        throw createProviderRpcError(4000, 'tron_sign expects a built transaction with raw_data_hex');
      }

      const decoded = await decodeTronTx(tx);
      const sender = await getTronAddress();

      if (decoded.ownerAddress && decoded.ownerAddress !== sender) {
        // dApps occasionally hard-code an owner address from a cached
        // session; surface the mismatch so the dApp can recover rather
        // than letting the device reject it silently.
        throw createProviderRpcError(
          4001,
          `Transaction owner (${decoded.ownerAddress}) does not match connected KeepKey address (${sender}).`,
        );
      }

      if (!requestInfo.id) requestInfo.id = uuidv4();
      // Always emit type='transfer'. The shared "other" approval
      // renderer (pages/side-panel/src/approval/other/*) only has a
      // cased handler for 'transfer' + reads `unsignedTx.payment.*` —
      // anything else shows "Unknown Method" / N/A. Downstream code
      // that cares about kind can still branch on `contractAddress` /
      // `functionSelector` on the event.
      //
      // decimals: native TRX is 6 (sun); TRC-20 transfer()s use the
      // displayAmount's decimals which we don't know from raw_data
      // alone — default to 0 so the UI shows raw base units, which is
      // at least correct, not misleading. Contract-call rows attach
      // call_value (TRX, 6 decimals). Callers that want prettier
      // token display should teach decodeTronTx to look up decimals
      // from assetData or an on-chain call — not a fix for this PR.
      const decimals = decoded.kind === 'trc20-transfer' ? 0 : 6;
      // For TRC-20 events, scope the caip to the specific token
      // contract so the UI's ctx.caip-match gate only fires when the
      // side-panel had THIS token selected. Otherwise a dApp USDT
      // transfer with the user on the TRX asset page would match
      // (both sides = tron:27Lqcw/slip44:195) and render with the TRX
      // symbol/icon — the exact leak #48's gate was meant to block.
      //
      // Native TRX and generic contract-call stay on TRON_CAIP:
      // trx-transfer is native TRX so matching the TRX context is
      // correct; contract-call renders its own Contract/Function UI
      // with a hardcoded 'TRX' fallback on the call_value row, so a
      // partial caip-match can't leak the wrong symbol into anything
      // user-facing.
      const eventCaip =
        decoded.kind === 'trc20-transfer' && decoded.contractAddress
          ? `${TRON_NETWORK_ID}/token:${decoded.contractAddress}`
          : TRON_CAIP;
      const event = buildEvent(requestInfo, 'transfer', params, {
        caip: eventCaip,
        from: sender,
        to: decoded.toAddress,
        amount: decoded.displayAmount,
        // String, not number — preserves precision for 18-decimal TRC-20.
        amountRaw: decoded.amountRaw,
        decimals,
        kind: decoded.kind, // 'trx-transfer' | 'trc20-transfer' | 'contract-call' for downstream branches
        contractAddress: decoded.contractAddress,
        functionSelector: decoded.functionSelector,
        tronGridTx: tx,
        rawDataHex: tx.raw_data_hex,
        // Shape the "other" approval UI reads. `amount` stays as a raw
        // base-units decimal string — formatAmount in the UI does the
        // BigInt-safe division by `decimals`.
        //
        // symbol:
        //   trx-transfer / contract-call → 'TRX' (call_value on a
        //     contract call is always native TRX; stating it
        //     explicitly in the handler lets the UI render the amount
        //     row without falling through to asset-context guesswork)
        //   trc20-transfer               → undefined (we don't know
        //     the token's symbol without an on-chain `symbol()` call
        //     or an assetData lookup — both are out of scope here;
        //     the UI's caip-match gate on asset context will decline
        //     to show a wrong symbol)
        payment: {
          destination: decoded.toAddress,
          amount: decoded.amountRaw,
          decimals,
          symbol: decoded.kind === 'trc20-transfer' ? undefined : 'TRX',
        },
      });
      // @ts-expect-error addEvent is untyped on the storage wrapper
      const saved = await requestStorage.addEvent(event);
      if (!saved) throw createProviderRpcError(-32603, 'Failed to create approval event');
      chrome.runtime.sendMessage({ action: 'TRANSACTION_CONTEXT_UPDATED', id: event.id }).catch(() => {});

      const approval = await requireApproval(TRON_NETWORK_ID, requestInfo, 'tron', method, params);
      if (!approval?.success) {
        throw createProviderRpcError(4001, 'User denied transaction');
      }

      const signatureHex = await signTronViaRest(tx.raw_data_hex, decoded.toAddress, decoded.amountRaw);

      // Preserve any existing `signature` array from the dApp (multi-sig
      // case) and append ours; most dApps pass in an unsigned tx so this
      // ends up [ours].
      const existing: string[] = Array.isArray(tx.signature) ? tx.signature : [];
      const signedTx = { ...tx, signature: [...existing, signatureHex] };

      // Persist signedTx on the event for debugging/history. Broadcast is
      // the dApp's job — they'll call tronWeb.trx.sendRawTransaction next.
      try {
        const stored = await requestStorage.getEventById(requestInfo.id);
        if (stored) {
          stored.signedTx = signedTx;
          stored.status = 'completed';
          await requestStorage.updateEventById(requestInfo.id, stored);
        }
      } catch (e) {
        console.warn(tag, 'Failed to persist signedTx:', e);
      }

      // Dismiss the side-panel approval overlay. We don't emit
      // `transaction_complete` (that's for flows where we also broadcast
      // and have a txHash) — for dApp signing the broadcast happens
      // client-side and the dApp's own UI confirms success.
      chrome.runtime.sendMessage({ action: 'signature_complete', eventId: requestInfo.id }).catch(() => {});

      return signedTx;
    }

    case 'tron_signMessage':
    case 'signMessage':
    case 'signMessageV2': {
      throw createProviderRpcError(
        4200,
        'Tron message signing is not yet supported by KeepKey. Use transaction signing instead.',
      );
    }

    // Side-panel Send flow. Payload:
    //   params[0] = { caip, amount: { amount, denom }, recipient, memo, isMax }
    //
    // Branches on caip — a `tron:*/token:T...` or `tron:*/trc20:T...`
    // caip means the user picked a TRC-20 token (USDT, USDC, etc.) from
    // the asset list and we need to build a TriggerSmartContract with
    // the contract's `transfer(address,uint256)` selector. A plain
    // `tron:*/slip44:195` caip is a native TRX transfer. Without this
    // split, clicking USDT and hitting send would invisibly send TRX
    // instead (the caip was being discarded).
    case 'transfer': {
      const payload = params?.[0] || {};
      const recipient: string = payload.recipient;
      const amountStr: string = payload?.amount?.amount ?? payload?.amount ?? '';
      const caip: string = payload?.caip || TRON_CAIP;

      if (!recipient) throw createProviderRpcError(4000, 'Missing recipient');
      if (!amountStr) throw createProviderRpcError(4000, 'Missing amount');

      const amountFloat = parseFloat(amountStr);
      if (!Number.isFinite(amountFloat) || amountFloat <= 0) {
        throw createProviderRpcError(4000, 'Invalid amount');
      }

      const sender = await getTronAddress();
      const trc20Contract = parseTrc20Caip(caip);

      let unsignedGrid: any;
      let signHintTo: string;
      let signHintAmountRaw: string;
      let decimals = 6; // TRX native and USDT/USDC-TRC20 are all 6

      if (trc20Contract) {
        // TRC-20 path. Decimals come from the asset context the
        // side-panel just set via SET_ASSET_CONTEXT; Pioneer populates
        // them on the token row. Default to 6 (USDT/USDC on Tron) as a
        // best-effort fallback so a missing asset context doesn't block
        // the send — the vault firmware will display the raw amount
        // either way.
        try {
          const assetCtx = await assetContextStorage.get();
          if ((assetCtx as any)?.caip === caip && typeof (assetCtx as any)?.decimals === 'number') {
            decimals = (assetCtx as any).decimals;
          }
        } catch {
          /* fall through with default */
        }
        const amountBase = toBaseUnits(amountStr, decimals);
        if (amountBase <= 0n) throw createProviderRpcError(4000, 'Amount too small');

        unsignedGrid = await buildTrc20Transfer(sender, trc20Contract, recipient, amountBase);
        signHintTo = recipient;
        signHintAmountRaw = amountBase.toString();
      } else {
        // Native TRX path.
        const sunAmount = trxToSun(amountStr);
        if (sunAmount <= 0) throw createProviderRpcError(4000, 'Amount too small');
        unsignedGrid = await buildTronTransfer(sender, recipient, sunAmount);
        signHintTo = recipient;
        signHintAmountRaw = String(sunAmount);
      }

      // Persist the full TronGrid response on the event. Use
      // type='transfer' for both native and TRC-20: the approval UI's
      // RequestMethodCard renders "Unknown Method" for anything it
      // doesn't recognise, and there's no semantic win from a separate
      // sub-kind at the UI layer — the `contractAddress` and `caip`
      // fields on unsignedTx let downstream code distinguish when it
      // matters. `unsignedTx.payment.{destination,amount}` is the
      // shape RequestDetailsCard reads to show the approval details;
      // amount stays raw base-units so the UI's /decimals division
      // works across 6- and 18-decimal tokens alike.
      if (!requestInfo.id) requestInfo.id = uuidv4();
      const event = buildEvent(requestInfo, 'transfer', params, {
        caip,
        from: sender,
        to: recipient,
        amount: amountStr,
        amountRaw: signHintAmountRaw,
        decimals,
        // `kind` flags the approval UI to render the correct label
        // ("Token Transfer" for TRC-20 vs "transfer" for native TRX).
        // Without this, side-panel TRC-20 sends looked identical to
        // native TRX sends in the approval pane even though we were
        // actually signing a `transfer(address,uint256)` contract call.
        kind: trc20Contract ? 'trc20-transfer' : 'trx-transfer',
        contractAddress: trc20Contract || undefined,
        tronGridTx: unsignedGrid,
        rawDataHex: unsignedGrid.raw_data_hex,
        payment: {
          destination: recipient,
          amount: signHintAmountRaw,
          decimals,
          // For TRC-20 sends from the side panel the user just clicked
          // the asset, so the global assetContext caip WILL match
          // event.caip and the UI's caip-gated fallback will pick up
          // the right symbol. Leaving it undefined here keeps the
          // handler from baking in a symbol we can't verify without
          // an on-chain lookup.
          symbol: trc20Contract ? undefined : 'TRX',
        },
      });
      // @ts-expect-error addEvent is untyped on the storage wrapper
      const saved = await requestStorage.addEvent(event);
      if (!saved) throw createProviderRpcError(-32603, 'Failed to create approval event');
      chrome.runtime.sendMessage({ action: 'TRANSACTION_CONTEXT_UPDATED', id: event.id }).catch(() => {});

      const approval = await requireApproval(TRON_NETWORK_ID, requestInfo, 'tron', method, params);
      if (!approval?.success) {
        throw createProviderRpcError(4001, 'User denied transaction');
      }

      const signatureHex = await signTronViaRest(unsignedGrid.raw_data_hex, signHintTo, signHintAmountRaw);

      // Tron broadcasttransaction wants the TronGrid response enriched with a
      // `signature` array (hex strings, one per input). Single-sig for both
      // native and TRC-20 transfers.
      const signedTx = { ...unsignedGrid, signature: [signatureHex] };

      const txid = await broadcastTron(signedTx);

      try {
        const stored = await requestStorage.getEventById(requestInfo.id);
        if (stored) {
          stored.txid = txid;
          stored.status = 'broadcasted';
          await requestStorage.updateEventById(requestInfo.id, stored);
        }
      } catch (e) {
        console.warn(tag, 'Failed to persist txid:', e);
      }

      chrome.runtime
        .sendMessage({
          action: 'transaction_complete',
          eventId: requestInfo.id,
          txHash: txid,
          explorerTxLink: 'https://tronscan.org/#/transaction/',
          networkId: TRON_NETWORK_ID,
        })
        .catch(() => {});

      return txid;
    }

    default:
      throw createProviderRpcError(4200, `Unsupported Tron method: ${method}`);
  }
};
