export interface ProviderRpcError extends Error {
  code: number;
  data?: unknown;
}

export const createProviderRpcError = (code: number, message: string, data?: unknown): ProviderRpcError => {
  const error = new Error(message) as ProviderRpcError;
  error.code = code;
  if (data) error.data = data;
  return error;
};

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
