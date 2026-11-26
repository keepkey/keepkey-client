/**
 * One approval per identical request (KEEPKEY-192 "ghost approvals").
 *
 * A page can fire the same signing request twice (double click, a retry in
 * its own code, two listeners). While the first is still pending — waiting on
 * the card, the device, or the broadcast — an identical second request from
 * the same origin joins it: one card, one device prompt, and both callers get
 * the same result (the same txid / signature). Once the first settles the key
 * is released, so a deliberate repeat later gets its own card.
 *
 * Identity is (origin, chain, method, params): the origin is the one Chrome
 * reports for the sender (senderSite.ts), never the page's own claim; params
 * are hashed in canonical form (key order does not matter) BEFORE any handler
 * mutates them (handlers fill nonce/gas into params[0]).
 */
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { isInteractiveMethod } from '../injected/requestTimeouts';

/** Stable JSON: sorted object keys, so {a,b} and {b,a} hash the same. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') {
    return typeof value === 'bigint' ? JSON.stringify(value.toString()) : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter(k => obj[k] !== undefined)
    .sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export function requestKey(origin: string, chain: string, method: string, params: unknown): string {
  const digest = bytesToHex(sha256(utf8ToBytes(canonicalJson(params ?? null))));
  return `${origin}|${chain}|${method}|${digest}`;
}

/** Only requests that open an approval are deduplicated; reads always run. */
export const shouldDedupe = (method: unknown): boolean => isInteractiveMethod(method);

export function createInflightRequests(log: (...a: unknown[]) => void = () => {}) {
  const inflight = new Map<string, Promise<unknown>>();
  return {
    /** Run `fn`, or join an identical request that is still in flight. */
    run<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const existing = inflight.get(key);
      if (existing) {
        log('identical request already in flight — joining it instead of opening a second approval', key);
        return existing as Promise<T>;
      }
      const p = (async () => fn())().finally(() => {
        if (inflight.get(key) === p) inflight.delete(key);
      });
      inflight.set(key, p);
      return p;
    },
    has: (key: string) => inflight.has(key),
    get size() {
      return inflight.size;
    },
  };
}
