/**
 * Device-interactive deadlines for the KeepKey Vault SDK.
 *
 * keepkey-vault-sdk@3.0.1 aborts every request after DEFAULT_TIMEOUT_MS
 * (30s). It defines SIGNING_TIMEOUT_MS (10 min) but only uses it for pairing:
 * `/eth/sign`, `/eth/sign-typed-data`, `/eth/sign-transaction` and every other
 * `/<chain>/sign*` route go through `client.post(path, body)` with no timeout
 * argument, so they get the 30s default.
 *
 * A device signature is not a 30s operation. The vault holds the HTTP request
 * open until the user confirms on the KeepKey, and it serializes device access.
 * So when a dApp such as Safe{Wallet} queues several signatures, request N's
 * 30s clock runs while the user is still confirming request 1 on the device.
 * The fetch aborts and the dApp gets "KeepKey Desktop communication timed out".
 *
 * `applyDeviceTimeouts` wraps the SDK client's `post` so sign routes get a
 * device-length deadline. Read-only routes keep the SDK's short default.
 */

/** Deadline for a single device-interactive vault call (matches the SDK's SIGNING_TIMEOUT_MS). */
export const DEVICE_SIGN_TIMEOUT_MS = 10 * 60_000;

/** `/eth/sign`, `/eth/sign-typed-data`, `/cosmos/sign-amino-*`, `/utxo/sign-transaction`, ... */
const DEVICE_SIGN_PATH = /^\/[a-z0-9]+\/sign(?:-[a-z0-9-]+)?$/;

export const isDeviceSignPath = (path: string): boolean => DEVICE_SIGN_PATH.test(path.split('?')[0]);

const PATCHED = Symbol.for('keepkey.deviceTimeoutsApplied');

/**
 * Patch the SDK's underlying VaultClient in place. Idempotent. Returns true
 * when the patch was applied (or already present), false when the SDK shape
 * is unexpected. In that case signing still works, but with the 30s deadline.
 */
export function applyDeviceTimeouts(sdk: any, timeoutMs: number = DEVICE_SIGN_TIMEOUT_MS): boolean {
  const client = sdk?.getClient?.() ?? sdk?.client;
  if (!client || typeof client.post !== 'function') return false;
  if (client[PATCHED]) return true;

  const originalPost = client.post.bind(client);
  client.post = (path: string, body?: unknown, requestTimeoutMs?: number) =>
    originalPost(path, body, requestTimeoutMs ?? (isDeviceSignPath(path) ? timeoutMs : undefined));
  client[PATCHED] = true;
  return true;
}
