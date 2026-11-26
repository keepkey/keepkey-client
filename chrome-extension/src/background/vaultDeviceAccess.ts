import { SIGNING_TIMEOUT_MS } from '../signingTimeouts';
import { withServiceWorkerKeepAlive } from './keepAlive';

export const VAULT_LOCKED_MESSAGE = 'Your KeepKey is locked. Unlock it in KeepKey Vault, then try again.';
export const isVaultLockedError = (error: unknown): boolean => (error as any)?.status === 423;

/**
 * A cached-only read 423s with DEVICE_ACCESS_REQUIRED when Vault's REST cache
 * has no entry for the path. If Vault reports the device present and UNLOCKED,
 * one foreground retry is safe: nothing to unlock, so no PIN prompt, and the
 * caller sends show_display:false so no button press. A genuinely locked
 * device (or any other error) never retries.
 */
export function shouldRetryWithForeground(
  error: unknown,
  connection: { devicePresent: boolean; deviceLocked: boolean },
  alreadyTried: boolean,
): boolean {
  const e = error as any;
  return (
    !alreadyTried &&
    e?.status === 423 &&
    e?.code === 'DEVICE_ACCESS_REQUIRED' &&
    connection.devicePresent &&
    !connection.deviceLocked
  );
}

/** Cached reads never open a PIN prompt. Only a deliberate user request opts
 * into device access; Vault keeps that same HTTP request pending while unlocking. */
export async function readFromVault<T = any>(sdk: any, path: string, body: unknown, foreground = false): Promise<T> {
  const apiKey = sdk?.getClient?.()?.getApiKey?.();
  if (!apiKey) throw new Error('Vault pairing is unavailable. Reconnect the extension to Vault.');
  const request = () =>
    fetch(`http://localhost:1646${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'X-KeepKey-Device-Access': foreground ? 'foreground' : 'cached',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(foreground ? SIGNING_TIMEOUT_MS : 30_000),
    });
  const response = await (foreground ? withServiceWorkerKeepAlive(request) : request());
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const error = new Error(
      response.status === 423 ? VAULT_LOCKED_MESSAGE : text || `Vault error (${response.status})`,
    );
    // Keep Vault's machine-readable code (e.g. DEVICE_ACCESS_REQUIRED, a
    // cached-only read that missed Vault's cache, vs. a genuinely locked
    // device): both are 423 and share the user-facing message above.
    let code: string | undefined;
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed?.code === 'string') code = parsed.code;
    } catch {
      /* non-JSON body */
    }
    Object.assign(error, { status: response.status, ...(code ? { code } : {}) });
    throw error;
  }
  return response.json() as Promise<T>;
}

export interface VaultConnectionState {
  vaultReachable: boolean;
  paired: boolean;
  devicePresent: boolean;
  deviceLocked: boolean;
}

/** Numeric UI states remain compatible; 6 is online/paired, awaiting wallet data. */
export function keepKeyConnectionCode(connection: VaultConnectionState, initialized: boolean): number {
  if (!connection.vaultReachable) return 4;
  if (!connection.paired) return 2;
  return initialized ? 5 : 6;
}

/** Passive account/balance/network polling must not wake the device. */
export const isForegroundDeviceRequest = (method?: string): boolean =>
  !!method &&
  !/disconnect/i.test(method) &&
  /(?:sign|transfer|requestAccounts|request_accounts|connect|request_pubkeys|getPublicKey|requestAddAccount)/i.test(
    method,
  );
