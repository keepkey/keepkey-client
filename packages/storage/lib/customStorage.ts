import type { BaseStorage } from './base';
import { createStorage, StorageType } from './base';

type Event = {
  id: string;
  type: string;
  request: any;
  status: 'request' | 'approval' | 'completed';
  timestamp: string;
  unsignedTx: any;
  [key: string]: any; // Allow additional properties
};

type ApiKeyStorage = BaseStorage<string> & {
  saveApiKey: (apiKey: string) => Promise<void>;
  getApiKey: () => Promise<string | null>;
};

type EventStorage = BaseStorage<Event[]> & {
  addEvent: (event: Event) => Promise<boolean>;
  getEvents: () => Promise<Event[] | null>;
  getEventById: (id: string) => Promise<Event | null>;
  updateEventById: (id: string, updatedEvent: Partial<Event>) => Promise<boolean>;
  removeEventById: (id: string) => Promise<void>;
  clearEvents: () => Promise<void>;
};

type Web3ProviderStorage = BaseStorage<string> & {
  saveWeb3Provider: (provider: string) => Promise<void>;
  getWeb3Provider: () => Promise<string | null>;
  clearWeb3Provider: () => Promise<void>;
};

type AssetContext = {
  [key: string]: any;
};

type AssetContextStorage = BaseStorage<AssetContext> & {
  updateContext: (newContext: AssetContext) => Promise<void>;
  clearContext: () => Promise<void>;
};

type MaskingSettings = {
  enableMetaMaskMasking: boolean;
  enableXfiMasking: boolean;
  enableKeplrMasking: boolean;
  enablePhantomMasking: boolean;
};

type MaskingSettingsStorage = BaseStorage<MaskingSettings> & {
  setEnableMetaMaskMasking: (value: boolean) => Promise<void>;
  getEnableMetaMaskMasking: () => Promise<boolean>;
  setEnableXfiMasking: (value: boolean) => Promise<void>;
  getEnableXfiMasking: () => Promise<boolean>;
  setEnableKeplrMasking: (value: boolean) => Promise<void>;
  getEnableKeplrMasking: () => Promise<boolean>;
  setEnablePhantomMasking: (value: boolean) => Promise<void>;
  getEnablePhantomMasking: () => Promise<boolean>;
};

const TAG = ' | customStorage | ';

// Create API Key Storage
const createApiKeyStorage = (): ApiKeyStorage => {
  const storage = createStorage<string>('keepkey-api-key', '', {
    storageType: StorageType.Local,
    liveUpdate: true,
  });

  return {
    ...storage,
    saveApiKey: async (apiKey: string) => {
      await storage.set(() => apiKey);
    },
    getApiKey: async () => {
      return await storage.get();
    },
  };
};

export const keepKeyApiKeyStorage = createApiKeyStorage();

// Create Event Storage
const createEventStorage = (key: string): EventStorage => {
  const storage = createStorage<Event[]>(key, [], {
    storageType: StorageType.Local,
    liveUpdate: true,
  });

  return {
    ...storage,
    addEvent: async (event: Event): Promise<boolean> => {
      const tag = TAG + ' | addEvent | ';
      try {
        const eventWithTimestamp = { ...event, timestamp: new Date().toISOString() };
        console.log(tag, 'Adding event:', eventWithTimestamp);
        await storage.set(prev => [...prev, eventWithTimestamp]);
        const savedEvents = await storage.get();
        const isSaved = savedEvents ? savedEvents.some(e => e.id === eventWithTimestamp.id) : false;

        console.log(tag, 'Event saved successfully:', isSaved);
        return isSaved;
      } catch (error) {
        console.error(tag, 'Error saving event:', error);
        return false;
      }
    },
    getEvents: async () => {
      const tag = TAG + ' | getEvents | ';
      const events = await storage.get();
      console.log(tag, 'Retrieved events:', events);
      return events;
    },
    getEventById: async (id: string): Promise<Event | null> => {
      const tag = TAG + ' | getEventById | ';
      const events = await storage.get();
      const event = events ? events.find(event => event.id === id) : null;
      console.log(tag, `Event with id ${id}:`, event);
      return event || null;
    },
    updateEventById: async (id: string, updatedEvent: Partial<Event>): Promise<boolean> => {
      const tag = TAG + ' | updateEventById | ';
      try {
        const events = await storage.get();
        if (events) {
          const index = events.findIndex(event => event.id === id);
          if (index !== -1) {
            events[index] = { ...events[index], ...updatedEvent };
            await storage.set(() => events);
            console.log(tag, `Updated event with id ${id}.`);
            return true;
          } else {
            console.log(tag, `Event with id ${id} not found.`);
            return false;
          }
        } else {
          console.log(tag, 'No events found in storage.');
          return false;
        }
      } catch (error) {
        console.error(tag, 'Error updating event:', error);
        return false;
      }
    },
    removeEventById: async (id: string) => {
      const tag = TAG + ' | removeEventById | ';
      const events = await storage.get();
      if (events) {
        const updatedEvents = events.filter(event => event.id !== id);
        await storage.set(() => updatedEvents);
        console.log(tag, `Removed event with id ${id}. Updated events:`, updatedEvents);
      }
    },
    clearEvents: async () => {
      const tag = TAG + ' | clearEvents | ';
      await storage.set(() => []);
      console.log(tag, 'Cleared all events.');
    },
    subscribe: storage.subscribe,
  };
};

// Export Event Storages
export const requestStorage = createEventStorage('keepkey-requests');
export const approvalStorage = createEventStorage('keepkey-approvals');
export const completedStorage = createEventStorage('keepkey-completed');

// Create Asset Context Storage
const createAssetContextStorage = (): AssetContextStorage => {
  const storage = createStorage<AssetContext>(
    'keepkey-asset-context',
    {},
    {
      storageType: StorageType.Local,
      liveUpdate: true,
    },
  );

  return {
    ...storage,
    updateContext: async (newContext: AssetContext) => {
      // REPLACE, not merge. The previous `{...prev, ...newContext}` let
      // stale fields from an earlier asset (decimals, contractAddress,
      // token flags) leak into the new context on switch — e.g. a
      // user clicking TON after ETH would keep ETH's contract decimals
      // around and the Send page's token-detection would misfire.
      // Callers that want to update a single field should read-modify-
      // write explicitly.
      await storage.set(() => newContext);
    },
    clearContext: async () => {
      await storage.set(() => ({}));
    },
  };
};

export const assetContextStorage = createAssetContextStorage();

// Create Blockchain Storage
type BlockchainStorage = BaseStorage<string[]> & {
  getAllBlockchains: () => Promise<string[] | null>;
  addBlockchain: (blockchain: string) => Promise<void>;
  removeBlockchain: (blockchain: string) => Promise<void>;
};

const createBlockchainStorage = (): BlockchainStorage => {
  const storage = createStorage<string[]>('blockchains', [], {
    storageType: StorageType.Local,
    liveUpdate: true,
  });

  return {
    ...storage,
    getAllBlockchains: async () => {
      const blockchains = await storage.get();
      console.log(TAG, 'Retrieved blockchains:', blockchains);
      return blockchains;
    },
    addBlockchain: async (blockchain: string) => {
      const blockchains = await storage.get();
      if (!blockchains) {
        await storage.set(() => [blockchain]);
      } else if (!blockchains.includes(blockchain)) {
        await storage.set(prev => [...prev, blockchain]);
      }
      console.log(TAG, 'Added blockchain:', blockchain);
    },
    removeBlockchain: async (blockchain: string) => {
      const blockchains = await storage.get();
      if (blockchains && blockchains.includes(blockchain)) {
        const updatedBlockchains = blockchains.filter(b => b !== blockchain);
        await storage.set(() => updatedBlockchains);
        console.log(TAG, 'Removed blockchain:', blockchain);
      }
    },
  };
};

export const blockchainStorage = createBlockchainStorage();

// Blockchain Data Storage for Storing Additional Blockchain Metadata
type BlockchainData = {
  [chainId: string]: {
    name: string;
    symbol: string;
    decimals: number;
    explorerUrl: string;
    image: string;
    // Add any additional properties you need here
  };
};

// Define the extended type for BlockchainDataStorage
type BlockchainDataStorage = BaseStorage<BlockchainData> & {
  addBlockchainData: (chainId: string, data: BlockchainData[string]) => Promise<void>;
  getBlockchainData: (chainId: string) => Promise<BlockchainData[string] | null>;
  getBlockchainDataByArray: (chainIds: string[]) => Promise<(BlockchainData[string] | null)[]>;
};

const createBlockchainDataStorage = (): BlockchainDataStorage => {
  const storage = createStorage<BlockchainData>(
    'blockchainData',
    {},
    {
      storageType: StorageType.Local,
      liveUpdate: true,
    },
  );

  return {
    ...storage,
    addBlockchainData: async (chainId: string, data: BlockchainData[string]) => {
      const blockchainData = await storage.get();
      await storage.set(() => ({
        ...blockchainData,
        [chainId]: data,
      }));
      console.log(TAG, 'Added blockchain data for:', chainId);
    },
    getBlockchainData: async (chainId: string) => {
      const blockchainData = await storage.get();
      const data = blockchainData[chainId] || null;
      console.log(TAG, `Retrieved blockchain data for ${chainId}:`, data);
      return data;
    },
    getBlockchainDataByArray: async (chainIds: string[]) => {
      const blockchainData = await storage.get();
      const data = chainIds.map(chainId => blockchainData[chainId] || null);
      console.log(TAG, 'Retrieved blockchain data for chain array:', data);
      return data;
    },
    subscribe: storage.subscribe, // Ensure subscribe is included if needed
  };
};

export const blockchainDataStorage = createBlockchainDataStorage();

type Dapp = {
  name: string;
  icon: string;
  url: string;
  networks: string[];
};

type DappStorage = BaseStorage<Dapp[]> & {
  addDapp: (dapp: Dapp) => Promise<void>;
  getDapps: () => Promise<Dapp[] | null>;
  getDappsByNetwork: (network: string) => Promise<Dapp[]>;
};

// Create Dapp Storage
const createDappStorage = (): DappStorage => {
  const storage = createStorage<Dapp[]>('dapps', [], {
    storageType: StorageType.Local,
    liveUpdate: true,
  });

  return {
    ...storage,
    addDapp: async (dapp: Dapp) => {
      const currentDapps = await storage.get();
      await storage.set(() => [...(currentDapps || []), dapp]);
      console.log(TAG, 'Added dapp:', dapp);
    },
    getDapps: async () => {
      const dapps = await storage.get();
      console.log(TAG, 'Retrieved dapps:', dapps);
      return dapps;
    },
    getDappsByNetwork: async (network: string) => {
      const dapps = await storage.get();
      const filteredDapps = dapps ? dapps.filter(dapp => dapp.networks.includes(network)) : [];
      console.log(TAG, `Dapps with network ${network}:`, filteredDapps);
      return filteredDapps;
    },
  };
};

export const dappStorage = createDappStorage();

// Create Web3 Provider Storage
const createWeb3ProviderStorage = (): Web3ProviderStorage => {
  const storage = createStorage<string>('web3-provider', '', {
    storageType: StorageType.Local,
    liveUpdate: true,
  });

  return {
    ...storage,
    saveWeb3Provider: async (provider: string) => {
      await storage.set(() => provider);
    },
    getWeb3Provider: async () => {
      return await storage.get();
    },
    clearWeb3Provider: async () => {
      await storage.set(() => '');
    },
  };
};

export const web3ProviderStorage = createWeb3ProviderStorage();

// Create Masking Settings Storage
const createMaskingSettingsStorage = (): MaskingSettingsStorage => {
  const storage = createStorage<MaskingSettings>(
    'masking-settings',
    {
      // Default ON — modern dApps (CowSwap, swap aggregators, several
      // older sites) expect a window.ethereum with isMetaMask:true and
      // bail out of their connect flow without it. Modern dApps that
      // discover wallets via EIP-6963 still see KeepKey as itself.
      // Existing installs keep whatever they previously set.
      enableMetaMaskMasking: true,
      enableXfiMasking: false,
      enableKeplrMasking: false,
      // Default ON — legacy Solana dApps (and wallet-adapter-phantom, which
      // gates on window.solana.isPhantom) only see KeepKey when this shim is
      // mounted. Modern dApps still discover KeepKey via the Wallet Standard.
      enablePhantomMasking: true,
    },
    {
      storageType: StorageType.Local,
      liveUpdate: true,
    },
  );

  return {
    ...storage,
    setEnableMetaMaskMasking: async (value: boolean) => {
      await storage.set(prev => ({
        ...prev,
        enableMetaMaskMasking: value,
      }));
    },
    getEnableMetaMaskMasking: async () => {
      const settings = await storage.get();
      return settings.enableMetaMaskMasking;
    },
    setEnableXfiMasking: async (value: boolean) => {
      await storage.set(prev => ({
        ...prev,
        enableXfiMasking: value,
      }));
    },
    getEnableXfiMasking: async () => {
      const settings = await storage.get();
      return settings.enableXfiMasking;
    },
    setEnableKeplrMasking: async (value: boolean) => {
      await storage.set(prev => ({
        ...prev,
        enableKeplrMasking: value,
      }));
    },
    getEnableKeplrMasking: async () => {
      const settings = await storage.get();
      return settings.enableKeplrMasking;
    },
    setEnablePhantomMasking: async (value: boolean) => {
      await storage.set(prev => ({
        ...prev,
        enablePhantomMasking: value,
      }));
    },
    getEnablePhantomMasking: async () => {
      const settings = await storage.get();
      return settings.enablePhantomMasking;
    },
  };
};

export const maskingSettingsStorage = createMaskingSettingsStorage();

// ---- ETH Accounts Storage (persists derived account indices) ----
type EthAccountsStorage = BaseStorage<number[]> & {
  getAccounts: () => Promise<number[]>;
  addAccount: (index: number) => Promise<number[]>;
  removeAccount: (index: number) => Promise<number[]>;
};

const createEthAccountsStorage = (): EthAccountsStorage => {
  const storage = createStorage<number[]>('keepkey-eth-accounts', [0], {
    storageType: StorageType.Local,
    liveUpdate: true,
  });

  return {
    ...storage,
    getAccounts: async () => {
      const accounts = await storage.get();
      return accounts && accounts.length > 0 ? accounts : [0];
    },
    addAccount: async (index: number) => {
      const accounts = await storage.get();
      const current = accounts && accounts.length > 0 ? accounts : [0];
      if (!current.includes(index)) {
        const updated = [...current, index].sort((a, b) => a - b);
        await storage.set(() => updated);
        return updated;
      }
      return current;
    },
    removeAccount: async (index: number) => {
      if (index === 0) return [0]; // Never remove account 0
      const accounts = await storage.get();
      const current = accounts && accounts.length > 0 ? accounts : [0];
      const updated = current.filter(i => i !== index);
      await storage.set(() => (updated.length > 0 ? updated : [0]));
      return updated.length > 0 ? updated : [0];
    },
  };
};

export const ethAccountsStorage = createEthAccountsStorage();

// ---- Custom EVM Networks Storage ----
type CustomEvmNetwork = {
  networkId: string; // e.g. 'eip155:42220'
  chainId: number;
  name: string;
  rpc: string;
  symbol: string;
  explorerUrl?: string;
};

type CustomEvmNetworksStorage = BaseStorage<CustomEvmNetwork[]> & {
  getNetworks: () => Promise<CustomEvmNetwork[]>;
  addNetwork: (network: CustomEvmNetwork) => Promise<CustomEvmNetwork[]>;
  removeNetwork: (networkId: string) => Promise<CustomEvmNetwork[]>;
};

const createCustomEvmNetworksStorage = (): CustomEvmNetworksStorage => {
  const storage = createStorage<CustomEvmNetwork[]>('keepkey-custom-evm-networks', [], {
    storageType: StorageType.Local,
    liveUpdate: true,
  });

  return {
    ...storage,
    getNetworks: async () => {
      return (await storage.get()) || [];
    },
    addNetwork: async (network: CustomEvmNetwork) => {
      const current = (await storage.get()) || [];
      const exists = current.some(n => n.networkId === network.networkId);
      if (!exists) {
        const updated = [...current, network];
        await storage.set(() => updated);
        return updated;
      }
      return current;
    },
    removeNetwork: async (networkId: string) => {
      const current = (await storage.get()) || [];
      const updated = current.filter(n => n.networkId !== networkId);
      await storage.set(() => updated);
      return updated;
    },
  };
};

export const customEvmNetworksStorage = createCustomEvmNetworksStorage();

// Utility function to move an event between storages
const moveEvent = async (
  eventId: string,
  fromStorage: EventStorage,
  toStorage: EventStorage,
  newStatus: 'approval' | 'completed',
) => {
  const tag = TAG + ' | moveEvent | ';
  const event = await fromStorage.getEventById(eventId);
  if (!event) throw new Error(`Event with id ${eventId} not found`);

  const updatedEvent = { ...event, status: newStatus };
  await fromStorage.removeEventById(eventId);
  const isMoved = await toStorage.addEvent(updatedEvent);

  console.log(tag, `Moved event with id ${eventId} to ${newStatus}. Move successful:`, isMoved);
  return isMoved;
};

export const approveEvent = async (eventId: string) => {
  const tag = TAG + ' | approveEvent | ';
  console.log(tag, `Approving event with id ${eventId}`);
  return await moveEvent(eventId, requestStorage, approvalStorage, 'approval');
};

export const completeEvent = async (eventId: string) => {
  const tag = TAG + ' | completeEvent | ';
  console.log(tag, `Completing event with id ${eventId}`);
  return await moveEvent(eventId, approvalStorage, completedStorage, 'completed');
};
