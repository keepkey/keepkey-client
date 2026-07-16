/**
 * providerLog — in-memory observability state for the MCP agent bridge
 * (EPIC_mcp_agent_bridge.md). Three registries, all fed from methods.ts:
 *
 *  - a ring buffer of every provider request/response/error (bex_logs)
 *  - the live approval queue mirrored out of requireApproval (bex_pending_requests)
 *  - origins that have made provider requests + chains touched (bex_connected_sites)
 *
 * ponytail: in-memory only — wiped on MV3 service-worker restart. bex_status
 * exposes swStartedAt so agents can detect the wipe; move to chrome.storage
 * if cross-restart logs prove necessary (epic open question #2).
 */

import { v4 as uuidv4 } from 'uuid';

export interface ProviderLogEntry {
  ts: number; // ms epoch, request completion time
  origin: string;
  chain: string;
  method: string;
  params: unknown;
  result?: unknown;
  errorCode?: number | string;
  errorMessage?: string;
  durationMs: number;
}

export interface PendingRequest {
  /**
   * Internally-generated, unique. `id` below is dApp-supplied (typically a
   * per-page counter, so two tabs collide on `1`) — keying the queue by it
   * would let one settle evict another tab's entry, and would let a Phase-2
   * bex_approve_request(id) resolve the WRONG origin's prompt. Address the
   * queue by `key`; `id` is for correlating with the dApp's own logs.
   */
  key: string;
  id: string;
  method: string;
  params: unknown;
  origin: string;
  chain: string;
  requestedAt: number;
}

const MAX_LOG_ENTRIES = 500;
const MAX_RESULT_CHARS = 2000; // keep the ring buffer bounded in memory, not just in length

export const SW_STARTED_AT = Date.now();

const logBuffer: ProviderLogEntry[] = [];
const pendingRequests = new Map<string, PendingRequest>();
const connectedSites = new Map<string, { chains: Set<string>; firstSeen: number; lastSeen: number }>();

// Never throw: this runs on the SUCCESS path of every provider call, so a
// stringify failure (BigInt, circular ref) must not turn a good wallet response
// into a dApp-visible error.
const clip = (v: unknown): unknown => {
  let s: string | undefined;
  try {
    s = JSON.stringify(v);
  } catch {
    return '[unserializable]';
  }
  if (s && s.length > MAX_RESULT_CHARS) return `[clipped ${s.length} chars] ${s.slice(0, MAX_RESULT_CHARS)}`;
  return v;
};

export function recordProviderCall(entry: ProviderLogEntry): void {
  logBuffer.push({
    ...entry,
    params: clip(entry.params),
    result: entry.result === undefined ? undefined : clip(entry.result),
  });
  if (logBuffer.length > MAX_LOG_ENTRIES) logBuffer.splice(0, logBuffer.length - MAX_LOG_ENTRIES);
}

export function getLogs(filter?: { pattern?: string; since?: number; limit?: number }): ProviderLogEntry[] {
  let out = logBuffer;
  if (filter?.since) out = out.filter(e => e.ts >= filter.since!);
  if (filter?.pattern) {
    const re = new RegExp(filter.pattern, 'i');
    out = out.filter(e => re.test(e.method) || re.test(e.origin) || re.test(e.chain) || re.test(e.errorMessage ?? ''));
  }
  const limit = filter?.limit ?? 100;
  return out.slice(-limit);
}

/** Returns the internal key to settle this entry with — never reuse the dApp id. */
export function registerPending(req: Omit<PendingRequest, 'key'>): string {
  // uuid (not crypto.randomUUID): the Web Crypto global isn't exposed in the
  // node/vitest test env, and `uuid` is already a dep + bundles for the SW.
  const key = uuidv4();
  pendingRequests.set(key, { ...req, key });
  return key;
}

export function settlePending(key: string | null | undefined): void {
  if (!key) return;
  pendingRequests.delete(key);
}

export function getPendingRequests(): PendingRequest[] {
  return [...pendingRequests.values()];
}

export function recordSite(origin: string, chain: string): void {
  if (!origin) return;
  const now = Date.now();
  const site = connectedSites.get(origin);
  if (site) {
    site.chains.add(chain);
    site.lastSeen = now;
  } else {
    connectedSites.set(origin, { chains: new Set([chain]), firstSeen: now, lastSeen: now });
  }
}

export function getConnectedSites(): Array<{ origin: string; chains: string[]; firstSeen: number; lastSeen: number }> {
  return [...connectedSites.entries()].map(([origin, s]) => ({
    origin,
    chains: [...s.chains],
    firstSeen: s.firstSeen,
    lastSeen: s.lastSeen,
  }));
}
