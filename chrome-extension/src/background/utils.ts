/**
 * Categorical hint for the side panel — lets the UI key off a stable
 * field instead of regex-matching `message`. Add cases as we identify
 * other error categories worth distinct UI treatment.
 */
export type ProviderErrorKind = 'timeout';

export interface ProviderRpcError extends Error {
  code: number;
  data?: unknown;
  kind?: ProviderErrorKind;
}

export const createProviderRpcError = (
  code: number,
  message: string,
  data?: unknown,
  kind?: ProviderErrorKind,
): ProviderRpcError => {
  const error = new Error(message) as ProviderRpcError;
  error.code = code;
  if (data) error.data = data;
  if (kind) error.kind = kind;
  return error;
};

/** Convenience for timeout errors so callers don't have to remember the kind string. */
export const createTimeoutError = (message: string): ProviderRpcError =>
  createProviderRpcError(-32603, message, undefined, 'timeout');

/**
 * Shown whenever the KeepKey Vault desktop app (REST server on localhost:1646)
 * is unreachable. Mirrors the side panel's Connect "KeepKey Vault Required"
 * card so the dApp sees the same instruction instead of a raw "Failed to fetch".
 */
export const VAULT_REQUIRED_MESSAGE =
  'KeepKey Vault is not running. Open the KeepKey Vault desktop app, then try again. Get it at https://keepkey.com/launch';

/** EIP-1193 4900 = "provider disconnected from all chains" — fits a down vault. */
export const createVaultRequiredError = (): ProviderRpcError => createProviderRpcError(4900, VAULT_REQUIRED_MESSAGE);

/**
 * True when an error came from the vault REST server being down. The signing
 * path fetches localhost:1646; when the vault is closed that rejects with a
 * network error whose message varies by browser/runtime ("Failed to fetch",
 * "Load failed", "NetworkError", "ECONNREFUSED").
 */
export function isVaultUnreachableError(msg: string): boolean {
  return /failed to fetch|load failed|networkerror|econnrefused|fetch failed|err_connection_refused/i.test(msg);
}

/**
 * Translate low-level errors into user-facing messages:
 *  - vault unreachable (localhost:1646 down) → "Vault not running" instruction
 *  - vault SdkError ("No device connected")  → connect-device instruction
 * All other errors pass through unchanged.
 */
export function formatUserError(err: unknown): string {
  const msg = (err as Error)?.message ?? String(err);
  if (isVaultUnreachableError(msg)) {
    return VAULT_REQUIRED_MESSAGE;
  }
  if (msg.includes('No device connected')) {
    return 'Please connect your KeepKey device and try again.';
  }
  return msg;
}
