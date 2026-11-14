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

  // Desktop loads Bitcoin account 0 at startup and adds further accounts only
  // when the user asks, so an extension row for account N answers 400
  // ACCOUNT_NOT_FOUND until the user adds it there.
  it('ACCOUNT_NOT_FOUND tells the user to add the account in Desktop', () => {
    const body = JSON.stringify({
      error: 'KeepKey Desktop has no Bitcoin account 2',
      code: 'ACCOUNT_NOT_FOUND',
      details: { code: 'ACCOUNT_NOT_FOUND' },
    });
    expect(buildErrorMessage(400, body, 'Bitcoin', 2)).toBe('Add Bitcoin account 2 in KeepKey Desktop, then try again');
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

  it('names the requested account on ACCOUNT_NOT_FOUND', () => {
    const httpError = Object.assign(
      new Error(JSON.stringify({ error: 'KeepKey Desktop has no Bitcoin account 1', code: 'ACCOUNT_NOT_FOUND' })),
      { status: 400 },
    );
    expect(toBuildError(httpError, 'Bitcoin', 1).message).toBe(
      'Add Bitcoin account 1 in KeepKey Desktop, then try again',
    );
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
const H = 0x80000000;
const PURPOSE: Record<string, number> = { p2pkh: 44, 'p2sh-p2wpkh': 49, p2wpkh: 84, p2tr: 86 };
// Desktop's account path [purpose', coin', account'] + chain/index.
const pathOf = (scriptType: string, account: number, chain = 0, index = 0) => [
  H + PURPOSE[scriptType],
  H,
  H + account,
  chain,
  index,
];
// Inputs of the given script types, all at `summary.accountIndex` (0 if
// absent), plus a change output back to the first input's account.
const utxoBuild = (summary: Record<string, unknown>, ...scriptTypes: string[]) => {
  const account = typeof summary.accountIndex === 'number' ? summary.accountIndex : 0;
  return {
    signRoute: '/utxo/sign-transaction' as const,
    signBody: {
      coin: 'Bitcoin',
      inputs: scriptTypes.map((scriptType, vout) => ({
        addressNList: pathOf(scriptType, account),
        scriptType,
        amount: '10000',
        vout,
        txid: 'aa'.repeat(32),
        hex: '00',
      })) as any[],
      outputs: [
        { address: 'bc1qrecipient', amount: '5000', addressType: 'spend' },
        {
          addressNList: pathOf(scriptTypes[0], account, 1, 3),
          scriptType: scriptTypes[0],
          isChange: true,
          amount: '4774',
          addressType: 'change',
        },
      ] as any[],
      version: 1,
      locktime: 0,
    },
    summary: { to: 'bc1qrecipient', amount: '0.00005', fee: '0.00000226', symbol: 'BTC', ...summary },
  };
};
const row = (scriptType: string, accountIndex: number) => toBuildRequest(BTC, formParams({ scriptType, accountIndex }));
const changeOf = (build: ReturnType<typeof utxoBuild>) => build.signBody.outputs[1];

describe('rowBuildMismatch', () => {
  it('accepts a build of exactly the selected row', () => {
    expect(
      rowBuildMismatch(row('p2pkh', 2), utxoBuild({ scriptType: 'p2pkh', accountIndex: 2 }, 'p2pkh'), 'Bitcoin'),
    ).toBeUndefined();
  });

  it('accepts a max send (no change output)', () => {
    const build = utxoBuild({ scriptType: 'p2wpkh', accountIndex: 1 }, 'p2wpkh');
    build.signBody.outputs.pop();
    expect(rowBuildMismatch(row('p2wpkh', 1), build, 'Bitcoin')).toBeUndefined();
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

  // The device signs whatever addressNList says, so the paths themselves must
  // be the row: purpose of its script type and its account.
  describe('derivation paths, whatever the summary and scriptType fields say', () => {
    const good = () => utxoBuild({ scriptType: 'p2wpkh', accountIndex: 2 }, 'p2wpkh', 'p2wpkh');

    it.each([
      ['an input at another account', (b: any) => (b.signBody.inputs[1].addressNList = pathOf('p2wpkh', 0))],
      ['an input at another purpose', (b: any) => (b.signBody.inputs[0].addressNList = pathOf('p2pkh', 2))],
      ['an input with no path', (b: any) => delete b.signBody.inputs[0].addressNList],
      ['an input with a short path', (b: any) => (b.signBody.inputs[0].addressNList = [H + 84, H])],
      ['change to another account', (b: any) => (changeOf(b).addressNList = pathOf('p2wpkh', 0, 1, 3))],
      ['change to another purpose', (b: any) => (changeOf(b).addressNList = pathOf('p2pkh', 2, 1, 3))],
      ['change of another script type', (b: any) => (changeOf(b).scriptType = 'p2pkh')],
      ['change with no path', (b: any) => delete changeOf(b).addressNList],
      [
        'a second owned output elsewhere',
        (b: any) =>
          b.signBody.outputs.push({ addressNList: pathOf('p2wpkh', 0, 1, 0), scriptType: 'p2wpkh', amount: '1' }),
      ],
    ])('refuses %s', (_, mutate) => {
      const build = good();
      mutate(build);
      expect(rowBuildMismatch(row('p2wpkh', 2), build, 'Bitcoin')).toContain('Nothing was signed');
    });

    it('the unmodified build passes', () => {
      expect(rowBuildMismatch(row('p2wpkh', 2), good(), 'Bitcoin')).toBeUndefined();
    });
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

    it('asks to update Desktop when an input or the change is at another account', () => {
      const input = utxoBuild({}, 'p2wpkh');
      input.signBody.inputs[0].addressNList = pathOf('p2wpkh', 1);
      const change = utxoBuild({}, 'p2wpkh');
      changeOf(change).addressNList = pathOf('p2wpkh', 1, 1, 0);
      for (const build of [input, change]) {
        expect(rowBuildMismatch(row('p2wpkh', 0), build, 'Bitcoin')).toBe(
          'Update KeepKey Desktop to send from this Bitcoin account',
        );
      }
    });
  });
});
