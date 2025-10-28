import React, { useState, useEffect } from 'react';
import { VStack, HStack, Box, Text, Image, Spinner, Button, Flex, Badge } from '@chakra-ui/react';
import { FaCoins, FaSync, FaPlus } from 'react-icons/fa';

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
        color="gray.400"
        bg="rgba(255, 255, 255, 0.05)"
        borderRadius="md">
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
      bg="rgba(255, 255, 255, 0.1)"
      borderRadius="md"
      p="3px"
      position="relative"
      boxShadow="0 0 0 1px rgba(255, 255, 255, 0.15)">
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

  useEffect(() => {
    fetchTokens();
  }, [asset, networkId]);

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
    console.log('Token clicked:', token);
    // Send message to background to set asset context
    chrome.runtime.sendMessage(
      {
        type: 'SET_ASSET_CONTEXT',
        assetContext: {
          assets: {
            ...token,
            caip: token.caip,
            name: token.name || token.symbol,
            symbol: token.symbol,
            icon: token.icon,
            networkId: token.networkId,
            pubkeys: asset?.pubkeys || [],
          },
        },
      },
      response => {
        if (response?.success) {
          console.log('Asset context updated for token');
        } else {
          console.error('Failed to update asset context');
        }
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

  // Only show tokens for non-UTXO networks
  if (isUtxoNetwork) {
    return null;
  }

  return (
    <VStack align="stretch" gap={3} width="100%">
      {/* Header */}
      <Flex justify="space-between" align="center" mb={2}>
        <Text fontSize="md" fontWeight="bold" color="gray.700">
          {isEvmNetwork ? 'ERC-20 Tokens' : isCosmosNetwork ? 'IBC Tokens' : 'Tokens'} ({tokens.length})
        </Text>
        <Button
          size="sm"
          variant="ghost"
          colorScheme="blue"
          onClick={handleRefresh}
          isLoading={isRefreshing}
          leftIcon={<FaSync />}>
          Refresh
        </Button>
      </Flex>

      {/* Loading State */}
      {loading ? (
        <Flex justify="center" align="center" py={8}>
          <Spinner size="lg" color="blue.500" />
          <Text ml={3} color="gray.600">
            Loading tokens...
          </Text>
        </Flex>
      ) : tokens.length > 0 ? (
        /* Token List */
        <VStack align="stretch" gap={2}>
          {tokens.map((token: any, index: number) => {
            const tokenValueUsd = parseFloat(token.valueUsd || 0);
            const tokenBalance = parseFloat(token.balance || 0);

            return (
              <Box
                key={`${token.caip}-${index}`}
                p={3}
                bg="white"
                borderRadius="lg"
                borderWidth="1px"
                borderColor="gray.200"
                _hover={{
                  borderColor: 'blue.400',
                  bg: 'blue.50',
                  cursor: 'pointer',
                  transform: 'translateY(-2px)',
                  boxShadow: 'md',
                }}
                transition="all 0.2s"
                onClick={() => handleTokenClick(token)}>
                <Flex justify="space-between" align="center">
                  <HStack gap={3}>
                    <IconWithFallback src={token.icon} alt={token.name || token.symbol} boxSize="40px" />
                    <VStack align="flex-start" gap={0} spacing={0}>
                      <Text fontSize="sm" fontWeight="bold" color="gray.800">
                        {token.symbol || 'Unknown'}
                      </Text>
                      <Text fontSize="xs" color="gray.500">
                        {token.name || 'Unknown Token'}
                      </Text>
                    </VStack>
                  </HStack>

                  <VStack align="flex-end" gap={0} spacing={0}>
                    <Text fontSize="sm" color="green.600" fontWeight="medium">
                      ${formatUsd(tokenValueUsd)}
                    </Text>
                    <Text fontSize="xs" color="gray.500">
                      {tokenBalance.toFixed(6)} {token.symbol}
                    </Text>
                  </VStack>
                </Flex>
              </Box>
            );
          })}
        </VStack>
      ) : (
        /* Empty State */
        <VStack align="center" gap={4} py={8}>
          <Box
            w="60px"
            h="60px"
            borderRadius="full"
            bg="gray.100"
            display="flex"
            alignItems="center"
            justifyContent="center">
            <FaCoins color="gray" size="24px" />
          </Box>
          <VStack gap={2}>
            <Text fontSize="md" fontWeight="medium" color="gray.700">
              No Tokens Found
            </Text>
            <Text fontSize="sm" color="gray.500" textAlign="center" maxW="sm" px={4}>
              {isEvmNetwork
                ? "You don't have any ERC-20 tokens on this network yet."
                : isCosmosNetwork
                  ? "You don't have any IBC tokens on this network yet."
                  : "You don't have any tokens on this network yet."}
            </Text>
          </VStack>
          <Button size="sm" colorScheme="blue" onClick={handleRefresh} isLoading={isRefreshing} leftIcon={<FaSync />}>
            Discover Tokens
          </Button>
        </VStack>
      )}
    </VStack>
  );
};

export default Tokens;
