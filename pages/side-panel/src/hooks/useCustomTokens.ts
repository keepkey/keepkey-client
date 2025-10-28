import { useState, useEffect, useCallback } from 'react';
import { customTokensStorageApi, type CustomToken } from '@extension/storage/lib/customTokensStorage';

/**
 * Custom Tokens Hook for Browser Extension
 * Manages custom tokens using Chrome storage (local-first approach)
 */
export const useCustomTokens = (networkId?: string, userAddress?: string) => {
  const [customTokens, setCustomTokens] = useState<CustomToken[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Fetch custom tokens based on provided parameters
   * - If both networkId and userAddress: get tokens for specific user on specific network
   * - If only networkId: get all tokens for network (across all users)
   * - If only userAddress: get all tokens for user (across all networks)
   * - If neither: get empty array
   */
  const fetchCustomTokens = useCallback(async () => {
    if (!networkId && !userAddress) {
      setCustomTokens([]);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      let tokens: CustomToken[] = [];

      if (networkId && userAddress) {
        // Get tokens for specific user on specific network
        tokens = await customTokensStorageApi.getTokensForNetworkAndUser(networkId, userAddress);
        console.log(`📦 [useCustomTokens] Loaded ${tokens.length} custom tokens for ${userAddress} on ${networkId}`);
      } else if (networkId) {
        // Get all tokens for network (across all users)
        tokens = await customTokensStorageApi.getTokensForNetwork(networkId);
        console.log(`📦 [useCustomTokens] Loaded ${tokens.length} custom tokens for network ${networkId}`);
      } else if (userAddress) {
        // Get all tokens for user (across all networks)
        tokens = await customTokensStorageApi.getTokensForUser(userAddress);
        console.log(`📦 [useCustomTokens] Loaded ${tokens.length} custom tokens for user ${userAddress}`);
      }

      setCustomTokens(tokens);
    } catch (err: any) {
      console.error('❌ [useCustomTokens] Error fetching custom tokens:', err);
      setError(err.message || 'Failed to fetch custom tokens');
      setCustomTokens([]);
    } finally {
      setIsLoading(false);
    }
  }, [networkId, userAddress]);

  /**
   * Add a custom token
   * Requires both networkId and userAddress
   */
  const addCustomToken = useCallback(
    async (token: Omit<CustomToken, 'addedAt'>): Promise<{ success: boolean; message?: string }> => {
      if (!networkId || !userAddress) {
        const errorMsg = 'Cannot add token: networkId and userAddress are required';
        console.error('❌ [useCustomTokens]', errorMsg);
        setError(errorMsg);
        return { success: false, message: errorMsg };
      }

      // Validate token belongs to the correct network
      if (token.networkId !== networkId) {
        const errorMsg = `Token networkId (${token.networkId}) does not match current network (${networkId})`;
        console.error('❌ [useCustomTokens]', errorMsg);
        setError(errorMsg);
        return { success: false, message: errorMsg };
      }

      try {
        setIsLoading(true);
        setError(null);

        console.log('📝 [useCustomTokens] Adding custom token:', token);

        await customTokensStorageApi.addToken(networkId, userAddress, token);

        console.log('✅ [useCustomTokens] Token added successfully');

        // Refresh the token list
        await fetchCustomTokens();

        return { success: true };
      } catch (err: any) {
        console.error('❌ [useCustomTokens] Error adding custom token:', err);
        const errorMsg = err.message || 'Failed to add custom token';
        setError(errorMsg);
        return { success: false, message: errorMsg };
      } finally {
        setIsLoading(false);
      }
    },
    [networkId, userAddress, fetchCustomTokens],
  );

  /**
   * Remove a custom token
   * Requires both networkId and userAddress
   */
  const removeCustomToken = useCallback(
    async (tokenAddress: string): Promise<boolean> => {
      if (!networkId || !userAddress) {
        const errorMsg = 'Cannot remove token: networkId and userAddress are required';
        console.error('❌ [useCustomTokens]', errorMsg);
        setError(errorMsg);
        return false;
      }

      try {
        setIsLoading(true);
        setError(null);

        console.log('🗑️ [useCustomTokens] Removing custom token:', tokenAddress);

        await customTokensStorageApi.removeToken(networkId, userAddress, tokenAddress);

        console.log('✅ [useCustomTokens] Token removed successfully');

        // Refresh the token list
        await fetchCustomTokens();

        return true;
      } catch (err: any) {
        console.error('❌ [useCustomTokens] Error removing custom token:', err);
        setError(err.message || 'Failed to remove custom token');
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [networkId, userAddress, fetchCustomTokens],
  );

  /**
   * Check if a token already exists in custom tokens
   */
  const isTokenAdded = useCallback(
    (tokenAddress: string): boolean => {
      return customTokens.some(token => token.address.toLowerCase() === tokenAddress.toLowerCase());
    },
    [customTokens],
  );

  /**
   * Get a specific token by address
   */
  const getTokenByAddress = useCallback(
    (tokenAddress: string): CustomToken | undefined => {
      return customTokens.find(token => token.address.toLowerCase() === tokenAddress.toLowerCase());
    },
    [customTokens],
  );

  /**
   * Discover tokens for the current network by calling getCharts()
   * This will populate APP.balances with discovered tokens
   */
  const discoverTokens = useCallback(async (): Promise<{ success: boolean; message?: string }> => {
    if (!networkId) {
      const errorMsg = 'Cannot discover tokens: networkId is required';
      console.error('❌ [useCustomTokens]', errorMsg);
      setError(errorMsg);
      return { success: false, message: errorMsg };
    }

    try {
      setIsLoading(true);
      setError(null);

      console.log('🔍 [useCustomTokens] Discovering tokens for network:', networkId);

      // Call background script to run APP.getCharts([networkId])
      const response: any = await chrome.runtime.sendMessage({
        type: 'GET_CHARTS',
        networkIds: [networkId],
      });

      console.log('📦 [useCustomTokens] Token discovery response:', response);

      if (!response.success) {
        const errorMsg = response.error || 'Failed to discover tokens';
        setError(errorMsg);
        return { success: false, message: errorMsg };
      }

      console.log('✅ [useCustomTokens] Tokens discovered successfully');
      return { success: true, message: 'Tokens discovered successfully' };
    } catch (err: any) {
      console.error('❌ [useCustomTokens] Error discovering tokens:', err);
      const errorMsg = err.message || 'Failed to discover tokens';
      setError(errorMsg);
      return { success: false, message: errorMsg };
    } finally {
      setIsLoading(false);
    }
  }, [networkId]);

  /**
   * Validate token metadata from blockchain via background script
   * Calls APP.pioneer.LookupTokenMetadata in the background
   * Returns validated token data or null if invalid
   */
  const validateTokenMetadata = useCallback(
    async (
      contractAddress: string,
    ): Promise<{
      valid: boolean;
      token?: Omit<CustomToken, 'addedAt'>;
      error?: string;
    }> => {
      if (!networkId) {
        return { valid: false, error: 'Network ID is required' };
      }

      try {
        console.log('🔍 [useCustomTokens] Validating token metadata for:', contractAddress);

        // Call background script which will use APP.pioneer.LookupTokenMetadata
        const response: any = await chrome.runtime.sendMessage({
          type: 'LOOKUP_TOKEN_METADATA',
          networkId,
          contractAddress,
          userAddress, // Include to get balance too
        });

        console.log('📦 [useCustomTokens] Token metadata response:', response);

        if (!response.success) {
          return {
            valid: false,
            error: response.error || 'Failed to validate token',
          };
        }

        // Extract token data from response
        const tokenData = response.data?.data || response.data;

        if (!tokenData || !tokenData.symbol || !tokenData.name) {
          return {
            valid: false,
            error: 'Invalid token metadata - missing required fields',
          };
        }

        // Build the token object
        const token: Omit<CustomToken, 'addedAt'> = {
          address: contractAddress,
          symbol: tokenData.symbol,
          name: tokenData.name,
          decimals: tokenData.decimals || 18,
          networkId,
          caip: tokenData.caip || `${networkId}/erc20:${contractAddress.toLowerCase()}`,
          icon: tokenData.icon,
          coingeckoId: tokenData.coingeckoId,
        };

        console.log('✅ [useCustomTokens] Token validated:', token);

        return {
          valid: true,
          token,
        };
      } catch (err: any) {
        console.error('❌ [useCustomTokens] Error validating token:', err);
        return {
          valid: false,
          error: err.message || 'Failed to validate token',
        };
      }
    },
    [networkId, userAddress],
  );

  // Fetch custom tokens on mount and when networkId/userAddress changes
  useEffect(() => {
    fetchCustomTokens();
  }, [fetchCustomTokens]);

  // Subscribe to storage changes for real-time updates
  useEffect(() => {
    const unsubscribe = customTokensStorageApi.subscribe(() => {
      console.log('📡 [useCustomTokens] Storage updated, refreshing tokens');
      fetchCustomTokens();
    });

    return unsubscribe;
  }, [fetchCustomTokens]);

  return {
    // State
    customTokens,
    isLoading,
    error,

    // Actions
    addCustomToken,
    removeCustomToken,
    refreshCustomTokens: fetchCustomTokens,
    discoverTokens,

    // Utilities
    isTokenAdded,
    getTokenByAddress,
    validateTokenMetadata,
  };
};
