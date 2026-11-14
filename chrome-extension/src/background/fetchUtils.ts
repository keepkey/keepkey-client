/**
 * Shared fetch helpers for background-side network calls.
 *
 * Two reasons this exists:
 *
 * 1. **Timeouts.** Default `fetch()` has no timeout. A stalled HTTP
 *    request can hang the awaiting code path indefinitely — the most
 *    visible failure mode is the popup / portfolio loader sitting at a
 *    spinner forever when Pioneer or a localhost service is degraded.
 *
 * 2. **Transient retries.** Pioneer (and similar single-endpoint
 *    services) occasionally return 5xx or transient network errors.
 *    A small retry budget eats those without bothering the user.
 *
 * Use:
 *   - `fetchJsonWithTimeout` for endpoints whose response we parse as
 *     JSON (the common case in this codebase).
 *   - `fetchWithTimeout` when you need the raw `Response` (status
 *     check, streaming, etc.).
 */

import { ensureQueryKey } from './pioneerKey';

export interface FetchOptions {
  /** Total per-attempt budget. Default 8000ms. */
  timeoutMs?: number;
  /** Number of retry attempts on transient errors (5xx, network). 0 = no retry. Default 0. */
  retries?: number;
  /** Override what counts as "transient" if you have endpoint-specific knowledge. */
  retryOn?: (status: number) => boolean;
}

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_RETRIES = 0;

const isTransientStatus = (status: number) => status >= 500 && status < 600;

/**
 * fetch with a per-attempt AbortSignal.timeout and optional retry on
 * transient errors. Throws on the final failure.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  options: FetchOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = (options.retries ?? DEFAULT_RETRIES) + 1;
  const retryOn = options.retryOn ?? isTransientStatus;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await fetch(url, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(timeoutMs),
      });
      // Defect signal for the api.keepkey.info cutover: the gateway replays
      // 401/404/405 to the old green Pioneer, so a keyed call answered by green
      // means the key wasn't recognised (or the path isn't ported yet).
      if (url.startsWith('https://api.keepkey.info/') && resp.headers?.get('x-kk-served-by') === 'green') {
        console.warn('[pioneer] served by green:', url, resp.status);
      }
      // Retry only on caller-classified transient statuses. Definitive
      // errors (4xx) are returned to the caller for normal handling.
      if (!resp.ok && retryOn(resp.status) && attempt < maxAttempts) {
        const backoffMs = 200 * 2 ** (attempt - 1);
        console.warn(`[fetchWithTimeout] ${url} attempt ${attempt} got ${resp.status}; retrying in ${backoffMs}ms`);
        await new Promise(r => setTimeout(r, backoffMs));
        continue;
      }
      return resp;
    } catch (e: any) {
      lastErr = e;
      // AbortError (timeout) and network errors are worth retrying.
      if (attempt < maxAttempts) {
        const backoffMs = 200 * 2 ** (attempt - 1);
        console.warn(`[fetchWithTimeout] ${url} attempt ${attempt} threw ${e?.name || ''}; retrying in ${backoffMs}ms`);
        await new Promise(r => setTimeout(r, backoffMs));
        continue;
      }
    }
  }
  throw lastErr;
}

/**
 * fetch + parse JSON with timeout + retry. Throws on transport
 * failure, non-OK response, or JSON parse failure. Caller doesn't have
 * to remember to check `resp.ok` separately.
 */
export async function fetchJsonWithTimeout<T = unknown>(
  url: string,
  init: RequestInit = {},
  options: FetchOptions = {},
): Promise<T> {
  const resp = await fetchWithTimeout(url, init, options);
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status} from ${url}: ${body}`);
  }
  return (await resp.json()) as T;
}

/**
 * Broadcast a signed transaction through Pioneer (`POST /api/v1/broadcast`,
 * keyed). Body `{ networkId, serialized }` (`caip` is ignored by the gateway):
 * hex for UTXO, canonical base64 TxRaw for the Cosmos family, base64 blob for
 * XRP. Rejections come back as HTTP 200 `{ success:false, txid?, error }`
 * (Cosmos CheckTx, XRP tec*), so `success === false` is a failure even with a
 * txid.
 *
 * This is a write: exactly one send. Nothing is re-sent, not on a timeout, a
 * network drop or a 5xx: the first send may already have broadcast, and a
 * resend comes back as a duplicate rejection (`success:false`). Those outcomes
 * are reported as "unknown, check the explorer", not as a failure. A green
 * non-ok means the key wasn't recognised: re-register and surface the error.
 */
export async function broadcastViaPioneer(caip: string, serialized: string): Promise<string> {
  if (typeof serialized !== 'string' || !serialized) {
    throw new Error('Pioneer broadcast: signed tx has no serialized string');
  }
  const networkId = caip.split('/')[0];
  const url = 'https://api.keepkey.info/api/v1/broadcast';
  const unknown = (why: string) =>
    new Error(
      `Pioneer broadcast result unknown (${why}): the transaction may have been sent. Check the explorer before signing again.`,
    );
  const Authorization = await ensureQueryKey();
  let resp: Response;
  try {
    resp = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization },
        body: JSON.stringify({ networkId, caip, serialized }),
      },
      { timeoutMs: 15000, retries: 0 },
    );
  } catch (e: any) {
    throw unknown(e?.name === 'TimeoutError' ? 'no answer in 15 s' : e?.message || 'network error');
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    if (resp.headers.get('x-kk-served-by') === 'green') await ensureQueryKey(true).catch(() => {});
    if (resp.status >= 500) throw unknown(`HTTP ${resp.status} from ${url}: ${body}`);
    throw new Error(`HTTP ${resp.status} from ${url}: ${body}`);
  }
  const data: any = await resp.json().catch(() => {
    throw unknown(`unreadable HTTP ${resp.status} answer`);
  });
  const txid = data?.txid ?? data?.results?.txid;
  if (data?.success === false || !txid)
    throw new Error(
      `Pioneer broadcast failed: ${data?.error?.message ?? data?.error?.error ?? data?.error ?? JSON.stringify(data)}`,
    );
  return txid;
}

/**
 * `serialized` from KeepKey Desktop's Cosmos-family amino sign routes
 * (/cosmos|osmosis/sign-amino, /thorchain|mayachain/sign-amino-transfer):
 * `{ signature, serialized, signed }`, serialized = base64 TxRaw.
 */
export const cosmosSignedSerialized = (signedTx: any): string => signedTx?.serialized;

/**
 * `serialized` from KeepKey Desktop's /xrp/sign-transaction (hdwallet
 * rippleSignTx output): the StdTx with `value.signatures[0].serializedTx` (base64).
 */
export const rippleSignedSerialized = (signedTx: any): string => signedTx?.value?.signatures?.[0]?.serializedTx;
