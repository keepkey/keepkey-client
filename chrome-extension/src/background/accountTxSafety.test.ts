import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertAffordableDesktopBuild } from './accountTxSafety';
import { XRP_NETWORK } from './accountChainReads';
import type { TxBuildResponse } from './chains/buildViaDesktop';

const ATOM = 'cosmos:cosmoshub-4';
const sender = 'cosmos1sender';
const makeBuild = (amount = '0.001', fee = '0.0075'): TxBuildResponse => ({
  signRoute: '/cosmos/sign-amino',
  signBody: {
    signerAddress: sender,
    signDoc: {
      chain_id: 'cosmoshub-4',
      msgs: [
        {
          type: 'cosmos-sdk/MsgSend',
          value: {
            from_address: sender,
            to_address: sender,
            amount: [{ denom: 'uatom', amount: '1000' }],
          },
        },
      ],
      fee: { amount: [{ denom: 'uatom', amount: '7500' }] },
    },
  },
  summary: { to: sender, amount, fee, symbol: 'ATOM' },
});
const balances = (amount: string) => ({ balances: [{ denom: 'uatom', amount }], pagination: { next_key: null } });
const fetchMock = vi.fn();
const reply = (body: unknown) => fetchMock.mockImplementation(async () => Response.json(body));
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});
const check = (build = makeBuild(), network = ATOM) => {
  vi.stubGlobal('fetch', fetchMock);
  return assertAffordableDesktopBuild(network, build);
};

describe('live account affordability before approval', () => {
  it('blocks the incident: the entire ATOM balance is the fee', async () => {
    reply(balances('7500'));
    await expect(check()).rejects.toThrow(/Insufficient ATOM.*Nothing was signed/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain(`/spendable_balances/${sender}`);
    expect(fetchMock.mock.calls[0][1].cache).toBe('no-store');
  });
  it('checks exact integer boundaries, allowing amount plus fee', async () => {
    reply(balances('8500'));
    await check();
    reply(balances('8499'));
    await expect(check()).rejects.toThrow(/Insufficient/);
  });
  it('treats an authoritative empty account as zero', async () => {
    reply({ balances: [], pagination: { next_key: null } });
    await expect(check()).rejects.toThrow(/Insufficient/);
  });
  it.each([
    {},
    { balances: null },
    { balances: [{ denom: 'uatom', amount: '-1' }] },
    { balances: [{ denom: 'uatom', amount: 'NaN' }] },
    { ...balances('99999'), pagination: { next_key: 'more' } },
    {
      balances: [
        { denom: 'uatom', amount: '9000' },
        { denom: 'uatom', amount: '9000' },
      ],
    },
  ])('fails closed on missing, malformed or incomplete balances (%j)', async data => {
    reply(data);
    await expect(check()).rejects.toThrow(/Cannot verify live/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('falls back after a failed read, without repeating the send', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(Response.json(balances('8500')));
    await check();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('refuses a provider outage instead of trusting portfolio cache', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(check()).rejects.toThrow(/Cannot verify live/);
  });
  it.each([
    (b: TxBuildResponse) => {
      b.summary.amount = '0.002';
    },
    (b: TxBuildResponse) => {
      b.summary.fee = '0.0005';
    },
    (b: TxBuildResponse) => {
      b.summary.to = 'someoneelse';
    },
    (b: TxBuildResponse) => {
      b.signBody.signDoc.chain_id = 'osmosis-1';
    },
    (b: TxBuildResponse) => {
      b.signBody.signerAddress = 'someoneelse';
    },
    (b: TxBuildResponse) => {
      b.signBody.signDoc.msgs.push(b.signBody.signDoc.msgs[0]);
    },
    (b: TxBuildResponse) => {
      b.signBody.signDoc.fee.amount[0].denom = 'uosmo';
    },
    (b: TxBuildResponse) => {
      b.signRoute = '/utxo/sign-transaction';
    },
  ])('refuses inconsistent signed data before reading funds', async mutate => {
    const b = makeBuild();
    mutate(b);
    await expect(check(b)).rejects.toThrow(/inconsistent/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('keeps precision above Number.MAX_SAFE_INTEGER', async () => {
    const b = makeBuild('9007199254.740993', '0.0075');
    b.signBody.signDoc.msgs[0].value.amount[0].amount = '9007199254740993';
    reply(balances('9007199254748492'));
    await expect(check(b)).rejects.toThrow(/Insufficient/);
    reply(balances('9007199254748493'));
    await check(b);
  });
  it('UTXO sends keep their existing builder checks', async () => {
    await check(makeBuild(), 'bip122:any');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('unknown account networks fail closed', async () => {
    await expect(check(makeBuild(), 'cosmos:unknown')).rejects.toThrow(/Cannot verify live/);
    await expect(check(makeBuild(), 'ripple:unknown')).rejects.toThrow(/Cannot verify live/);
  });
  it.each([
    ['thorchain', 'thorchain-mainnet-v1', 'rune', 8, '2000000', '/thorchain/sign-amino-transfer'],
    ['mayachain', 'mayachain-mainnet-v1', 'cacao', 10, '2000000000', '/mayachain/sign-amino-transfer'],
  ] as const)(
    '%s includes the current bank-layer fee and displays it',
    async (id, chainId, denom, decimals, bankFee, route) => {
      const b = makeBuild('1', '0');
      b.signRoute = route;
      b.signBody.signDoc.chain_id = chainId;
      b.signBody.signDoc.msgs[0].value.amount[0] = { denom, amount: String(10n ** BigInt(decimals)) };
      b.signBody.signDoc.fee.amount[0] = { denom, amount: '0' };
      fetchMock.mockImplementation(async (url: string) =>
        Response.json(
          url.includes('spendable_balances')
            ? { balances: [{ denom, amount: String(10n ** BigInt(decimals) + BigInt(bankFee)) }] }
            : id === 'thorchain'
              ? { native_tx_fee_rune: bankFee }
              : { NATIVETRANSACTIONFEE: Number(bankFee) },
        ),
      );
      await check(b, `cosmos:${chainId}`);
      expect(Number(b.summary.fee)).toBe(Number(bankFee) / 10 ** decimals);
      fetchMock.mockImplementation(async (url: string) =>
        Response.json(
          url.includes('spendable_balances')
            ? { balances: [{ denom, amount: String(10n ** BigInt(decimals)) }] }
            : id === 'thorchain'
              ? { native_tx_fee_rune: bankFee }
              : { NATIVETRANSACTIONFEE: Number(bankFee) },
        ),
      );
      await expect(check(b, `cosmos:${chainId}`)).rejects.toThrow(/Insufficient/);
    },
  );
});

describe('XRP reserve protection', () => {
  const xrpBuild = (): TxBuildResponse => ({
    signRoute: '/xrp/sign-transaction',
    summary: { to: 'rRecipient', amount: '0.001', fee: '0.001', symbol: 'XRP' },
    signBody: {
      payment: { amount: '1000', destination: 'rRecipient' },
      tx: {
        value: {
          msg: [
            {
              value: {
                from_address: 'rSender',
                to_address: 'rRecipient',
                amount: [{ denom: 'drop', amount: '1000' }],
              },
            },
          ],
          fee: { amount: [{ denom: 'drop', amount: '1000' }] },
        },
      },
    },
  });
  const rpcReply = (balance: string, owners: number, overrides = {}) =>
    fetchMock.mockImplementation(async (_: string, init: RequestInit) => {
      const req = JSON.parse(String(init.body));
      expect(['server_state', 'account_info']).toContain(req.method);
      if (req.method === 'server_state')
        return Response.json({
          result: { state: { validated_ledger: { reserve_base: 1000000, reserve_inc: 200000, seq: 123 } } },
        });
      expect(req.params[0]).toEqual({ account: 'rSender', ledger_index: 123 });
      return Response.json({
        result: {
          validated: true,
          ledger_index: 123,
          account_data: { Account: 'rSender', Balance: balance, OwnerCount: owners },
          ...overrides,
        },
      });
    });
  it('blocks the original reserve-only XRP account', async () => {
    rpcReply('1000010', 0);
    await expect(check(xrpBuild(), XRP_NETWORK)).rejects.toThrow(/after account reserves/);
  });
  it('accounts for all owner reserves with exact boundaries', async () => {
    rpcReply('1402000', 2);
    await check(xrpBuild(), XRP_NETWORK);
    rpcReply('1401999', 2);
    await expect(check(xrpBuild(), XRP_NETWORK)).rejects.toThrow(/Insufficient/);
  });
  it.each([
    { validated: false },
    { ledger_index: 122 },
    { account_data: { Balance: '9999999' } },
    { account_data: { Account: 'rOther', Balance: '9999999', OwnerCount: 0 } },
  ])('requires the requested validated account and ledger (%j)', async over => {
    rpcReply('9999999', 0, over);
    await expect(check(xrpBuild(), XRP_NETWORK)).rejects.toThrow(/Cannot verify live/);
  });
  it('checks the payment amount actually sent to the signer', async () => {
    const b = xrpBuild();
    b.signBody.payment.amount = '9999999';
    await expect(check(b, XRP_NETWORK)).rejects.toThrow(/inconsistent/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
