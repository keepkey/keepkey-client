import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ readFromVault: vi.fn(), addEvent: vi.fn(), signViaVault: vi.fn() }));
vi.mock('../vaultDeviceAccess', () => ({
  readFromVault: mocks.readFromVault,
  VAULT_LOCKED_MESSAGE: 'locked',
  isVaultLockedError: () => false,
}));
vi.mock('../wallet', () => ({ getSdk: () => ({}), signViaVault: mocks.signViaVault }));
vi.mock('@extension/storage', () => ({ requestStorage: { addEvent: mocks.addEvent } }));
import { handleCosmosRequest } from './cosmosHandler';
import { handleOsmosisRequest } from './osmosisHandler';
import { handleThorchainRequest } from './thorchainHandler';
import { handleMayaRequest } from './mayaHandler';
import { handleRippleRequest } from './rippleHandler';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn() } });
});
afterEach(() => vi.unstubAllGlobals());

describe('native account send pipeline', () => {
  it.each([
    ['cosmoshub-4', 'uatom', '/cosmos/sign-amino', handleCosmosRequest],
    ['osmosis-1', 'uosmo', '/osmosis/sign-amino', handleOsmosisRequest],
    ['thorchain-mainnet-v1', 'rune', '/thorchain/sign-amino-transfer', handleThorchainRequest],
    ['mayachain-mainnet-v1', 'cacao', '/mayachain/sign-amino-transfer', handleMayaRequest],
  ] as const)(
    '%s cannot create an approval or sign with a verified zero balance',
    async (chainId, denom, route, handler) => {
      const from = 'testsender';
      mocks.readFromVault.mockResolvedValue({
        signRoute: route,
        signBody: {
          signerAddress: from,
          signDoc: {
            chain_id: chainId,
            msgs: [{ value: { from_address: from, to_address: from, amount: [{ denom, amount: '1000' }] } }],
            fee: { amount: [{ denom, amount: '0' }] },
          },
        },
        summary: {
          to: from,
          amount: denom === 'cacao' ? '0.0000001' : denom === 'rune' ? '0.00001' : '0.001',
          fee: '0',
          symbol: denom,
        },
      });
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) =>
          Response.json(
            url.includes('spendable_balances')
              ? { balances: [] }
              : url.includes('thorchain')
                ? { native_tx_fee_rune: '2000000' }
                : { NATIVETRANSACTIONFEE: 2000000000 },
          ),
        ),
      );
      const approve = vi.fn();
      await expect(
        handler('transfer', [{ recipient: from, amount: { amount: '0.001' } }], {}, '', {}, approve),
      ).rejects.toThrow(/Insufficient/);
      expect(mocks.addEvent).not.toHaveBeenCalled();
      expect(approve).not.toHaveBeenCalled();
      expect(mocks.signViaVault).not.toHaveBeenCalled();
    },
  );

  it('XRP reserve-only funds cannot reach approval or signing', async () => {
    mocks.readFromVault.mockResolvedValue({
      signRoute: '/xrp/sign-transaction',
      signBody: {
        payment: { destination: 'rTo', amount: '1000' },
        tx: {
          value: {
            msg: [{ value: { from_address: 'rFrom', to_address: 'rTo', amount: [{ denom: 'drop', amount: '1000' }] } }],
            fee: { amount: [{ denom: 'drop', amount: '1000' }] },
          },
        },
      },
      summary: { to: 'rTo', amount: '0.001', fee: '0.001', symbol: 'XRP' },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) =>
        Response.json(
          JSON.parse(String(init.body)).method === 'server_state'
            ? { result: { state: { validated_ledger: { reserve_base: 1000000, reserve_inc: 200000, seq: 123 } } } }
            : {
                result: {
                  validated: true,
                  ledger_index: 123,
                  account_data: { Account: 'rFrom', Balance: '1000010', OwnerCount: 0 },
                },
              },
        ),
      ),
    );
    const approve = vi.fn();
    await expect(
      handleRippleRequest('transfer', [{ recipient: 'rTo', amount: { amount: '0.001' } }], {}, '', {}, approve),
    ).rejects.toThrow(/after account reserves/);
    expect(mocks.addEvent).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
    expect(mocks.signViaVault).not.toHaveBeenCalled();
  });
});
