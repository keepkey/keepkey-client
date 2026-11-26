import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPortfolioEntries } from './portfolioBalances';

// Exercise the actual runtime messages. Replace the device, gateway and unrelated worker services.
const eth = { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', networks: ['eip155:1'] };
vi.mock('./wallet', () => ({
  init: vi.fn(),
  isInitialized: () => true,
  isDeviceConnected: () => true,
  getConnectionState: () => ({}),
  getPubkeys: () => [eth],
  getAddressForNetwork: () => eth.address,
}));
vi.mock('./portfolioBalances', () => ({ fetchPortfolioEntries: vi.fn() }));
vi.mock('@extension/storage', () => ({
  requestStorage: { getEvents: async () => [] },
  exampleSidebarStorage: { get: async () => false },
  ethAccountsStorage: { getAccounts: async () => [] },
  accountsByNetworkStorage: { get: async () => ({}) },
  pubkeyStorage: { migrateFromVault: async () => false },
  web3ProviderStorage: { getWeb3Provider: async () => ({}) },
  blockchainStorage: { getAllBlockchains: async () => [] },
  customTokensStorageApi: { getAll: async () => [] },
}));
vi.mock('./chains/solanaHandler', () => ({ resetSolanaState: vi.fn(), prefetchSolanaAccounts: vi.fn() }));
vi.mock('./chains/tronHandler', () => ({ resetTronState: vi.fn(), prefetchTronPubkey: vi.fn() }));
vi.mock('./chains/tonHandler', () => ({ resetTonState: vi.fn(), prefetchTonAddress: vi.fn() }));
vi.mock('./chains/hiveHandler', () => ({
  resetHiveState: vi.fn(),
  getHiveAccountInfo: vi.fn(),
  getCachedHiveInfo: vi.fn(),
  buildHiveUiRows: vi.fn(),
  onHiveResolved: vi.fn(),
}));
vi.mock('./mcpBridge', () => ({ initMcpBridge: vi.fn() }));
vi.mock('./methods', () => ({}));
vi.mock('./swapHandler', () => ({}));
vi.mock('./swapEventStream', () => ({}));
vi.mock('./popup', () => ({}));
vi.mock('./swConsole', () => ({}));
vi.mock('webextension-polyfill', () => ({}));
vi.mock('../polyfills/process', () => ({}));

type Dispatch = (message: { type: string; networkId?: string }, sender: object, reply: (response: any) => void) => void;
let dispatch: Dispatch;
const message = (type: string, networkId?: string) =>
  new Promise<any>(resolve => dispatch({ type, networkId }, {}, resolve));
const fetchPortfolio = vi.mocked(fetchPortfolioEntries);

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  fetchPortfolio.mockReset();
  const storage = {
    get: async (_key: string, callback?: (items: object) => void) => {
      callback?.({});
      return {};
    },
    set: async () => {},
  };
  vi.stubGlobal('chrome', {
    storage: { local: storage, session: storage },
    tabs: { query: vi.fn() },
    action: { setIcon: vi.fn(), onClicked: { addListener: vi.fn() } },
    runtime: {
      onInstalled: { addListener: vi.fn() },
      onMessage: {
        addListener: (fn: Dispatch) => {
          dispatch = fn;
        },
      },
      sendMessage: async () => {},
    },
  });
  await import('./index');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('portfolio request volume', () => {
  it('opening discovery still runs when an earlier automatic read is in flight', async () => {
    const result = { entries: [], carried: [], error: null, lost: false };
    let finish!: (value: typeof result) => void;
    fetchPortfolio
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(result);
    const read = message('GET_APP_BALANCES');
    await vi.advanceTimersByTimeAsync(0);
    await message('ON_START');
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchPortfolio.mock.calls.map(([, , reason]) => reason)).toEqual(['automatic', 'wallet-open']);
    finish(result);
    await read;
  });

  it.each([{ entries: [] }, { entries: [{ caip: 'eip155:1/slip44:60', balance: '1', color: '#aaa' }] }])(
    'repeated opens and passive reads settle after one opening request (fixture %#)',
    async ({ entries }) => {
      fetchPortfolio.mockResolvedValue({ entries, carried: [], error: null, lost: false });
      for (let n = 0; n < 10; n++) {
        expect((await message('ON_START')).success).toBe(true);
        await vi.advanceTimersByTimeAsync(0);
        await message('GET_APP_BALANCES');
        await message('GET_BALANCE', 'eip155:137');
        await message('GET_CHARTS');
      }
      expect(fetchPortfolio.mock.calls.map(([, force, reason]) => [force, reason])).toEqual([[false, 'wallet-open']]);
      await message('REFRESH_ALL_BALANCES');
      expect(fetchPortfolio.mock.calls.map(([, force, reason]) => [force, reason])).toEqual([
        [false, 'wallet-open'],
        [true, 'manual'],
      ]);
    },
  );
});
