import { describe, it, expect } from 'vitest';
// The helpers live with the side-panel card; this is the repo's only vitest runner.
import { decodedRows, shortDecimals, tidy } from '../../../pages/side-panel/src/approval/clearSignFormat';

describe('clearSignFormat', () => {
  it('truncates (never rounds) long decimals', () => {
    expect(shortDecimals('at least 0.107033467227354714 ETH')).toBe('at least 0.107033… ETH');
    expect(shortDecimals('0.1079999999')).toBe('0.107999…');
    expect(shortDecimals('300 USDC, 18:59')).toBe('300 USDC, 18:59');
  });

  it('shortens addresses but leaves other hex alone', () => {
    expect(tidy('to 0x909Ef6B32DfDc12CA86aA710b54c991af3C5F82E now')).toBe('to 0x909E…F82E now');
    expect(tidy('selector 0x3593564c')).toBe('selector 0x3593564c');
  });

  it('parses DECODED_FIELD rows and flags the signing account', () => {
    const rows = decodedRows([
      { code: 'RISK_MEDIUM', message: 'ignored' },
      { code: 'DECODED_FIELD', message: 'You pay: 300 USDC' },
      { code: 'DECODED_FIELD', message: 'Recipient: 0xabc (the signing account)' },
    ]);
    expect(rows).toEqual([
      { key: 'You pay', value: '300 USDC', isSigner: false },
      { key: 'Recipient', value: '0xabc', isSigner: true },
    ]);
  });
});
