import React, { useState, useEffect } from 'react';
import { VStack, HStack, Box, Text, Image, Spinner, Button, Flex, Badge } from '@chakra-ui/react';
import { FaCoins, FaSync, FaPlus } from 'react-icons/fa';
import { customTokensStorageApi, type CustomToken } from '@extension/storage';
import { CustomTokenDialog } from './CustomTokenDialog';

interface TokensProps {
  asset: any;
  networkId?: string;
}

// Icon component with fallback for broken/empty images
const IconWithFallback = ({ src, alt, boxSize }: { src: string | null; alt: string; boxSize: string }) => {
  const [error, setError] = useState(false);

  const cleanUrl = React.useMemo(() => {
    if (!src || src.trim() === '') {
      return null;
    }

    if (src.includes(',')) {
      const urls = src
        .split(',')
        .map(u => u.trim())
        .filter(u => u.startsWith('http://') || u.startsWith('https://'));
      return urls[0] || null;
    }

    if (!src.startsWith('http://') && !src.startsWith('https://')) {
      return null;
    }

    return src;
  }, [src]);

  if (!cleanUrl || error) {
    return (
      <Box
        boxSize={boxSize}
        display="flex"
        alignItems="center"
        justifyContent="center"
        fontSize="lg"
        color="whiteAlpha.500"
        bg="rgba(255, 255, 255, 0.08)"
        borderRadius="md"
        border="1px solid"
        borderColor="whiteAlpha.200">
        <FaCoins />
      </Box>
    );
  }

  return (
    <Box
      boxSize={boxSize}
      display="flex"
      alignItems="center"
      justifyContent="center"
      bg="rgba(255, 255, 255, 0.08)"
      borderRadius="md"
      p="3px"
      position="relative"
      border="1px solid"
      borderColor="whiteAlpha.200">
      <Image
        src={cleanUrl}
        alt={alt}
        boxSize="100%"
        objectFit="contain"
        onError={() => {
          setError(true);
        }}
      />
    </Box>
  );
};

export const Tokens = ({ asset, networkId }: TokensProps) => {
  const [tokens, setTokens] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCustomTokenDialogOpen, setIsCustomTokenDialogOpen] = useState(false);
  const [customTokens, setCustomTokens] = useState<CustomToken[]>([]);
  const [loadingTokenId, setLoadingTokenId] = useState<string | null>(null);

  useEffect(() => {
    fetchTokens();
    loadCustomTokens();
  }, [asset, networkId]);

  // Load custom tokens from storage
  const loadCustomTokens = async () => {
    if (!networkId && !asset?.networkId) return;
    if (!asset?.address) return;

    const effectiveNetworkId = networkId || asset.networkId;
    try {
      const storedTokens = await customTokensStorageApi.getTokensForNetworkAndUser(effectiveNetworkId, asset.address);
      setCustomTokens(storedTokens);
    } catch (error) {
      console.error('Error loading custom tokens:', error);
    }
  };

  const fetchTokens = async () => {
    setLoading(true);
    try {
      // Request tokens from background script
      chrome.runtime.sendMessage({ type: 'GET_APP_BALANCES' }, response => {
        if (chrome.runtime.lastError) {
          console.error('Error fetching balances:', chrome.runtime.lastError.message);
          setLoading(false);
          return;
        }

        if (response && response.balances) {
          const effectiveNetworkId = networkId || asset?.networkId;

          // Filter tokens for the current network
          const networkTokens = response.balances.filter(
            (balance: any) =>
              balance.networkId === effectiveNetworkId &&
              balance.token === true &&
              parseFloat(balance.balance || '0') > 0,
          );

          // Sort by USD value
          networkTokens.sort((a: any, b: any) => {
            const valueA = parseFloat(a.valueUsd || 0);
            const valueB = parseFloat(b.valueUsd || 0);
            return valueB - valueA;
          });

          setTokens(networkTokens);
        }
        setLoading(false);
      });
    } catch (error) {
      console.error('Error fetching tokens:', error);
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchTokens();
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  const handleTokenClick = (token: any) => {
    console.log('🪙 Token clicked:', token);
    console.log('   CAIP:', token.caip);
    console.log('   Symbol:', token.symbol);
    console.log('   Balance:', token.balance);

    // Set loading state for this specific token
    setLoadingTokenId(token.caip);

    // Send message to background to set asset context
    // NOTE: Background expects `asset` not `assetContext.assets`
    chrome.runtime.sendMessage(
      {
        type: 'SET_ASSET_CONTEXT',
        asset: {
          ...token,
          caip: token.caip,
          name: token.name || token.symbol,
          symbol: token.symbol,
          icon: token.icon,
          networkId: token.networkId,
          contractAddress: token.contractAddress,
          decimals: token.decimals,
          token: true, // Mark as token
          pubkeys: asset?.pubkeys || [],
        },
      },
      response => {
        if (chrome.runtime.lastError) {
          console.error('❌ Error setting asset context:', chrome.runtime.lastError);
          setLoadingTokenId(null);
          return;
        }
        console.log('✅ Asset context updated for token:', response);
        // Keep loading state - it will be cleared when Asset component loads
        // We'll clear it after a timeout as fallback
        setTimeout(() => setLoadingTokenId(null), 2000);
      },
    );
  };

  const formatUsd = (value: number | null | undefined) => {
    if (value === null || value === undefined || isNaN(value)) return '0.00';
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(numValue)) return '0.00';
    return numValue.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  // Determine network type
  const isEvmNetwork = (networkId || asset?.networkId)?.startsWith('eip155:');
  const isCosmosNetwork = (networkId || asset?.networkId)?.startsWith('cosmos:');
  const isUtxoNetwork = (networkId || asset?.networkId)?.startsWith('bip122:');

  // Custom token handlers
  const handleAddCustomToken = async (token: Omit<CustomToken, 'addedAt'>) => {
    if (!networkId && !asset?.networkId) {
      return { success: false, message: 'Network ID not available' };
    }
    if (!asset?.address) {
      return { success: false, message: 'User address not available' };
    }

    const effectiveNetworkId = networkId || asset.networkId;
    try {
      await customTokensStorageApi.addToken(effectiveNetworkId, asset.address, token);
      await loadCustomTokens();
      await handleRefresh(); // Refresh to pick up the new token
      return { success: true };
    } catch (error: any) {
      console.error('Error adding custom token:', error);
      return { success: false, message: error.message || 'Failed to add token' };
    }
  };

  const handleRemoveCustomToken = async (tokenAddress: string) => {
    if (!networkId && !asset?.networkId) return false;
    if (!asset?.address) return false;

    const effectiveNetworkId = networkId || asset.networkId;
    try {
      await customTokensStorageApi.removeToken(effectiveNetworkId, asset.address, tokenAddress);
      await loadCustomTokens();
      await handleRefresh();
      return true;
    } catch (error) {
      console.error('Error removing custom token:', error);
      return false;
    }
  };

  const handleValidateToken = async (contractAddress: string) => {
    // Send validation request to background script
    return new Promise<{ valid: boolean; token?: Omit<CustomToken, 'addedAt'>; error?: string }>(resolve => {
      chrome.runtime.sendMessage(
        {
          type: 'VALIDATE_ERC20_TOKEN',
          contractAddress,
          networkId: networkId || asset?.networkId,
        },
        response => {
          if (chrome.runtime.lastError) {
            resolve({
              valid: false,
              error: chrome.runtime.lastError.message || 'Failed to validate token',
            });
            return;
          }

          if (response?.valid && response?.token) {
            resolve({
              valid: true,
              token: response.token,
            });
          } else {
            resolve({
              valid: false,
              error: response?.error || 'Invalid token contract',
            });
          }
        },
      );
    });
  };

  // Only show tokens for non-UTXO networks
  if (isUtxoNetwork) {
    return null;
  }

  return (
    <VStack align="stretch" gap={3} width="100%">
      {/* Header */}
      <Flex justify="space-between" align="center" mb={2}>
        <Text fontSize="md" fontWeight="bold" color="whiteAlpha.900">
          {isEvmNetwork ? 'ERC-20 Tokens' : isCosmosNetwork ? 'IBC Tokens' : 'Tokens'} ({tokens.length})
        </Text>
        <HStack gap={2}>
          {isEvmNetwork && (
            <Button
              size="sm"
              variant="ghost"
              colorScheme="whiteAlpha"
              onClick={() => setIsCustomTokenDialogOpen(true)}
              leftIcon={<FaPlus />}
              color="whiteAlpha.800"
              _hover={{ bg: 'whiteAlpha.200' }}>
              Add Token
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            colorScheme="whiteAlpha"
            onClick={handleRefresh}
            isLoading={isRefreshing}
            leftIcon={<FaSync />}
            color="whiteAlpha.800"
            _hover={{ bg: 'whiteAlpha.200' }}>
            Refresh
          </Button>
        </HStack>
      </Flex>

      {/* Loading State */}
      {loading ? (
        <Flex justify="center" align="center" py={8}>
          <Spinner size="lg" color="blue.400" />
          <Text ml={3} color="whiteAlpha.800">
            Loading tokens...
          </Text>
        </Flex>
      ) : tokens.length > 0 ? (
        /* Token List - Scrollable Container */
        <Box
          maxH="400px"
          overflowY="auto"
          pr={2}
          sx={{
            '&::-webkit-scrollbar': {
              width: '8px',
            },
            '&::-webkit-scrollbar-track': {
              background: 'rgba(255, 255, 255, 0.05)',
              borderRadius: '10px',
            },
            '&::-webkit-scrollbar-thumb': {
              background: 'rgba(255, 255, 255, 0.2)',
              borderRadius: '10px',
              _hover: {
                background: 'rgba(255, 255, 255, 0.3)',
              },
            },
          }}>
          <VStack align="stretch" gap={2}>
            {tokens.map((token: any, index: number) => {
              const tokenValueUsd = parseFloat(token.valueUsd || 0);
              const tokenBalance = parseFloat(token.balance || 0);

              // Extract a color from the token icon URL or use defaults
              const getTokenColor = (icon: string | null) => {
                if (!icon) return 'rgba(66, 153, 225, 0.6)'; // Default blue

                // Simple hash to generate consistent colors per token
                const hash = icon.split('').reduce((acc, char) => char.charCodeAt(0) + ((acc << 5) - acc), 0);
                const hue = Math.abs(hash) % 360;
                return `hsla(${hue}, 70%, 60%, 0.6)`;
              };

              const accentColor = getTokenColor(token.icon);
              const isLoading = loadingTokenId === token.caip;

              return (
                <Box
                  key={`${token.caip}-${index}`}
                  p={3}
                  bg="rgba(255, 255, 255, 0.05)"
                  borderRadius="lg"
                  borderWidth="2px"
                  borderColor="transparent"
                  position="relative"
                  cursor={isLoading ? 'wait' : 'pointer'}
                  opacity={isLoading ? 0.6 : 1}
                  pointerEvents={isLoading ? 'none' : 'auto'}
                  _hover={{
                    bg: 'rgba(255, 255, 255, 0.08)',
                    transform: 'translateY(-2px)',
                    boxShadow: `0 4px 20px ${accentColor}`,
                    borderColor: accentColor,
                  }}
                  _active={{
                    transform: 'translateY(0px) scale(0.98)',
                    boxShadow: `0 2px 10px ${accentColor}`,
                  }}
                  _before={{
                    content: '""',
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    borderRadius: 'lg',
                    padding: '2px',
                    background: `linear-gradient(135deg, ${accentColor}, transparent)`,
                    WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                    WebkitMaskComposite: 'xor',
                    maskComposite: 'exclude',
                    pointerEvents: 'none',
                    opacity: 0,
                    transition: 'opacity 0.2s',
                  }}
                  sx={{
                    '&:hover::before': {
                      opacity: 1,
                    },
                  }}
                  transition="all 0.2s"
                  onClick={() => handleTokenClick(token)}>
                  <Flex justify="space-between" align="center">
                    <HStack gap={3}>
                      {isLoading ? (
                        <Flex
                          boxSize="40px"
                          align="center"
                          justify="center"
                          bg="rgba(255, 255, 255, 0.08)"
                          borderRadius="md">
                          <Spinner size="sm" color="blue.400" />
                        </Flex>
                      ) : (
                        <IconWithFallback src={token.icon} alt={token.name || token.symbol} boxSize="40px" />
                      )}
                      <VStack align="flex-start" gap={0} spacing={0}>
                        <Text fontSize="sm" fontWeight="bold" color="whiteAlpha.900">
                          {token.symbol || 'Unknown'}
                        </Text>
                        <Text fontSize="xs" color="whiteAlpha.600">
                          {isLoading ? 'Loading...' : token.name || 'Unknown Token'}
                        </Text>
                      </VStack>
                    </HStack>

                    <VStack align="flex-end" gap={0} spacing={0}>
                      <Text fontSize="sm" color="green.400" fontWeight="medium">
                        ${formatUsd(tokenValueUsd)}
                      </Text>
                      <Text fontSize="xs" color="whiteAlpha.600">
                        {tokenBalance.toFixed(6)} {token.symbol}
                      </Text>
                    </VStack>
                  </Flex>
                </Box>
              );
            })}
          </VStack>
        </Box>
      ) : (
        /* Empty State */
        <VStack align="center" gap={4} py={8}>
          <Box
            w="60px"
            h="60px"
            borderRadius="full"
            bg="rgba(255, 255, 255, 0.05)"
            display="flex"
            alignItems="center"
            justifyContent="center">
            <FaCoins color="rgba(255, 255, 255, 0.4)" size="24px" />
          </Box>
          <VStack gap={2}>
            <Text fontSize="md" fontWeight="medium" color="whiteAlpha.900">
              No Tokens Found
            </Text>
            <Text fontSize="sm" color="whiteAlpha.600" textAlign="center" maxW="sm" px={4}>
              {isEvmNetwork
                ? "You don't have any ERC-20 tokens on this network yet."
                : isCosmosNetwork
                  ? "You don't have any IBC tokens on this network yet."
                  : "You don't have any tokens on this network yet."}
            </Text>
          </VStack>
          <HStack gap={3}>
            <Button
              size="sm"
              colorScheme="whiteAlpha"
              onClick={handleRefresh}
              isLoading={isRefreshing}
              leftIcon={<FaSync />}
              bg="rgba(255, 255, 255, 0.1)"
              _hover={{ bg: 'rgba(255, 255, 255, 0.2)' }}>
              Discover Tokens
            </Button>
            {isEvmNetwork && (
              <Button
                size="sm"
                colorScheme="blue"
                onClick={() => setIsCustomTokenDialogOpen(true)}
                leftIcon={<FaPlus />}
                bg="rgba(66, 153, 225, 0.2)"
                _hover={{ bg: 'rgba(66, 153, 225, 0.3)' }}>
                Add Token
              </Button>
            )}
          </HStack>
        </VStack>
      )}

      {/* Custom Token Dialog */}
      {isEvmNetwork && (
        <CustomTokenDialog
          isOpen={isCustomTokenDialogOpen}
          onClose={() => setIsCustomTokenDialogOpen(false)}
          networkId={networkId || asset?.networkId || ''}
          userAddress={asset?.address || ''}
          customTokens={customTokens}
          onAddToken={handleAddCustomToken}
          onRemoveToken={handleRemoveCustomToken}
          onValidateToken={handleValidateToken}
        />
      )}
    </VStack>
  );
};

export default Tokens;
