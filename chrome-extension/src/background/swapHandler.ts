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

const VAULT_URL = 'http://localhost:1646';

export interface SwapResponse {
  ok: boolean;
  status: number;
  data?: any;
  error?: string;
}

function getApiKey(): string | null {
  try {
    const sdk = wallet.getSdk?.();
    const key = sdk?.getClient?.()?.getApiKey?.();
    return key || null;
  } catch {
    return null;
  }
}

async function vaultFetch(path: string, init: RequestInit, timeoutMs = 30_000): Promise<SwapResponse> {
  const apiKey = getApiKey();
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
 * Single entry point dispatched from the background message router.
 * message = { type:'SWAP_REQUEST', action:'assets'|'quote'|'execute'|'status', ... }
 */
export async function handleSwapMessage(message: any, _cachedBalances: any[]): Promise<SwapResponse> {
  switch (message?.action) {
    case 'assets':
      return vaultFetch('/api/v2/swap/assets', { method: 'GET' });

    case 'quote': {
      const p = message.params || {};
      // Addresses are derived vault-side from the connected device (it owns the keys
      // + every chain's derivation path). The BEX can't reliably resolve a receive
      // address for a chain the user doesn't already hold, so we omit them and let
      // vault fill in — only forwarded if a caller explicitly set one (custom dest).
      return vaultFetch('/api/v2/swap/quote', {
        method: 'POST',
        body: JSON.stringify({
          fromCaip: p.fromCaip,
          toCaip: p.toCaip,
          amount: p.amount,
          slippageBps: p.slippageBps,
          isMax: p.isMax,
          feeLevel: p.feeLevel,
          ...(p.fromAddress ? { fromAddress: p.fromAddress } : {}),
          ...(p.toAddress ? { toAddress: p.toAddress } : {}),
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

    default:
      return { ok: false, status: 0, error: `Unknown swap action: ${message?.action}` };
  }
}
