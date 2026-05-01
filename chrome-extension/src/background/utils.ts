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
 * Translate vault SdkError ("No device connected") into a user-facing message.
 * All other errors pass through unchanged.
 */
export function formatUserError(err: unknown): string {
  const msg = (err as Error)?.message ?? String(err);
  if (msg.includes('No device connected')) {
    return 'Please connect your KeepKey device and try again.';
  }
  return msg;
}
