/*
    Network Context Storage
 */

import { BaseStorage, createStorage, StorageType } from './base';

type ChainId = string;

type ChainIdStorage = BaseStorage<ChainId> & {
  setChainId: (newChainId: ChainId) => Promise<void>;
  getChainId: () => Promise<ChainId>;
};

const storage = createStorage<ChainId>('chainId-storage-key', '1', {
  // Defaulting to '1' as an example chainId (Ethereum Mainnet)
  storageType: StorageType.Local,
  liveUpdate: true,
});

export const chainIdStorage: ChainIdStorage = {
  ...storage,
  setChainId: async (newChainId: ChainId) => {
    await storage.set(() => newChainId);
  },
  getChainId: async () => {
    return await storage.get();
  },
};
