/**
 * Portfolio balance requests to api.keepkey.info.
 *
 * Everything goes to the gateway's keyed `/api/v1/portfolio/balances`, except
 * Tron (see the ponytail note below). Each side that fails keeps its last-known
 * rows, so a failure on one side never wipes the other side's balances.
 */
import { fetchJsonWithTimeout } from './fetchUtils';
import { pioneerFetch } from './pioneerKey';

const PIONEER_API = 'https://api.keepkey.info';

/**
 * Gateway refresh policy: 'wallet-open' and 'manual' may run paid token
 * discovery; anything else is cache-only. First loads must not be
 * 'automatic' (cache-only with no snapshot drops the ERC-20 rows).
 */
export type RefreshReason = 'wallet-open' | 'manual' | 'automatic';
export type PortfolioPubkey = { caip: string; pubkey: string };

// ponytail: Tron stays on the 0.0.39 legacy /api/v1/portfolio request (served by
// green) because the gateway's /portfolio/balances returns native TRX only, so
// USDT-Tron and other TRC-20 rows would vanish. Ceiling: green must stay up for
// Tron until the gateway returns TRC-20; then drop this split.
const isLegacyTron = (p: PortfolioPubkey) => p.caip.startsWith('tron:');

/** Gateway /portfolio/balances (keyed read). Per-chain problems arrive in meta.failures. */
async function fetchGatewayEntries(
  pubkeys: PortfolioPubkey[],
  forceRefresh: boolean,
  refreshReason: RefreshReason,
): Promise<any[]> {
  const path = `/api/v1/portfolio/balances${forceRefresh ? '?forceRefresh=true' : ''}`;
  // 12s budget: cold token discovery is the slowest call we make.
  const res = await pioneerFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pubkeys, refreshReason }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} from ${path}: ${body}`);
  }
  const json = await res.json();
  for (const f of json?.meta?.failures || []) {
    console.warn('[fetchBalances] gateway dropped', f?.caip, f?.reason);
  }
  return json?.balances || json?.data?.balances || [];
}

/** Exactly the 0.0.39 request: unkeyed /api/v1/portfolio, answered by green. */
async function fetchLegacyTronEntries(pubkeys: PortfolioPubkey[], forceRefresh: boolean): Promise<any[]> {
  const json = await fetchJsonWithTimeout<any>(
    `${PIONEER_API}/api/v1/portfolio${forceRefresh ? '?forceRefresh=true' : ''}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `key:public-${Date.now()}`,
      },
      body: JSON.stringify({ pubkeys }),
    },
    { timeoutMs: 12000, retries: 1 },
  );
  return json?.balances || json?.data?.balances || [];
}

/**
 * Raw portfolio rows for `pubkeys` (`entries`, pre-normalization), plus
 * `carried`: copies of the `previous` rows for the networks of any side whose
 * request failed. `error` is null only when every request succeeded.
 */
export async function fetchPortfolioEntries(
  pubkeys: PortfolioPubkey[],
  forceRefresh: boolean,
  refreshReason: RefreshReason,
  previous: any[],
): Promise<{ entries: any[]; carried: any[]; error: string | null }> {
  const sides = [
    { pubkeys: pubkeys.filter(p => !isLegacyTron(p)), fetch: fetchGatewayEntries },
    { pubkeys: pubkeys.filter(isLegacyTron), fetch: fetchLegacyTronEntries },
  ].filter(s => s.pubkeys.length > 0);

  const results = await Promise.allSettled(sides.map(s => s.fetch(s.pubkeys, forceRefresh, refreshReason)));

  const entries: any[] = [];
  const carried: any[] = [];
  const errors: string[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      entries.push(...r.value);
      return;
    }
    const message = r.reason?.message || 'portfolio fetch failed';
    console.warn('[fetchBalances] portfolio error:', message);
    errors.push(message);
    const networks = new Set(sides[i].pubkeys.map(p => p.caip.split('/')[0]));
    carried.push(...previous.filter(b => networks.has(b.networkId)).map(b => ({ ...b })));
  });
  return { entries, carried, error: errors.length ? errors.join('; ') : null };
}
