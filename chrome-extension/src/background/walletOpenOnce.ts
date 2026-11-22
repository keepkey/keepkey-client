import type { RefreshReason } from './portfolioBalances';

type SessionStore = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

// Guards concurrent onStart runs within one worker lifetime before storage answers.
const claimed = new Set<string>();

/**
 * 'wallet-open' authorizes paid token discovery on the gateway, so it is sent once per
 * wallet per browser session. Worker restarts, the side panel's ON_START health-poll
 * reruns and empty-cache reads are 'automatic' (cache-only, never paid). Without this,
 * one open extension spent 9,100 of the gateway's 10,000 daily Zerion calls (2026-11-22).
 */
export async function walletOpenReason(
  walletId: string,
  store: SessionStore = chrome.storage.session,
): Promise<RefreshReason> {
  if (!walletId) return 'automatic';
  const key = `walletOpenRefresh:${walletId.toLowerCase()}`;
  if (claimed.has(key)) return 'automatic';
  claimed.add(key);
  try {
    if ((await store.get(key))[key]) return 'automatic';
    await store.set({ [key]: Date.now() });
  } catch {
    /* No session storage: the in-memory guard still limits it to once per worker. */
  }
  return 'wallet-open';
}
