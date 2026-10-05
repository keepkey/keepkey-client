import { describe, it, expect, vi } from 'vitest';

// The module imports chrome-backed storage/wallet at load; the pure check under test uses neither.
vi.mock('@extension/storage', () => ({ keepKeyApiKeyStorage: {} }));
vi.mock('./wallet', () => ({}));
import { assertMatchingClearSignReport, type ClearSignReport } from './clearSignReport';

const report = (fp: string) => ({ transactionFingerprint: fp }) as ClearSignReport;

describe('assertMatchingClearSignReport', () => {
  it('verifies when the signed report matches the approved one', () => {
    expect(assertMatchingClearSignReport(report('0xaa'), report('0xaa'))).toBe('verified');
  });
  it('throws when the signed transaction differs from what was approved', () => {
    expect(() => assertMatchingClearSignReport(report('0xaa'), report('0xbb'))).toThrow(/fingerprint changed/);
  });
  it('treats a missing report on either side as unverified, never as a pass', () => {
    expect(assertMatchingClearSignReport(report('0xaa'), undefined)).toBe('unverified');
    expect(assertMatchingClearSignReport(undefined, report('0xaa'))).toBe('unverified');
    expect(assertMatchingClearSignReport(report('0xaa'), {})).toBe('unverified');
  });
});
