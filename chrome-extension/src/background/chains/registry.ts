/**
 * Pioneer-sourced EVM chain registry.
 *
 * Replaces the static EIP155_CHAINS table that used to live in chains.ts.
 * Pioneer is the source of truth for chain metadata + RPC URLs — querying
 * it on demand removes the "release every time a chain is added" pain
 * point and keeps the BEX in sync with the vault automatically.
 *
 * Endpoint: GET /api/v1/discovery/caip/{caip}
 *   eip155:56/slip44:60 →
 *   {
 *     chainId: 'eip155:56',
 *     name: 'BNB Smart Chain',
 *     symbol: 'BNB',
 *     decimals: 18,
 *     icon, color,
 *     explorer / explorerTxLink / explorerAddressLink (with {{txid}}/{{address}} templates),
 *     rpcUrl: <primary>, rpcUrls: [<all>],
 *   }
 *
 * The shape we expose mirrors what callers used to read off EIP155_CHAINS
 * (chainId hex, name, primary rpc, caip, explorerTxLink prefix) plus the
 * extras Pioneer hands us for free (full rpc list, decimals, icon).
 *
 * In-memory cache only. Pioneer is the source of truth; persisting to
 * chrome.storage would just create a new staleness vector.
 */

import { FetchRequest, JsonRpcProvider } from 'ethers';

const PIONEER_API = 'https://api.keepkey.info';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const FAILURE_TTL_MS = 60 * 1000; // negative-cache misses for a minute
const FETCH_TIMEOUT_MS = 8000;

const TAG = ' | chains/registry | ';

/**
 * Construct a JsonRpcProvider with a *pinned* network. Without this,
 * ethers v6 calls eth_chainId on the first RPC call to detect the
 * network and retries every 1s indefinitely if the URL is slow / dead /
 * rate-limited — generating background spam from any timed-out call
 * site (`Promise.race(getBalance, timeout)` only rejects the awaiting
 * promise; the abandoned provider keeps retrying).
 *
 * Pin the network up front so a bad URL fails fast on the actual call
 * instead of looping on detection forever.
 *
 * `timeoutMs` (optional): when set, builds a `FetchRequest` with a
 * per-HTTP-attempt timeout AND disables ethers' throttle-retry
 * behavior. Without it, ethers will silently retry 429/5xx responses
 * with exponential backoff for ~30s before surfacing the error — which
 * stalls the broadcast failover loop. Pass a short value (e.g. 4000)
 * for paths that need snappy fall-through.
 */
function parseChainIdFromArg(networkOrChainId: string | number): number | null {
  if (typeof networkOrChainId === 'number') {
    return Number.isFinite(networkOrChainId) ? networkOrChainId : null;
  }
  const s = networkOrChainId.trim();
  const m = /^eip155:(\d+)$/.exec(s);
  if (m) return parseInt(m[1], 10);
  const n = /^0x/i.test(s) ? parseInt(s, 16) : parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

export function makeStaticProvider(
  url: string,
  networkOrChainId: string | number,
  options?: { timeoutMs?: number },
): JsonRpcProvider {
  const chainId = parseChainIdFromArg(networkOrChainId);
  const cleanUrl = url.trim();
  const timeoutMs = options?.timeoutMs;

  // Path A: bounded HTTP timeout + no throttle retries. Use FetchRequest
  // so we hit ethers' transport layer, not just the awaiting promise.
  if (timeoutMs && timeoutMs > 0) {
    const fetchReq = new FetchRequest(cleanUrl);
    fetchReq.timeout = timeoutMs;
    // Disable the implicit throttle-retry loop ethers does on 429/5xx.
    // We're handling failover ourselves at a higher level — internal
    // retries here just delay surfacing the error.
    fetchReq.setThrottleParams({ maxAttempts: 1 });
    return chainId != null
      ? new JsonRpcProvider(fetchReq, chainId, { staticNetwork: true })
      : new JsonRpcProvider(fetchReq);
  }

  // Path B: default behavior preserved for non-broadcast call sites.
  return chainId != null
    ? new JsonRpcProvider(cleanUrl, chainId, { staticNetwork: true })
    : new JsonRpcProvider(cleanUrl);
}

export interface ChainInfo {
  chainId: string; // hex, e.g. '0x38'
  caip: string; // 'eip155:56/slip44:60'
  networkId: string; // 'eip155:56'
  name: string; // 'BNB Smart Chain'
  symbol: string; // 'BNB'
  rpc: string; // primary RPC URL (best per Pioneer)
  rpcs: string[]; // primary first, then fallbacks
  explorer: string; // base explorer URL (no template)
  explorerTxLink: string; // prefix — caller appends txid
  explorerAddressLink: string; // prefix — caller appends address
  decimals: number; // native currency decimals
  icon?: string;
  color?: string;
}

interface CacheEntry {
  value: ChainInfo | null;
  at: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<ChainInfo | null>>();

function decimalFromNetworkId(networkId: string): number | null {
  const parts = networkId.split(':');
  if (parts.length !== 2 || parts[0] !== 'eip155') return null;
  const n = parseInt(parts[1], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pioneer encodes explorer URLs with `{{txid}}` / `{{address}}`
 * placeholders. The rest of the codebase uses bare prefixes, so strip
 * the template suffix.
 */
function stripTemplate(url: string | undefined, token: string): string {
  if (!url) return '';
  const idx = url.indexOf(token);
  return idx >= 0 ? url.slice(0, idx) : url;
}

async function fetchFromPioneer(networkId: string): Promise<ChainInfo | null> {
  const decimal = decimalFromNetworkId(networkId);
  if (decimal == null) return null;

  const caip = `${networkId}/slip44:60`;
  const url = `${PIONEER_API}/api/v1/discovery/caip/${encodeURIComponent(caip)}`;

  let resp: Response;
  try {
    resp = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (e: any) {
    console.warn(TAG, 'Pioneer fetch failed for', networkId, e?.message || e);
    return null;
  }
  if (!resp.ok) {
    if (resp.status !== 404) {
      console.warn(TAG, 'Pioneer returned', resp.status, 'for', networkId);
    }
    return null;
  }

  let body: any;
  try {
    body = await resp.json();
  } catch {
    return null;
  }
  // Discovery 404 returns `null` body as 200 in some deployments — bail
  // if we don't have a recognizable shape.
  if (!body || (!body.chainId && !body.assetId)) return null;

  const rpcUrls: string[] = Array.isArray(body.rpcUrls) ? body.rpcUrls.filter((u: any) => typeof u === 'string') : [];
  const primary: string = body.rpcUrl || rpcUrls[0] || '';
  const ordered = primary ? [primary, ...rpcUrls.filter(u => u !== primary)] : rpcUrls.slice();

  return {
    chainId: '0x' + decimal.toString(16),
    caip: body.assetId || caip,
    networkId,
    name: body.name || `Chain ${decimal}`,
    symbol: body.symbol || '',
    rpc: primary,
    rpcs: ordered,
    explorer: body.explorer || '',
    explorerTxLink: stripTemplate(body.explorerTxLink, '{{txid}}'),
    explorerAddressLink: stripTemplate(body.explorerAddressLink, '{{address}}'),
    decimals: typeof body.decimals === 'number' ? body.decimals : 18,
    icon: body.icon,
    color: body.color,
  };
}

/**
 * Resolve chain metadata by networkId (e.g. 'eip155:56'). Returns null
 * if Pioneer doesn't recognize the chain — callers should fall back to
 * whatever surfacing they want (the chain-not-enabled popup, a 4902
 * error, etc.). Concurrent calls for the same networkId share a single
 * in-flight request.
 */
export async function getChainInfo(networkId: string): Promise<ChainInfo | null> {
  if (!networkId) return null;
  const now = Date.now();

  const cached = cache.get(networkId);
  if (cached) {
    const ttl = cached.value ? CACHE_TTL_MS : FAILURE_TTL_MS;
    if (now - cached.at < ttl) return cached.value;
  }

  const existing = inflight.get(networkId);
  if (existing) return existing;

  const p = fetchFromPioneer(networkId)
    .then(value => {
      cache.set(networkId, { value, at: Date.now() });
      return value;
    })
    .finally(() => {
      inflight.delete(networkId);
    });
  inflight.set(networkId, p);
  return p;
}

const colorCache = new Map<string, string | null>();

/**
 * Canonical brand color for any caip (native or token), from the same
 * discovery service getChainInfo uses — but keyed by the full caip so it
 * works for tokens and non-EVM chains too, not just eip155 natives. The
 * portfolio donut/legend use this instead of a hashed palette so ETH is
 * #627EEA, USDT #24A37B, etc. Cached forever (colors are static);
 * best-effort — returns null if discovery doesn't know the asset.
 */
export async function getColorForCaip(caip: string): Promise<string | null> {
  if (!caip) return null;
  if (colorCache.has(caip)) return colorCache.get(caip)!;
  const url = `${PIONEER_API}/api/v1/discovery/caip/${encodeURIComponent(caip)}`;
  let color: string | null = null;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (resp.ok) {
      const body = await resp.json();
      if (body && typeof body.color === 'string') color = body.color;
    }
  } catch {
    // best-effort; leave null and fall back to the hashed palette
  }
  colorCache.set(caip, color);
  return color;
}

/** Convenience: just the primary RPC URL or null. */
export async function getEvmRpc(networkId: string): Promise<string | null> {
  const info = await getChainInfo(networkId);
  return info?.rpc || null;
}
