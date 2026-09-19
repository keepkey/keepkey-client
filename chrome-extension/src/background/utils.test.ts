import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createProviderRpcError,
  createTimeoutError,
  createVaultRequiredError,
  formatUserError,
  isVaultUnreachableError,
  VAULT_REQUIRED_MESSAGE,
} from './utils';

describe('createProviderRpcError', () => {
  it('sets the code and message', () => {
    const e = createProviderRpcError(4001, 'User rejected');
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe(4001);
    expect(e.message).toBe('User rejected');
  });

  it('attaches data and kind only when provided', () => {
    const bare = createProviderRpcError(4001, 'x');
    expect(bare.data).toBeUndefined();
    expect(bare.kind).toBeUndefined();

    const full = createProviderRpcError(-32603, 'y', { detail: 1 }, 'timeout');
    expect(full.data).toEqual({ detail: 1 });
    expect(full.kind).toBe('timeout');
  });
});

describe('createTimeoutError', () => {
  it('uses the internal-error code and tags kind=timeout', () => {
    const e = createTimeoutError('Device did not respond');
    expect(e.code).toBe(-32603);
    expect(e.kind).toBe('timeout');
    expect(e.message).toBe('Device did not respond');
  });
});

describe('createVaultRequiredError', () => {
  it('uses EIP-1193 disconnected code 4900 and the canonical vault message', () => {
    const e = createVaultRequiredError();
    expect(e.code).toBe(4900);
    expect(e.message).toBe(VAULT_REQUIRED_MESSAGE);
    expect(e.message).toContain('keepkey.com/launch');
  });
});

describe('isVaultUnreachableError', () => {
  it.each([
    'TypeError: Failed to fetch',
    'Load failed',
    'NetworkError when attempting to fetch resource',
    'connect ECONNREFUSED 127.0.0.1:1646',
  ])('detects vault-down network error: %s', msg => {
    expect(isVaultUnreachableError(msg)).toBe(true);
  });

  it('does not flag unrelated errors', () => {
    expect(isVaultUnreachableError('User rejected the request')).toBe(false);
  });
});

describe('formatUserError', () => {
  // formatUserError probes localhost:1646 before blaming the vault, so every
  // case here has to say whether the vault is up. `vaultUp(false)` = closed.
  const vaultUp = (up: boolean) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(() => (up ? Promise.resolve(new Response('ok')) : Promise.reject(new TypeError('Failed to fetch')))),
    );

  afterEach(() => vi.unstubAllGlobals());

  it('translates a vault-unreachable network error into the launch instruction', async () => {
    vaultUp(false);
    await expect(formatUserError(new Error('TypeError: Failed to fetch'))).resolves.toBe(VAULT_REQUIRED_MESSAGE);
  });

  // The regression this guards: Chrome throws the identical string for a dead
  // Ethereum RPC, and users were told to launch a vault that was already up.
  it('does NOT blame the vault when the vault answers', async () => {
    vaultUp(true);
    await expect(formatUserError(new Error('TypeError: Failed to fetch'))).resolves.toBe('TypeError: Failed to fetch');
  });

  it('translates the vault "No device connected" error into a friendly message', async () => {
    const e = new Error('SdkError: No device connected');
    await expect(formatUserError(e)).resolves.toBe('Please connect your KeepKey device and try again.');
  });

  it('passes other error messages through unchanged', async () => {
    await expect(formatUserError(new Error('replacement transaction underpriced'))).resolves.toBe(
      'replacement transaction underpriced',
    );
  });

  it('handles non-Error values by stringifying them', async () => {
    await expect(formatUserError('plain string failure')).resolves.toBe('plain string failure');
  });

  it('does not throw on null/undefined input', async () => {
    await expect(formatUserError(null)).resolves.toBeDefined();
    await expect(formatUserError(undefined)).resolves.toBeDefined();
  });
});
