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
} from './customStorage';
import { chainIdStorage } from './providerStorage';
import { exampleThemeStorage, exampleSidebarStorage } from './exampleThemeStorage';

export {
  chainIdStorage,
  pioneerKeyStorage,
  keepKeyApiKeyStorage,
  web3ProviderStorage,
  requestStorage,
  approvalStorage,
  completedStorage,
  maskingSettingsStorage,
  createStorage,
  StorageType,
  SessionAccessLevel,
  assetContextStorage,
  exampleThemeStorage,
  exampleSidebarStorage,
};

export type { BaseStorage };
