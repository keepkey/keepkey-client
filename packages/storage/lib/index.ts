import { createStorage, StorageType, type BaseStorage, SessionAccessLevel } from './base';
import {
  keepKeyApiKeyStorage,
  pioneerKeyStorage,
  requestStorage,
  approvalStorage,
  completedStorage,
  assetContextStorage,
  web3ProviderStorage,
  maskingSettingsStorage,
  blockchainStorage,
  blockchainDataStorage,
  dappStorage,
} from './customStorage';
import { chainIdStorage } from './providerStorage';
import { exampleThemeStorage, exampleSidebarStorage } from './exampleThemeStorage';
import customTokensStorage, { customTokensStorageApi } from './customTokensStorage';
export type { CustomToken, CustomTokensStorage } from './customTokensStorage';
import { pubkeyStorage } from './pubkeyStorage';
export type { DeviceInfo, StoredPubkeys, PubkeyStorageType } from './pubkeyStorage';

export {
  chainIdStorage,
  pioneerKeyStorage,
  keepKeyApiKeyStorage,
  web3ProviderStorage,
  requestStorage,
  approvalStorage,
  completedStorage,
  maskingSettingsStorage,
  blockchainStorage,
  blockchainDataStorage,
  dappStorage,
  customTokensStorage,
  customTokensStorageApi,
  createStorage,
  StorageType,
  SessionAccessLevel,
  assetContextStorage,
  exampleThemeStorage,
  exampleSidebarStorage,
  pubkeyStorage,
};

export type { BaseStorage };
