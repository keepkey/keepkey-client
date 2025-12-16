/*
 * Pubkey Storage for KeepKey Client Chrome Extension
 * Enables view-only mode by caching device pubkeys in chrome.storage.local
 */

import { BaseStorage, createStorage, StorageType } from './base';

// Storage key constants
const STORAGE_KEYS = {
  PUBKEYS: 'keepkey_client_pubkeys',
  DEVICE_INFO: 'keepkey_client_device_info',
  LAST_PAIRED: 'keepkey_client_last_paired',
  VERSION: 'keepkey_client_storage_version',
  CACHE_ENABLED: 'keepkey_client_cache_enabled',
  // Vault keys (read-only for migration)
  VAULT_PUBKEYS: 'keepkey_vault_pubkeys',
  VAULT_DEVICE_INFO: 'keepkey_vault_device_info',
} as const;

const STORAGE_VERSION = '1.0.0';

/**
 * Device information from KeepKey hardware
 */
export interface DeviceInfo {
  label: string;
  model?: string;
  deviceId?: string;
  features?: any;
}

/**
 * Complete stored pubkey data structure
 */
export interface StoredPubkeys {
  pubkeys: any[]; // Array of pubkey objects from Pioneer SDK
  deviceInfo: DeviceInfo; // Device metadata
  timestamp: number; // Unix timestamp of last save
  version: string; // Storage format version
}

/**
 * Extended storage type with custom methods
 */
export type PubkeyStorageType = BaseStorage<StoredPubkeys | null> & {
  savePubkeys: (pubkeys: any[], deviceInfo: DeviceInfo) => Promise<boolean>;
  loadPubkeys: () => Promise<StoredPubkeys | null>;
  clearPubkeys: () => Promise<boolean>;
  hasStoredPubkeys: () => Promise<boolean>;
  getDeviceInfo: () => Promise<DeviceInfo | null>;
  getLastPairedTime: () => Promise<number | null>;
  isCacheEnabled: () => Promise<boolean>;
  setCacheEnabled: (enabled: boolean) => Promise<boolean>;
  migrateFromVault: () => Promise<boolean>;
};

// Create individual storages
const pubkeysStorage = createStorage<StoredPubkeys | null>(STORAGE_KEYS.PUBKEYS, null, {
  storageType: StorageType.Local,
  liveUpdate: true,
});

const deviceInfoStorage = createStorage<DeviceInfo | null>(STORAGE_KEYS.DEVICE_INFO, null, {
  storageType: StorageType.Local,
  liveUpdate: true,
});

const lastPairedStorage = createStorage<number | null>(STORAGE_KEYS.LAST_PAIRED, null, {
  storageType: StorageType.Local,
  liveUpdate: true,
});

const cacheEnabledStorage = createStorage<boolean>(STORAGE_KEYS.CACHE_ENABLED, true, {
  storageType: StorageType.Local,
  liveUpdate: true,
});

/**
 * Factory function to create pubkey storage with custom methods
 * Follows the existing storage pattern in customStorage.ts
 */
const createPubkeyStorage = (): PubkeyStorageType => {
  return {
    ...pubkeysStorage,

    /**
     * Save pubkeys and device info to storage
     * @param pubkeys Array of pubkey objects from SDK
     * @param deviceInfo Device metadata
     * @returns Promise<boolean> Success status
     */
    savePubkeys: async (pubkeys: any[], deviceInfo: DeviceInfo): Promise<boolean> => {
      try {
        // Check if cache is enabled
        const enabled = await cacheEnabledStorage.get();
        if (!enabled) {
          console.log('ℹ️ [PubkeyStorage] Cache disabled - skipping save');
          return false;
        }

        const timestamp = Date.now();
        const data: StoredPubkeys = {
          pubkeys,
          deviceInfo,
          timestamp,
          version: STORAGE_VERSION,
        };

        // Atomic batch write using Promise.all
        await Promise.all([
          pubkeysStorage.set(() => data),
          deviceInfoStorage.set(() => deviceInfo),
          lastPairedStorage.set(() => timestamp),
        ]);

        console.log('✅ [PubkeyStorage] Saved', pubkeys.length, 'pubkeys');
        return true;
      } catch (error) {
        console.error('❌ [PubkeyStorage] Save failed:', error);
        return false;
      }
    },

    /**
     * Load stored pubkeys from storage
     * @returns Promise<StoredPubkeys | null> Stored data or null if not found
     */
    loadPubkeys: async (): Promise<StoredPubkeys | null> => {
      try {
        const data = await pubkeysStorage.get();

        if (!data) {
          console.log('ℹ️ [PubkeyStorage] No stored pubkeys found');
          return null;
        }

        // Version compatibility check
        if (data.version !== STORAGE_VERSION) {
          console.warn('⚠️ [PubkeyStorage] Storage version mismatch:', {
            stored: data.version,
            current: STORAGE_VERSION,
          });
          // Still try to use it (forward compatible)
        }

        console.log('✅ [PubkeyStorage] Loaded', data.pubkeys?.length || 0, 'pubkeys');
        return data;
      } catch (error) {
        console.error('❌ [PubkeyStorage] Load failed:', error);
        return null;
      }
    },

    /**
     * Clear all stored pubkey data
     * @returns Promise<boolean> Success status
     */
    clearPubkeys: async (): Promise<boolean> => {
      try {
        await Promise.all([
          pubkeysStorage.set(() => null),
          deviceInfoStorage.set(() => null),
          lastPairedStorage.set(() => null),
        ]);

        console.log('✅ [PubkeyStorage] Cleared all stored pubkeys');
        return true;
      } catch (error) {
        console.error('❌ [PubkeyStorage] Clear failed:', error);
        return false;
      }
    },

    /**
     * Check if pubkeys are stored
     * @returns Promise<boolean> True if pubkeys exist
     */
    hasStoredPubkeys: async (): Promise<boolean> => {
      const data = await pubkeysStorage.get();
      return !!data && !!data.pubkeys && data.pubkeys.length > 0;
    },

    /**
     * Get stored device info
     * @returns Promise<DeviceInfo | null> Device info or null
     */
    getDeviceInfo: async (): Promise<DeviceInfo | null> => {
      try {
        return await deviceInfoStorage.get();
      } catch (error) {
        console.error('❌ [PubkeyStorage] Get device info failed:', error);
        return null;
      }
    },

    /**
     * Get timestamp of last pairing
     * @returns Promise<number | null> Unix timestamp or null
     */
    getLastPairedTime: async (): Promise<number | null> => {
      try {
        return await lastPairedStorage.get();
      } catch (error) {
        console.error('❌ [PubkeyStorage] Get last paired time failed:', error);
        return null;
      }
    },

    /**
     * Check if caching is enabled
     * @returns Promise<boolean> True if enabled (default: true)
     */
    isCacheEnabled: async (): Promise<boolean> => {
      try {
        return await cacheEnabledStorage.get();
      } catch (error) {
        console.error('❌ [PubkeyStorage] Check cache enabled failed:', error);
        return true; // Default to enabled on error
      }
    },

    /**
     * Enable or disable caching
     * @param enabled Enable/disable flag
     * @returns Promise<boolean> Success status
     */
    setCacheEnabled: async (enabled: boolean): Promise<boolean> => {
      try {
        await cacheEnabledStorage.set(() => enabled);
        console.log(`✅ [PubkeyStorage] Cache ${enabled ? 'enabled' : 'disabled'}`);
        return true;
      } catch (error) {
        console.error('❌ [PubkeyStorage] Set cache enabled failed:', error);
        return false;
      }
    },

    /**
     * Migrate pubkeys from keepkey-vault's localStorage
     * One-time migration that runs automatically on extension start
     * Read-only operation - does not modify vault's data
     * @returns Promise<boolean> True if migration occurred
     */
    migrateFromVault: async (): Promise<boolean> => {
      try {
        // Check if we already have client data
        const hasClientData = await pubkeysStorage.get();
        if (hasClientData) {
          return false; // Already migrated or has data
        }

        // Try to read vault's localStorage (accessible from extension context)
        if (typeof window !== 'undefined' && window.localStorage) {
          const vaultPubkeysStr = window.localStorage.getItem(STORAGE_KEYS.VAULT_PUBKEYS);

          if (vaultPubkeysStr) {
            console.log('🔄 [PubkeyStorage] Migrating from vault...');

            const vaultData: StoredPubkeys = JSON.parse(vaultPubkeysStr);
            const vaultDeviceStr = window.localStorage.getItem(STORAGE_KEYS.VAULT_DEVICE_INFO);
            const deviceInfo = vaultDeviceStr ? JSON.parse(vaultDeviceStr) : { label: 'KeepKey' };

            // Use the savePubkeys method to store migrated data
            const success = await pubkeyStorage.savePubkeys(vaultData.pubkeys, deviceInfo);
            if (success) {
              console.log('✅ [PubkeyStorage] Migration successful');
            }
            return success;
          }
        }

        return false; // No vault data found
      } catch (error) {
        console.error('❌ [PubkeyStorage] Migration failed:', error);
        return false;
      }
    },
  };
};

// Export singleton instance
export const pubkeyStorage = createPubkeyStorage();
