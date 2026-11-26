/**
 * Wiring for the browser posting key: vault REST calls (device-backed cipher,
 * account authorities, posting-authority changes) and the key vault singleton
 * on chrome.storage.local. Request bodies with key material are never logged.
 */
import * as wallet from '../wallet';
import { SIGNING_TIMEOUT_MS } from '../../signingTimeouts';
import { createBrowserKeyVault, type DeviceCipher } from './hiveBrowserKey';

const VAULT_URL = 'http://localhost:1646';

function apiKey(): string {
  const key = wallet.getSdk()?.getClient?.()?.getApiKey?.();
  if (!key) throw new Error('KeepKey Vault is not connected');
  return key;
}

async function vaultJson(path: string, init: RequestInit, timeoutMs: number): Promise<any> {
  const resp = await fetch(`${VAULT_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey()}`, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err: any = new Error(data?.error || `Vault ${path} failed (${resp.status})`);
    err.status = resp.status;
    err.details = data;
    throw err;
  }
  return data;
}

/** KeepKey CipherKeyValue through the vault's restricted route (device button). */
export const vaultCipher: DeviceCipher = async ({ key, valueHex, ivHex, decrypt }) => {
  const data = await vaultJson(
    '/system/cipher-key-value',
    { method: 'POST', body: JSON.stringify({ key, value: valueHex, iv: ivHex, decrypt }) },
    SIGNING_TIMEOUT_MS,
  );
  if (typeof data?.value !== 'string') throw new Error('KeepKey returned no value');
  return data.value;
};

export async function vaultAccountAuthorities(name: string): Promise<any | null> {
  return (await vaultAccountAuthoritiesFull(name)).account;
}

/** Authorities plus what this KeepKey firmware can do with posting (vault-reported). */
export async function vaultAccountAuthoritiesFull(
  name: string,
): Promise<{ account: any | null; capabilities: { dedicatePosting: boolean; revokePosting: boolean } }> {
  const data = await vaultJson(`/hive/account-authorities?name=${encodeURIComponent(name)}`, { method: 'GET' }, 20_000);
  return {
    account: data?.found ? data.account : null,
    // A vault that does not report it predates the check: assume not supported.
    capabilities: {
      dedicatePosting: data?.capabilities?.dedicatePosting === true,
      revokePosting: data?.capabilities?.revokePosting !== false,
    },
  };
}

/** Owner-signed posting change on the KeepKey (vault enforces the locks). */
export async function vaultPostingAuthority(body: {
  account: string;
  change: 'dedicate' | 'revoke';
  posting_key?: string;
  allow_drop_apps?: boolean;
}): Promise<any> {
  return vaultJson('/hive/posting-authority', { method: 'POST', body: JSON.stringify(body) }, SIGNING_TIMEOUT_MS);
}

const chromeStore = {
  get: async (k: string) => (await chrome.storage.local.get(k))?.[k],
  set: async (k: string, v: any) => chrome.storage.local.set({ [k]: v }),
  remove: async (k: string) => chrome.storage.local.remove(k),
};

export const browserKeys = createBrowserKeyVault({ store: chromeStore, cipher: vaultCipher });
