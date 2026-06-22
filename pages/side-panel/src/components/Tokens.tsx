import React, { useState, useEffect } from 'react';
import { VStack, HStack, Box, Text, Spinner, Button, Flex, Badge, IconButton } from '@chakra-ui/react';
import { FaCoins, FaSync, FaPlus, FaEyeSlash } from 'react-icons/fa';
import { customTokensStorageApi, type CustomToken } from '@extension/storage';
import { CustomTokenDialog } from './CustomTokenDialog';
import { AssetIcon } from './AssetIcon';

interface TokensProps {
  asset: any;
  networkId?: string;
}

export const Tokens = ({ asset, networkId }: TokensProps) => {
  const [tokens, setTokens] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCustomTokenDialogOpen, setIsCustomTokenDialogOpen] = useState(false);
  const [customTokens, setCustomTokens] = useState<CustomToken[]>([]);
  const [loadingTokenId, setLoadingTokenId] = useState<string | null>(null);
  // True when the background is discovering tokens (natives present, no tokens
  // yet) — lets us show "Discovering…" instead of a premature "No Tokens Found".
  const [discovering, setDiscovering] = useState(false);

  useEffect(() => {
    fetchTokens();
    loadCustomTokens();
    // Refresh token list when background pushes a balance update — otherwise
    // a user viewing the asset detail during a cold-start Solana refetch would
    // see stale "No tokens" after the background lands SPL tokens.
    const listener = (message: any) => {
      if (message?.type === 'BALANCES_UPDATED') fetchTokens();
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          // Background signals it kicked token discovery for a natives-only
          // cache — show the discovering state rather than a premature empty.
          setDiscovering(Boolean(response.discovering) && networkTokens.length === 0);
        }
        setLoading(false);
      });
    } catch (error) {
      console.error('Error fetching tokens:', error);
      setLoading(false);
    }
  };

  // Force a Pioneer /portfolio round-trip rather than just re-reading the
  // cache. Used by both the header Refresh button and the empty-state
  // Discover Tokens button — the empty case is the one that actually
  // matters: if the cold-start auto-flow missed SPL/TRC-20 discovery, a
  // plain GET_APP_BALANCES would just return the same empty cache. The
  // background pushes BALANCES_UPDATED on commit, which our useEffect
  // listener picks up to repaint, so we don't need to setTokens directly
  // from this response.
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await new Promise<void>(resolve => {
        chrome.runtime.sendMessage({ type: 'REFRESH_ALL_BALANCES' }, () => resolve());
      });
      await fetchTokens();
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  const handleTokenClick = (token: any) => {
    console.log('🪙 Token clicked:', token);
    console.log('   CAIP:', token.caip);
    console.log('   Symbol:', token.symbol);
    console.log('   Balance:', token.balance);

    // Set loading state for this specific token
    setLoadingTokenId(token.caip);

    // Send message to background to set asset context. Carry
    // accountIndex through from the parent asset — without it
    // GET_PUBKEY_CONTEXT falls back to scoped[0] and Receive/Send
    // silently regress to account 0 the moment a user drills into
    // a token from the asset detail view.
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
          token: true,
          pubkeys: asset?.pubkeys || [],
          accountIndex: asset?.accountIndex,
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

  // Permanently hide a token (e.g. a scam 'Mortal' with a fabricated USD value
  // that slips past the spam heuristics). Persists a tier-0 user override in the
  // background; the row vanishes immediately and stays gone across reloads.
  const handleHideToken = (e: React.MouseEvent, token: any) => {
    e.stopPropagation();
    if (!token?.caip) return;
    setTokens(prev => prev.filter(t => t.caip !== token.caip));
    chrome.runtime.sendMessage({ type: 'SET_TOKEN_VISIBILITY', caip: token.caip, status: 'hidden' }, () => {
      if (chrome.runtime.lastError) {
        console.error('Error hiding token:', chrome.runtime.lastError.message);
      }
    });
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
    <VStack align="stretch" gap={2} width="100%">
      {/* Header */}
      <Flex justify="space-between" align="center" mb={1}>
        <HStack spacing={1}>
          <Text fontSize="xs" fontWeight="semibold" color="kk.dim" textTransform="uppercase" letterSpacing="wider">
            {isEvmNetwork ? 'ERC-20' : isCosmosNetwork ? 'IBC' : 'Tokens'}
          </Text>
          <Text fontSize="xs" color="kk.faint">
            ({tokens.length})
          </Text>
        </HStack>
        <HStack gap={1}>
          {isEvmNetwork && (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setIsCustomTokenDialogOpen(true)}
              leftIcon={<FaPlus size={8} />}
              color="kk.dim"
              fontSize="xs"
              h="22px"
              px={2}
              _hover={{ bg: 'kk.surfaceHi', color: 'kk.text' }}>
              Add
            </Button>
          )}
          <Button
            size="xs"
            variant="ghost"
            onClick={handleRefresh}
            isLoading={isRefreshing}
            leftIcon={<FaSync size={8} />}
            color="kk.dim"
            fontSize="xs"
            h="22px"
            px={2}
            _hover={{ bg: 'kk.surfaceHi', color: 'kk.text' }}>
            Refresh
          </Button>
        </HStack>
      </Flex>

      {/* Loading State */}
      {loading ? (
        <Flex justify="center" align="center" py={8}>
          <Spinner size="lg" color="kk.accent" />
          <Text ml={3} color="kk.text">
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
              width: '4px',
            },
            '&::-webkit-scrollbar-track': {
              background: 'transparent',
            },
            '&::-webkit-scrollbar-thumb': {
              background: 'rgba(255, 255, 255, 0.15)',
              borderRadius: '4px',
              _hover: {
                background: 'rgba(255, 255, 255, 0.25)',
              },
            },
          }}>
          <VStack align="stretch" gap={1}>
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
                  role="group"
                  px={2}
                  py={1.5}
                  bg="kk.surface"
                  borderRadius="md"
                  borderWidth="1px"
                  borderColor="kk.line"
                  cursor={isLoading ? 'wait' : 'pointer'}
                  opacity={isLoading ? 0.6 : 1}
                  pointerEvents={isLoading ? 'none' : 'auto'}
                  _hover={{
                    bg: 'kk.surfaceHi',
                    borderColor: 'kk.lineHi',
                  }}
                  _active={{
                    transform: 'scale(0.99)',
                  }}
                  transition="all 0.15s"
                  onClick={() => handleTokenClick(token)}>
                  <Flex justify="space-between" align="center">
                    <HStack gap={2}>
                      {isLoading ? (
                        <Flex boxSize="28px" align="center" justify="center" bg="kk.surfaceHi" borderRadius="md">
                          <Spinner size="xs" color="kk.accent" />
                        </Flex>
                      ) : (
                        <AssetIcon src={token.icon} symbol={token.symbol} size={28} />
                      )}
                      <VStack align="flex-start" gap={0} spacing={0}>
                        <Text fontSize="xs" fontWeight="semibold" color="kk.text" lineHeight="1.3">
                          {token.symbol || 'Unknown'}
                        </Text>
                        <Text fontSize="2xs" color="kk.faint" lineHeight="1.3">
                          {isLoading ? 'Loading...' : token.name || 'Unknown Token'}
                        </Text>
                      </VStack>
                    </HStack>

                    <HStack gap={1} align="center">
                      <VStack align="flex-end" gap={0} spacing={0}>
                        <Text fontSize="xs" color="kk.good" fontWeight="medium" lineHeight="1.3">
                          ${formatUsd(tokenValueUsd)}
                        </Text>
                        <Text fontSize="2xs" color="kk.faint" lineHeight="1.3">
                          {tokenBalance.toFixed(6)} {token.symbol}
                        </Text>
                      </VStack>
                      <IconButton
                        aria-label="Hide token"
                        title="Hide this token"
                        icon={<FaEyeSlash size={11} />}
                        size="xs"
                        variant="ghost"
                        minW="auto"
                        h="22px"
                        color="whiteAlpha.400"
                        opacity={0}
                        _groupHover={{ opacity: 1 }}
                        _hover={{ color: 'whiteAlpha.900', bg: 'whiteAlpha.100' }}
                        onClick={e => handleHideToken(e, token)}
                      />
                    </HStack>
                  </Flex>
                </Box>
              );
            })}
          </VStack>
        </Box>
      ) : discovering ? (
        /* Discovering State — background is fetching this network's tokens */
        <Flex justify="center" align="center" direction="column" gap={3} py={8}>
          <Spinner size="md" color="kk.accent" />
          <Text color="kk.dim" fontSize="sm">
            Discovering tokens…
          </Text>
        </Flex>
      ) : (
        /* Empty State */
        <VStack align="center" gap={4} py={8}>
          <Box
            w="60px"
            h="60px"
            borderRadius="full"
            bg="kk.surface"
            display="flex"
            alignItems="center"
            justifyContent="center">
            <FaCoins color="rgba(255, 255, 255, 0.4)" size="24px" />
          </Box>
          <VStack gap={2}>
            <Text fontSize="md" fontWeight="medium" color="kk.text">
              No Tokens Found
            </Text>
            <Text fontSize="sm" color="kk.dim" textAlign="center" maxW="sm" px={4}>
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
              variant="ghost"
              onClick={handleRefresh}
              isLoading={isRefreshing}
              leftIcon={<FaSync />}
              bg="kk.surfaceHi"
              _hover={{ bg: 'kk.surfaceHi' }}>
              Discover Tokens
            </Button>
            {isEvmNetwork && (
              <Button size="sm" onClick={() => setIsCustomTokenDialogOpen(true)} leftIcon={<FaPlus />}>
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
