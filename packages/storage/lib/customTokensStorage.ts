import { createStorage, type BaseStorage, StorageType } from './base';

/**
 * Custom Token Interface
 * Represents a user-added token on a specific network
 */
export interface CustomToken {
  address: string; // Contract address (checksummed for EVM)
  symbol: string; // Token symbol (e.g., 'USDC')
  name: string; // Token name (e.g., 'USD Coin')
  decimals: number; // Token decimals (e.g., 18)
  caip: string; // CAIP identifier (e.g., 'eip155:1/erc20:0x...')
  networkId: string; // Network identifier (e.g., 'eip155:1')
  icon?: string; // Token icon URL
  coingeckoId?: string; // CoinGecko ID for price data
  addedAt?: number; // Timestamp when token was added
}

/**
 * Storage structure optimized for network-first lookups
 * Structure: { [networkId]: { [userAddress]: CustomToken[] } }
 *
 * This allows efficient queries like:
 * - Get all custom tokens for a network (regardless of user)
 * - Get all custom tokens for a user on a specific network
 * - Get all custom tokens for a user across all networks
 */
export type CustomTokensStorage = {
  [networkId: string]: {
    [userAddress: string]: CustomToken[];
  };
};

/**
 * Custom Tokens Storage
 * Stores user-added custom tokens with network-first structure
 */
const customTokensStorage = createStorage<CustomTokensStorage>(
  'custom-tokens-storage-key',
  {},
  {
    storageType: StorageType.Local,
    liveUpdate: true,
  },
);

/**
 * Storage API for Custom Tokens
 */
export const customTokensStorageApi = {
  /**
   * Get all custom tokens for a specific network and user
   */
  getTokensForNetworkAndUser: async (networkId: string, userAddress: string): Promise<CustomToken[]> => {
    const storage = await customTokensStorage.get();
    return storage[networkId]?.[userAddress] || [];
  },

  /**
   * Get all custom tokens for a network (across all users)
   */
  getTokensForNetwork: async (networkId: string): Promise<CustomToken[]> => {
    const storage = await customTokensStorage.get();
    const networkStorage = storage[networkId] || {};

    // Flatten all user tokens for this network
    const allTokens: CustomToken[] = [];
    Object.values(networkStorage).forEach(userTokens => {
      allTokens.push(...userTokens);
    });

    // Deduplicate by contract address
    const uniqueTokens = Array.from(new Map(allTokens.map(token => [token.address.toLowerCase(), token])).values());

    return uniqueTokens;
  },

  /**
   * Get all custom tokens for a user (across all networks)
   */
  getTokensForUser: async (userAddress: string): Promise<CustomToken[]> => {
    const storage = await customTokensStorage.get();
    const allTokens: CustomToken[] = [];

    // Iterate through all networks and collect user's tokens
    Object.values(storage).forEach(networkStorage => {
      const userTokens = networkStorage[userAddress];
      if (userTokens) {
        allTokens.push(...userTokens);
      }
    });

    return allTokens;
  },

  /**
   * Add a custom token for a specific user on a network
   */
  addToken: async (networkId: string, userAddress: string, token: Omit<CustomToken, 'addedAt'>): Promise<void> => {
    const storage = await customTokensStorage.get();

    // Initialize network if it doesn't exist
    if (!storage[networkId]) {
      storage[networkId] = {};
    }

    // Initialize user array if it doesn't exist
    if (!storage[networkId][userAddress]) {
      storage[networkId][userAddress] = [];
    }

    // Check if token already exists (by address)
    const existingIndex = storage[networkId][userAddress].findIndex(
      t => t.address.toLowerCase() === token.address.toLowerCase(),
    );

    const tokenWithTimestamp: CustomToken = {
      ...token,
      addedAt: Date.now(),
    };

    if (existingIndex >= 0) {
      // Update existing token
      storage[networkId][userAddress][existingIndex] = tokenWithTimestamp;
    } else {
      // Add new token
      storage[networkId][userAddress].push(tokenWithTimestamp);
    }

    await customTokensStorage.set(storage);
  },

  /**
   * Remove a custom token for a specific user on a network
   */
  removeToken: async (networkId: string, userAddress: string, tokenAddress: string): Promise<void> => {
    const storage = await customTokensStorage.get();

    if (!storage[networkId]?.[userAddress]) {
      return; // Nothing to remove
    }

    // Filter out the token
    storage[networkId][userAddress] = storage[networkId][userAddress].filter(
      token => token.address.toLowerCase() !== tokenAddress.toLowerCase(),
    );

    // Clean up empty structures
    if (storage[networkId][userAddress].length === 0) {
      delete storage[networkId][userAddress];
    }

    if (Object.keys(storage[networkId]).length === 0) {
      delete storage[networkId];
    }

    await customTokensStorage.set(storage);
  },

  /**
   * Remove all custom tokens for a user on a specific network
   */
  removeAllTokensForNetworkAndUser: async (networkId: string, userAddress: string): Promise<void> => {
    const storage = await customTokensStorage.get();

    if (storage[networkId]?.[userAddress]) {
      delete storage[networkId][userAddress];

      // Clean up empty network
      if (Object.keys(storage[networkId]).length === 0) {
        delete storage[networkId];
      }

      await customTokensStorage.set(storage);
    }
  },

  /**
   * Remove all custom tokens for a user (across all networks)
   */
  removeAllTokensForUser: async (userAddress: string): Promise<void> => {
    const storage = await customTokensStorage.get();

    // Remove user from all networks
    Object.keys(storage).forEach(networkId => {
      if (storage[networkId][userAddress]) {
        delete storage[networkId][userAddress];

        // Clean up empty network
        if (Object.keys(storage[networkId]).length === 0) {
          delete storage[networkId];
        }
      }
    });

    await customTokensStorage.set(storage);
  },

  /**
   * Clear all custom tokens (useful for testing/reset)
   */
  clearAll: async (): Promise<void> => {
    await customTokensStorage.set({});
  },

  /**
   * Get the entire storage object (for debugging/export)
   */
  getAll: async (): Promise<CustomTokensStorage> => {
    return await customTokensStorage.get();
  },

  /**
   * Subscribe to storage changes
   * Note: callback doesn't receive storage value, you need to call get() inside it
   */
  subscribe: (callback: () => void) => {
    return customTokensStorage.subscribe(callback);
  },
};

export default customTokensStorage;
