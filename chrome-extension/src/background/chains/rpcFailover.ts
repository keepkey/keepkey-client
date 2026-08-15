/**
 * EVM RPC failover for read-style calls keyed by networkId.
 *
 * The active-provider failover (`withRpcFailover` in ethereumHandler.ts)
 * iterates the URLs the user is currently connected to. This module
 * covers the *read* sites that resolve a networkId on demand —
 * GET_ASSET_BALANCE, GET_EVM_BALANCE, VALIDATE_ERC20_TOKEN — where the
 * caller passes "give me a working RPC for chain X" rather than "use
 * whatever the user picked".
 *
 * Priority order matches the rest of the codebase:
 *   1. user override (custom RPC from Add Network UI / blockchainDataStorage)
 *   2. Pioneer-discovered URLs (registry.getChainInfo)
 *   3. last-resort hardcoded list (lastResortRpcs)
 *
 * Per-attempt timeout via makeStaticProvider's transport-level config
 * stops a hung URL from stalling the loop.
 */

import type { JsonRpcProvider } from 'ethers';
import { blockchainDataStorage } from '@extension/storage';
import { getChainInfo, makeStaticProvider } from './registry';
import { getLastResortRpcs } from './lastResortRpcs';

const FAILED_RPC_COOLDOWN_MS = 60_000;
// Distinct from ethereumHandler's failedRpcs map. The active-provider
// path and the by-networkId reads have different rate-limit blast
// radii (active provider = current chain only; reads = any chain), so
// keeping the cooldowns independent prevents one slow network from
// blocking the other.
const failedRpcs = new Map<string, number>();

/**
 * Heuristic: is this RPC error worth retrying against a different URL?
 * Shared by both failover loops (this module's by-networkId reads and
 * ethereumHandler's active-provider path) so the two cannot drift.
 * Broadcast keeps its own classifier — it has tx-level definitive cases
 * (insufficient funds, nonce too low) that don't apply to reads.
 *
 * The `failed to fetch` / `load failed` / `err_` group matters more than it
 * looks: those are what Chrome and Safari throw for a connection-level
 * failure (TLS handshake, DNS, refused). The original list was written
 * against Firefox/Node wording ("NetworkError..."), so the same dead RPC
 * failed over on Firefox and hard-threw on Chrome — and that hard throw
 * reached a catch-all that mislabeled it "KeepKey Vault is not running".
 *
 * The method-rejection patterns cover narrow-purpose RPCs in Pioneer's
 * catalog (Flashbots' rpc.flashbots.net is the canonical example — supports
 * only eth_sendRawTransaction / eth_chainId / eth_blockNumber, rejects the
 * rest with HTTP 403 + JSON-RPC -32601). Without them such URLs are sticky:
 * their pre-flight getBlockNumber() passes so they get picked first, then
 * every read fails. Treating the rejection as transient blacklists them for
 * 60s and moves on.
 */
export const isTransientRpcError = (errMsg: string): boolean => {
  const m = errMsg.toLowerCase();
  return (
    m.includes('rate limit') ||
    m.includes('throttle') ||
    m.includes('429') ||
    m.includes('timeout') ||
    m.includes('econnreset') ||
    m.includes('etimedout') ||
    m.includes('network') ||
    m.includes('server_error') ||
    m.includes('exceeded maximum retry') ||
    /\b5\d{2}\b/.test(m) || // 5xx
    // Connection-level failure, browser wording.
    m.includes('failed to fetch') || // Chrome / Edge
    m.includes('load failed') || // Safari
    m.includes('fetch failed') || // Node / undici
    m.includes('err_') || // Chrome net errors: ERR_NAME_NOT_RESOLVED, ERR_CONNECTION_REFUSED, ...
    m.includes('aborted') || // per-attempt AbortSignal.timeout fired
    // Method-rejection: this URL doesn't support this method. Try next.
    m.includes('rpc method is not whitelisted') ||
    m.includes('method not found') ||
    m.includes('method not supported') ||
    m.includes('method does not exist') ||
    m.includes('-32601') ||
    // Narrow to ethers' transport-level wrapper text. A bare `.includes('403')`
    // would misfire on revert reasons or hex payloads that happen to contain
    // "403", replaying a successfully-rejected eth_call across every URL.
    m.includes('server response 403') ||
    m.includes('http 403')
  );
};

async function buildCandidates(networkId: string): Promise<string[]> {
  const customChain = await blockchainDataStorage.getBlockchainData(networkId);
  const customUrls: string[] =
    customChain?.providers && customChain.providers.length > 0
      ? customChain.providers
      : customChain?.providerUrl
        ? [customChain.providerUrl]
        : [];
  const pioneer = await getChainInfo(networkId);
  const pioneerUrls: string[] = pioneer?.rpcs || [];
  const lastResort = getLastResortRpcs(networkId);

  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const u of [...customUrls, ...pioneerUrls, ...lastResort]) {
    const t = (u || '').trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      ordered.push(t);
    }
  }
  return ordered;
}

function applyCooldown(candidates: string[]): string[] {
  const now = Date.now();
  for (const [url, failedAt] of failedRpcs) {
    if (now - failedAt >= FAILED_RPC_COOLDOWN_MS) failedRpcs.delete(url);
  }
  const available = candidates.filter(url => {
    const failedAt = failedRpcs.get(url);
    return !(failedAt && now - failedAt < FAILED_RPC_COOLDOWN_MS);
  });
  // If every candidate is cooling, clear and try them all rather than
  // hard-failing — the same convention as ethereumHandler's getProvider.
  if (available.length === 0 && candidates.length > 0) {
    failedRpcs.clear();
    return candidates.slice();
  }
  return available;
}

/**
 * Run an RPC operation with failover across the candidate list for
 * `networkId`. Definitive errors (revert, invalid params) surface
 * immediately. Transient errors (rate limit, 5xx, network, timeout)
 * fail over to the next URL.
 */
export async function withRpcFailoverByNetworkId<T>(
  networkId: string,
  op: (provider: JsonRpcProvider, url: string) => Promise<T>,
  options?: { timeoutMs?: number },
): Promise<T> {
  const candidates = await buildCandidates(networkId);
  const available = applyCooldown(candidates);
  if (available.length === 0) {
    throw new Error(`No RPC URLs available for ${networkId}`);
  }

  const errors: { url: string; error: string }[] = [];
  let lastErr: unknown = null;
  const now = Date.now();
  for (const url of available) {
    try {
      const provider = makeStaticProvider(url, networkId, { timeoutMs: options?.timeoutMs ?? 5000 });
      return await op(provider, url);
    } catch (e: any) {
      const errMsg = String(e?.message || e);
      if (!isTransientRpcError(errMsg)) {
        // Definitive — won't help to try another RPC. Log the URL: this
        // branch used to throw silently, which made RPC failures look like
        // they came from somewhere else entirely.
        console.error(`[rpcFailover] ${networkId} ${url} definitive failure, aborting failover:`, errMsg);
        throw e;
      }
      console.warn(`[rpcFailover] ${networkId} ${url} transient failure, trying next:`, errMsg);
      errors.push({ url, error: errMsg });
      failedRpcs.set(url, now);
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  throw new Error(`All ${available.length} RPC endpoints failed for ${networkId}`);
}
