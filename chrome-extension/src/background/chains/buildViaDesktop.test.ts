import { describe, expect, it } from 'vitest';
import { buildErrorMessage, toBuildError, toBuildRequest, TX_BUILD_PATH } from './buildViaDesktop';
import { VAULT_LOCKED_MESSAGE } from '../vaultDeviceAccess';
import { VAULT_REQUIRED_MESSAGE } from '../utils';
import { shortListSymbolToCaip } from '../chainConfig';

const LTC = shortListSymbolToCaip['LTC'];
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
    const body = toBuildRequest(LTC, formParams({ pubkeys: [{ pubkey: 'xpub' }], feeLevel: 5, xpubOverride: 'x' }));
    expect(Object.keys(body).sort()).toEqual(['accountIndex', 'amount', 'caip', 'isMax', 'to']);
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
