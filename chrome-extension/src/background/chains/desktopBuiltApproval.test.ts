import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// The helper lives with the side-panel card; this is the repo's only vitest runner.
import { builtAccountLabel } from '../../../../pages/side-panel/src/approval/utxo/builtAccount';

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

describe('UTXO sends spend the row picked in the extension', () => {
  it('the Transfer form sends the selected row script type', () => {
    expect(read('../../../../pages/side-panel/src/components/Transfer.tsx')).toContain(
      'scriptType: assetContext?.script_type',
    );
  });

  it('every Desktop build is checked against the requested row before it is returned', () => {
    expect(read('./buildViaDesktop.ts')).toMatch(/rowBuildMismatch\(request, build, chainName\)/);
  });

  it('the Bitcoin handler no longer refuses rows Desktop can now spend', () => {
    const source = read('./bitcoinHandler.ts');
    expect(source).not.toContain('btcRowRefusal');
    expect(source).not.toContain('btcBuildMismatch');
  });
});

// A dApp can name scriptType/accountIndex in a transfer, so the approval must
// say which of the user's accounts is spent: the one Desktop built from.
describe('UTXO approval shows the account Desktop built from', () => {
  it('labels it like the extension rows: script type · account', () => {
    expect(builtAccountLabel({ scriptType: 'p2wpkh', accountIndex: 2 })).toBe('Native SegWit · Account 2');
    expect(builtAccountLabel({ scriptType: 'p2pkh', accountIndex: 0 })).toBe('Legacy · Account 0');
    expect(builtAccountLabel({ scriptType: 'p2sh-p2wpkh', accountIndex: 1 })).toBe('SegWit · Account 1');
  });

  it('shows nothing when Desktop did not say (a Desktop that predates the field)', () => {
    expect(builtAccountLabel({})).toBeUndefined();
    expect(builtAccountLabel(undefined)).toBeUndefined();
    expect(builtAccountLabel({ scriptType: 'p2wpkh' })).toBeUndefined();
    expect(builtAccountLabel({ accountIndex: 2 })).toBeUndefined();
  });

  it('the Basic tab reads the label from the build summary, not the request', () => {
    const source = read(`${UTXO_APPROVAL}RequestDetailsCard.tsx`);
    expect(source).toContain('builtAccountLabel(summary)');
    expect(source).not.toMatch(/request\.params|params\??\.\[?0?\]?\??\.?(scriptType|accountIndex)/);
  });
});
