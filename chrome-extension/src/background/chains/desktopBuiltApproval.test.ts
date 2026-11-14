import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Static guards over code with no unit-test runner of its own (side panel).
// UTXO sends are built by KeepKey Desktop, fee included: the approval must show
// that fee, never a local picker whose choice is not what gets signed.
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const UTXO_APPROVAL = '../../../../pages/side-panel/src/approval/utxo/';

describe('UTXO approval shows the fee Desktop built', () => {
  it('has no local fee picker and opens on the Basic tab', () => {
    const source = read(`${UTXO_APPROVAL}index.tsx`);
    expect(source).not.toContain('ProjectFeeCard');
    expect(source).not.toMatch(/defaultIndex=\{[1-9]/);
  });

  it('the Basic tab shows summary.fee in summary.symbol', () => {
    const source = read(`${UTXO_APPROVAL}RequestDetailsCard.tsx`);
    expect(source).toContain('summary.fee');
    expect(source).toContain('summary.symbol');
  });
});
