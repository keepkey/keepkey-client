/**
 * swapHandler — background bridge for the side-panel's native swap UI.
 *
 * The side panel composes the whole swap flow itself (quote → review →
 * submitted) and reaches vault's HEADLESS swap REST through here. Mirrors the
 * authenticated direct-fetch pattern used by solanaHandler/tonHandler/tronHandler
 * (Bearer key off the paired SDK client; long timeout on device-interactive ops).
 *
 * Vault endpoints (see docs/HANDOFF_bex_swap_headless_endpoints.md in the vault repo):
 *   GET  /api/v2/swap/assets        → SwapAsset[]   (firmware-filtered)
 *   POST /api/v2/swap/quote         → SwapQuote
 *   POST /api/v2/swap/execute       → SwapResult    (signs on the device)
 *   GET  /api/v1/swaps/:txid        → SwapHistoryRecord (tracking)
 *
 * NOTE: the headless quote/execute endpoints may not be live yet — every call
 * returns a structured { ok, status, error } so the UI degrades gracefully on
 * 404/503 (not wired) and 401 (re-pair) instead of crashing. No mocking.
 */
import * as wallet from './wallet';
import { keepKeyApiKeyStorage } from '@extension/storage';

const VAULT_URL = 'http://localhost:1646';

export interface SwapResponse {
  ok: boolean;
  status: number;
  data?: any;
  error?: string;
}

// Resolve the Bearer key the same way wallet.init does: prefer the live SDK
// client, fall back to the persisted key. The persisted key survives across
// service-worker restarts where the in-memory SDK may not be ready yet, so a
// paired vault no longer looks "not connected" just because of init timing.
async function getApiKey(): Promise<string | null> {
  try {
    const key = wallet.getSdk?.()?.getClient?.()?.getApiKey?.();
    if (key) return key;
  } catch {
    /* SDK not initialized — fall through to the stored key */
  }
  try {
    return (await keepKeyApiKeyStorage.getApiKey()) || null;
  } catch {
    return null;
  }
}

async function vaultFetch(path: string, init: RequestInit, timeoutMs = 30_000): Promise<SwapResponse> {
  const apiKey = await getApiKey();
  if (!apiKey) {
    return { ok: false, status: 0, error: 'Vault not connected — pair your KeepKey first.' };
  }
  let resp: Response;
  try {
    resp = await fetch(`${VAULT_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, ...(init.headers || {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e: any) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      return { ok: false, status: 0, error: 'Vault request timed out.' };
    }
    return { ok: false, status: 0, error: `Vault connection failed: ${e?.message || e}` };
  }
  const text = await resp.text().catch(() => '');
  let body: any = undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  if (!resp.ok) {
    const error =
      resp.status === 401
        ? 'Pairing expired — reconnect your KeepKey.'
        : resp.status === 404 || resp.status === 503
          ? 'Swap endpoints are not available on this vault yet.'
          : body?.error || `Vault error (${resp.status})`;
    return { ok: false, status: resp.status, error };
  }
  // vault wraps payloads as { data: ... } on /api/v2/swap/* and { entries }/record on /api/v1/swaps
  return { ok: true, status: resp.status, data: body?.data !== undefined ? body.data : body };
}

/**
 * Resolve a usable address for a CAIP-19 asset from device-owned data.
 * 1. exact balance row (a token's CAIP carries its own holding address);
 * 2. first loaded pubkey for the asset's chain (CAIP-2 prefix).
 * Returns undefined when the wallet has nothing for that chain.
 */
export function resolveAddress(caip: string | undefined, cachedBalances: any[]): string | undefined {
  if (!caip) return undefined;
  const row = cachedBalances.find((b: any) => b?.caip === caip && b?.address);
  if (row?.address) return row.address;
  const networkId = caip.split('/')[0];
  return wallet.getAddressForNetwork(networkId);
}

/**
 * Single entry point dispatched from the background message router.
 * message = { type:'SWAP_REQUEST', action:'assets'|'quote'|'execute'|'status', ... }
 */
export async function handleSwapMessage(message: any, cachedBalances: any[]): Promise<SwapResponse> {
  switch (message?.action) {
    case 'assets':
      return vaultFetch('/api/v2/swap/assets', { method: 'GET' });

    case 'quote': {
      const p = message.params || {};
      // vault's /quote dereferences fromAddress/toAddress directly, so the BEX
      // must supply them. We hold device-derived addresses already: prefer the
      // exact balance row (covers tokens), then the first pubkey for the chain.
      const fromAddress = p.fromAddress || resolveAddress(p.fromCaip, cachedBalances);
      const toAddress = p.toAddress || resolveAddress(p.toCaip, cachedBalances);
      if (!fromAddress) {
        return {
          ok: false,
          status: 0,
          error: `No address available for ${p.fromCaip} — open that chain in the wallet first.`,
        };
      }
      if (!toAddress) {
        return {
          ok: false,
          status: 0,
          error: `No receive address for ${p.toCaip} — add that chain to your wallet first.`,
        };
      }
      return vaultFetch('/api/v2/swap/quote', {
        method: 'POST',
        body: JSON.stringify({
          fromCaip: p.fromCaip,
          toCaip: p.toCaip,
          amount: p.amount,
          slippageBps: p.slippageBps,
          isMax: p.isMax,
          feeLevel: p.feeLevel,
          fromAddress,
          toAddress,
        }),
      });
    }

    case 'execute':
      // Device-interactive — block on the physical button press.
      return vaultFetch(
        '/api/v2/swap/execute',
        { method: 'POST', body: JSON.stringify(message.params || {}) },
        300_000,
      );

    case 'status':
      return vaultFetch(`/api/v1/swaps/${encodeURIComponent(message.txid)}`, { method: 'GET' });

    case 'history': {
      // Swap history from vault's tracker DB (per device+wallet scope).
      // Optional filters: status, limit, offset. Returns { entries, count }.
      const p = message.params || {};
      const qs = new URLSearchParams();
      if (p.status) qs.set('status', String(p.status));
      if (p.limit != null) qs.set('limit', String(p.limit));
      if (p.offset != null) qs.set('offset', String(p.offset));
      const q = qs.toString();
      return vaultFetch(`/api/v1/swaps${q ? `?${q}` : ''}`, { method: 'GET' });
    }

    default:
      return { ok: false, status: 0, error: `Unknown swap action: ${message?.action}` };
  }
}
