// Presentation helpers for the vault's ClearSign report. The wording stays the
// vault's; these only shorten what a narrow side panel can't show. Callers keep
// the full string for tooltips.

export const shortAddresses = (s: string) => s.replace(/0x[0-9a-fA-F]{40}/g, a => `${a.slice(0, 6)}…${a.slice(-4)}`);

// Truncate (never round) past 6 decimals, so a minimum-output amount can't look larger than it is.
export const shortDecimals = (s: string) => s.replace(/(\d+\.\d{6})\d+/g, '$1…');

export const tidy = (s: string) => shortDecimals(shortAddresses(s));

export interface DecodedRow {
  key: string;
  value: string;
  isSigner: boolean;
}

const SIGNER_SUFFIX = ' (the signing account)';

/** DECODED_FIELD findings are "Key: value" rows. */
export function decodedRows(findings: Array<{ code: string; message: string }> = []): DecodedRow[] {
  return findings
    .filter(f => f.code === 'DECODED_FIELD')
    .map(f => {
      const i = f.message.indexOf(': ');
      const key = i > 0 ? f.message.slice(0, i) : '';
      let value = i > 0 ? f.message.slice(i + 2) : f.message;
      const isSigner = value.endsWith(SIGNER_SUFFIX);
      if (isSigner) value = value.slice(0, -SIGNER_SUFFIX.length);
      return { key, value, isSigner };
    });
}

export const isRiskFinding = (f: { code: string }) => f.code.startsWith('RISK_');
