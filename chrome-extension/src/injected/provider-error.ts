/**
 * Error normalization for the injected providers.
 *
 * EIP-1193 requires a provider to reject with an object carrying `code` and
 * `message`. Our background script sends failures across postMessage as a bare
 * string (`sendResponse({ error: formatUserError(error) })`), and every
 * provider used to `reject(error)` with that string untouched.
 *
 * Rejecting with a primitive breaks the dApp libraries downstream, because
 * they inspect the rejection value before showing it. wagmi/viem/ethers all do
 * some form of membership test, and `in` throws on a primitive:
 *
 *   TypeError: Cannot use 'in' operator to search for 'data' in
 *   KeepKey Vault is not running. Open the KeepKey Vault desktop app...
 *
 * The user then sees a JavaScript error instead of the instruction we went to
 * the trouble of writing. Normalizing here — at the boundary where values
 * leave us for dApp code — fixes every provider at once and keeps us honest
 * with the spec regardless of what the background sends.
 */

/** EIP-1193 provider error: an Error with a numeric `code`, optionally `data`. */
export interface ProviderRpcError extends Error {
  code: number;
  data?: unknown;
}

/** JSON-RPC internal error — the safe default when no code survived the trip. */
const INTERNAL_ERROR = -32603;

/**
 * Coerce anything a provider might be handed into a proper ProviderRpcError.
 *
 * Preserves an existing `code`/`data` when present, so a meaningful code such
 * as 4900 ("provider disconnected") still reaches the dApp. Never throws — a
 * normalizer that can fail is worse than the bug it fixes.
 */
export function toProviderError(raw: unknown, fallbackMessage = 'Request failed'): ProviderRpcError {
  // Already an Error: attach a code if it lacks one and pass it through, so we
  // don't discard a stack or a subclass the caller cared about.
  if (raw instanceof Error) {
    const err = raw as ProviderRpcError;
    if (typeof err.code !== 'number') err.code = INTERNAL_ERROR;
    return err;
  }

  if (typeof raw === 'string') {
    const err = new Error(raw || fallbackMessage) as ProviderRpcError;
    err.code = INTERNAL_ERROR;
    return err;
  }

  // Structured error that lost its prototype crossing postMessage, e.g.
  // { message, code, data }. Keep whatever fields made it across.
  if (raw && typeof raw === 'object') {
    const src = raw as { message?: unknown; code?: unknown; data?: unknown };
    const message = typeof src.message === 'string' && src.message ? src.message : fallbackMessage;
    const err = new Error(message) as ProviderRpcError;
    err.code = typeof src.code === 'number' ? src.code : INTERNAL_ERROR;
    if (src.data !== undefined) err.data = src.data;
    return err;
  }

  const err = new Error(fallbackMessage) as ProviderRpcError;
  err.code = INTERNAL_ERROR;
  return err;
}
