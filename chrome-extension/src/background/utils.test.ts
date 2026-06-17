import { describe, it, expect } from 'vitest';
import { createProviderRpcError, createTimeoutError, formatUserError } from './utils';

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

describe('formatUserError', () => {
  it('translates the vault "No device connected" error into a friendly message', () => {
    const e = new Error('SdkError: No device connected');
    expect(formatUserError(e)).toBe('Please connect your KeepKey device and try again.');
  });

  it('passes other error messages through unchanged', () => {
    expect(formatUserError(new Error('replacement transaction underpriced'))).toBe(
      'replacement transaction underpriced',
    );
  });

  it('handles non-Error values by stringifying them', () => {
    expect(formatUserError('plain string failure')).toBe('plain string failure');
  });

  it('does not throw on null/undefined input', () => {
    expect(() => formatUserError(null)).not.toThrow();
    expect(() => formatUserError(undefined)).not.toThrow();
  });
});
