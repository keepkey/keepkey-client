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
