import { describe, expect, it } from 'vitest';
import { buildErrorMessage, rowBuildMismatch, toBuildError, toBuildRequest, TX_BUILD_PATH } from './buildViaDesktop';
import { VAULT_LOCKED_MESSAGE } from '../vaultDeviceAccess';
import { VAULT_REQUIRED_MESSAGE } from '../utils';
import { shortListSymbolToCaip } from '../chainConfig';

const LTC = shortListSymbolToCaip['LTC'];
const BTC = shortListSymbolToCaip['BTC'];
const ATOM = shortListSymbolToCaip['ATOM'];

// The exact params[0] shape the side-panel Transfer form sends.
const formParams = (over: Record<string, unknown> = {}) => ({
  caip: 'some-other-caip',
  amount: { amount: '0.0123', denom: 'LTC' },
  recipient: 'ltc1qsyntheticrecipient',
  memo: '',
  isMax: false,
  accountIndex: 0,
  note: 'Litecoin account 0',
  ...over,
});

describe('toBuildRequest', () => {
  it('targets the Desktop v2 build route', () => {
    expect(TX_BUILD_PATH).toBe('/api/v2/tx/build');
  });

  it('sends only the contract fields: handler caip, recipient, display amount, account', () => {
    expect(toBuildRequest(LTC, formParams({ accountIndex: 2 }))).toEqual({
      caip: LTC,
      to: 'ltc1qsyntheticrecipient',
      amount: '0.0123',
      isMax: false,
      accountIndex: 2,
    });
  });

  it('never carries pubkeys, xpubs or a fee level', () => {
    const body = toBuildRequest(
      LTC,
      formParams({ pubkeys: [{ pubkey: 'xpub' }], feeLevel: 5, xpubOverride: 'x', scriptType: 'p2pkh' }),
    );
    expect(Object.keys(body).sort()).toEqual(['accountIndex', 'amount', 'caip', 'isMax', 'scriptType', 'to']);
  });

  it('names the selected UTXO row: its script type and account', () => {
    expect(toBuildRequest(BTC, formParams({ scriptType: 'p2pkh', accountIndex: 2 }))).toMatchObject({
      scriptType: 'p2pkh',
      accountIndex: 2,
    });
    expect(toBuildRequest(LTC, formParams({ scriptType: 'p2wpkh', accountIndex: 1 }))).toMatchObject({
      scriptType: 'p2wpkh',
      accountIndex: 1,
    });
  });

  it('a UTXO row with no parsed account is account 0, sent explicitly', () => {
    expect(toBuildRequest(BTC, formParams({ scriptType: 'p2sh-p2wpkh', accountIndex: undefined })).accountIndex).toBe(
      0,
    );
  });

  it('never sends a non-UTXO row type (cosmos rows carry script_type "cosmos")', () => {
    expect(toBuildRequest(ATOM, formParams({ scriptType: 'cosmos' }))).not.toHaveProperty('scriptType');
  });

  it('a dApp transfer with no row sends no script type', () => {
    expect(toBuildRequest(BTC, formParams({ accountIndex: undefined }))).not.toHaveProperty('scriptType');
  });

  it('drops a blank or whitespace memo and forwards a real one', () => {
    expect(toBuildRequest(ATOM, formParams({ memo: '   ' }))).not.toHaveProperty('memo');
    expect(toBuildRequest(ATOM, formParams({ memo: undefined }))).not.toHaveProperty('memo');
    expect(toBuildRequest(ATOM, formParams({ memo: '104411' })).memo).toBe('104411');
  });

  it('omits amount on a max send so Desktop computes it', () => {
    const body = toBuildRequest(LTC, formParams({ isMax: true }));
    expect(body.isMax).toBe(true);
    expect(body).not.toHaveProperty('amount');
  });

  it('omits accountIndex when the caller did not pick one (Desktop defaults to 0)', () => {
    expect(toBuildRequest(LTC, formParams({ accountIndex: undefined }))).not.toHaveProperty('accountIndex');
  });
});

describe('buildErrorMessage', () => {
  it('404 means Desktop predates the build route', () => {
    expect(buildErrorMessage(404, JSON.stringify({ error: 'Not found', path: TX_BUILD_PATH }), 'Litecoin')).toBe(
      'Update KeepKey Desktop to send Litecoin from the extension',
    );
  });

  it('423 is the locked-device message', () => {
    expect(buildErrorMessage(423, VAULT_LOCKED_MESSAGE, 'Litecoin')).toBe(VAULT_LOCKED_MESSAGE);
  });

  it.each([401, 403])('%i asks to re-pair', status => {
    expect(buildErrorMessage(status, JSON.stringify({ error: 'Unauthorized' }), 'Litecoin')).toMatch(/re-pair/i);
  });

  it.each([
    [400, 'Invalid LTC address', 'INVALID_ADDRESS'],
    [400, 'Memos are not supported for LTC sends from the extension', 'MEMO_UNSUPPORTED'],
    [422, 'Insufficient funds', 'BUILD_FAILED'],
    [501, 'This firmware only supports Bitcoin', undefined],
    [503, 'OFFLINE: transaction build is disabled in offline mode', undefined],
  ])('%i shows Desktop error text verbatim', (status, error, code) => {
    expect(buildErrorMessage(status, JSON.stringify({ error, code }), 'Litecoin')).toBe(error);
  });

  it('falls back to the raw body when it is not JSON, then to a generic line', () => {
    expect(buildErrorMessage(500, 'boom', 'Litecoin')).toBe('boom');
    expect(buildErrorMessage(500, '', 'Litecoin')).toBe(
      'KeepKey Desktop could not build the Litecoin transaction (500)',
    );
  });

  it('no status means Desktop was not reachable', () => {
    expect(buildErrorMessage(undefined, '', 'Litecoin')).toBe(VAULT_REQUIRED_MESSAGE);
  });
});

describe('toBuildError', () => {
  it('maps an HTTP error from readFromVault through buildErrorMessage', () => {
    const httpError = Object.assign(new Error(JSON.stringify({ error: 'Insufficient funds', code: 'BUILD_FAILED' })), {
      status: 422,
    });
    const err = toBuildError(httpError, 'Litecoin');
    expect(err.message).toBe('Insufficient funds');
    expect(err.code).toBe(4000);
  });

  it('a refused connection is "Desktop not running"', () => {
    expect(toBuildError(new TypeError('Failed to fetch'), 'Litecoin').message).toBe(VAULT_REQUIRED_MESSAGE);
  });

  it('a timeout stays a timeout error', () => {
    const err = toBuildError(new DOMException('signal timed out', 'TimeoutError'), 'Litecoin');
    expect(err.kind).toBe('timeout');
  });

  it('a missing pairing key keeps its own message', () => {
    const msg = 'Vault pairing is unavailable. Reconnect the extension to Vault.';
    expect(toBuildError(new Error(msg), 'Litecoin').message).toBe(msg);
  });
});

// The extension names the row (script type + account); Desktop builds from it.
// The build is checked against the row before any approval exists, so the
// extension never signs coins from an account other than the one on screen.
const utxoBuild = (summary: Record<string, unknown>, ...scriptTypes: string[]) => ({
  signRoute: '/utxo/sign-transaction' as const,
  signBody: {
    coin: 'Bitcoin',
    inputs: scriptTypes.map((scriptType, vout) => ({
      addressNList: [0x80000054, 0x80000000, 0x80000000, 0, 0],
      scriptType,
      amount: '10000',
      vout,
      txid: 'aa'.repeat(32),
      hex: '00',
    })),
    outputs: [{ address: 'bc1qrecipient', amount: '5000', addressType: 'spend' }],
    version: 1,
    locktime: 0,
  },
  summary: { to: 'bc1qrecipient', amount: '0.00005', fee: '0.00000226', symbol: 'BTC', ...summary },
});
const row = (scriptType: string, accountIndex: number) => toBuildRequest(BTC, formParams({ scriptType, accountIndex }));

describe('rowBuildMismatch', () => {
  it('accepts a build of exactly the selected row', () => {
    expect(
      rowBuildMismatch(row('p2pkh', 2), utxoBuild({ scriptType: 'p2pkh', accountIndex: 2 }, 'p2pkh'), 'Bitcoin'),
    ).toBeUndefined();
  });

  it('skips the check for a dApp transfer with no row', () => {
    expect(rowBuildMismatch(toBuildRequest(BTC, formParams()), utxoBuild({}, 'p2pkh'), 'Bitcoin')).toBeUndefined();
  });

  it.each([
    ['another script type', { scriptType: 'p2wpkh', accountIndex: 2 }],
    ['another account', { scriptType: 'p2pkh', accountIndex: 0 }],
  ])('refuses a build Desktop says is from %s', (_, summary) => {
    const message = rowBuildMismatch(row('p2pkh', 2), utxoBuild(summary, 'p2pkh'), 'Bitcoin');
    expect(message).toContain('Legacy Bitcoin account 2');
    expect(message).toContain('Nothing was signed');
  });

  it('refuses a build whose inputs are not the row script type, whatever the summary says', () => {
    const message = rowBuildMismatch(
      row('p2wpkh', 0),
      utxoBuild({ scriptType: 'p2wpkh', accountIndex: 0 }, 'p2wpkh', 'p2pkh'),
      'Bitcoin',
    );
    expect(message).toContain('Nothing was signed');
  });

  describe('Desktop that predates the scriptType field (summary has none)', () => {
    it('allows account 0 when every input is the row script type', () => {
      expect(rowBuildMismatch(row('p2wpkh', 0), utxoBuild({}, 'p2wpkh'), 'Bitcoin')).toBeUndefined();
    });

    it('asks to update Desktop for any other account', () => {
      expect(rowBuildMismatch(row('p2wpkh', 1), utxoBuild({}, 'p2wpkh'), 'Litecoin')).toBe(
        'Update KeepKey Desktop to send from this Litecoin account',
      );
    });

    it('asks to update Desktop when it spent another script type', () => {
      expect(rowBuildMismatch(row('p2pkh', 0), utxoBuild({}, 'p2wpkh'), 'Bitcoin')).toBe(
        'Update KeepKey Desktop to send from this Bitcoin account',
      );
    });
  });
});
