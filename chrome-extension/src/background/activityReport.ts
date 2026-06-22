/**
 * activityReport — hands BEX-broadcast txids to the vault so its SQL activity
 * DB stays complete.
 *
 * Swaps go through vault's /api/v2/swap/execute (vault broadcasts + tracks them
 * itself), so they're already in the DB. But transactions the BEX broadcasts
 * directly — EVM sends and dApp/DeFi `eth_sendTransaction` / `eth_sendRawTransaction`
 * — never reach vault. This reports those.
 *
 * Contract is intentionally minimal: we send the txid + identifying context and
 * vault VERIFIES it on-chain before persisting (we never assert success). The
 * call is best-effort and fire-and-forget: a 404 (endpoint not deployed yet),
 * 401, or network error must never disrupt the user's transaction.
 *
 * See HANDOFF_vault_activity_intake_and_history.md for the endpoint spec.
 */
import * as wallet from './wallet';
import { keepKeyApiKeyStorage } from '@extension/storage';

const VAULT_URL = 'http://localhost:1646';

export interface ActivityReport {
  /** Broadcast transaction id / hash. */
  txid: string;
  /** CAIP-2 network (e.g. "eip155:1") — vault resolves the chain from this. */
  networkId: string;
  /** CAIP-19 asset when known (native or token). Optional. */
  caip?: string;
  /** Sender address (the wallet address that broadcast). */
  address?: string;
  /** Activity classification: 'send' | 'swap' | 'defi' | 'approve' | 'contract'. */
  type?: string;
  /** Human-readable amount when known. */
  amount?: string;
  /** Token contract for ERC-20/SPL/etc. when applicable. */
  contract?: string;
  /** Free-form label (dApp origin, method name) for display. */
  label?: string;
}

async function getApiKey(): Promise<string | null> {
  try {
    const key = wallet.getSdk?.()?.getClient?.()?.getApiKey?.();
    if (key) return key;
  } catch {
    /* SDK not ready — fall back to stored key */
  }
  try {
    return (await keepKeyApiKeyStorage.getApiKey()) || null;
  } catch {
    return null;
  }
}

/**
 * Report a broadcast txid to vault. Best-effort — resolves to false on any
 * failure (and never throws), so callers can `void reportActivityToVault(...)`.
 */
export async function reportActivityToVault(report: ActivityReport): Promise<boolean> {
  if (!report?.txid || !report?.networkId) return false;
  try {
    const apiKey = await getApiKey();
    if (!apiKey) return false;
    const resp = await fetch(`${VAULT_URL}/api/v2/activity/intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(8000),
    });
    return resp.ok;
  } catch {
    return false; // 404 (not deployed), 401, timeout — all non-fatal
  }
}
