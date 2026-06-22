import React, { useState, useEffect } from 'react';
import { Flex, Box, Text, Card, Stack, HStack, Skeleton, SkeletonCircle } from '@chakra-ui/react';
import { AssetIcon } from './AssetIcon';
import { SpinningDevice } from './SpinningDevice';
import AssetSelect from './AssetSelect';
import { COIN_MAP_LONG, NetworkIdToChain } from '@extension/shared';

const getChainDisplayName = (networkId: string): string => {
  if (networkId?.includes('eip155:1/')) return 'Ethereum';
  if (networkId?.includes('eip155:8453')) return 'Base';
  if (networkId?.includes('eip155:137')) return 'Polygon';
  if (networkId?.includes('eip155:43114')) return 'Avalanche';
  if (networkId?.includes('eip155:56')) return 'BSC';
  if (networkId?.includes('eip155:10')) return 'Optimism';
  if (networkId?.includes('eip155:42161')) return 'Arbitrum';
  if (networkId?.includes('bip122:000000000019d6689c085ae165831e93')) return 'Bitcoin';
  if (networkId?.includes('cosmos:')) return 'Cosmos';
  if (networkId?.includes('cosmos:thorchain')) return 'THORChain';
  if (networkId?.includes('cosmos:mayachain')) return 'Maya';
  const chain = (NetworkIdToChain as any)[networkId?.split('/')[0]];
  return (COIN_MAP_LONG as any)[chain] || 'Unknown';
};

interface BalancesProps {
  onSelectAsset: (asset: any) => void;
  /** Controlled by SidePanel so the home button + dashboard-gating can see it. */
  showAddBlockchain: boolean;
  setShowAddBlockchain: (show: boolean) => void;
}

const Balances = ({ onSelectAsset, showAddBlockchain, setShowAddBlockchain }: BalancesProps) => {
  const [balances, setBalances] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const formatBalance = (balance: string) => {
    const numericBalance = parseFloat(balance);
    const safeBalance = isNaN(numericBalance) ? '0' : balance;
    const [integer, decimal] = safeBalance.split('.');
    const largePart = decimal?.slice(0, 4) || '0000';
    const smallPart = decimal?.slice(4, 6) || '00';
    return { integer, largePart, smallPart };
  };

  const formatUsd = (value: string) => parseFloat(value).toFixed(2);

  // Fetch assets once; refresh balances on mount and on background BALANCES_UPDATED push
  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_ASSETS' }, response => {
      if (response?.assets) setAssets(response.assets);
    });

    const refreshBalances = () => {
      chrome.runtime.sendMessage({ type: 'GET_APP_BALANCES' }, response => {
        if (response?.balances) setBalances(response.balances);
        setFetchError(response?.error ?? null);
        setLoading(false);
      });
    };

    refreshBalances();

    // Cold-start: background may land Solana + SPL tokens after the panel
    // mounts and paints a pre-Solana snapshot. Listen for BALANCES_UPDATED
    // pushes so the UI reflects the latest cache without the user having to
    // refresh manually.
    const listener = (message: any) => {
      if (message?.type === 'BALANCES_UPDATED') refreshBalances();
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  // Drive the dashboard from HOLDINGS, not the full static catalog: a chain
  // shows only if it has a positive balance (native or token). Keying off the
  // balance AMOUNT — not USD value — keeps a held asset visible even when its
  // price is missing/0. The complete catalog stays one tap away via
  // "+ Add blockchain", so empty chains no longer render as $0.00 rows.
  const heldNetworkIds = new Set(
    balances.filter(bal => parseFloat(bal.balance ?? bal.amount ?? '0') > 0).map(bal => bal.networkId),
  );
  const sortedAssets = [...assets]
    .filter((asset: any) => heldNetworkIds.has(asset.networkId))
    .sort((assetA: any, assetB: any) => {
      const valueA = balances
        .filter(bal => bal.networkId === assetA.networkId)
        .reduce((s, bal) => s + parseFloat(bal.valueUsd || '0'), 0);
      const valueB = balances
        .filter(bal => bal.networkId === assetB.networkId)
        .reduce((s, bal) => s + parseFloat(bal.valueUsd || '0'), 0);
      return valueB - valueA;
    });

  // Force-refresh after a failed load. REFRESH_ALL_BALANCES bypasses the cache.
  const retryFetch = () => {
    setLoading(true);
    setFetchError(null);
    chrome.runtime.sendMessage({ type: 'REFRESH_ALL_BALANCES' }, response => {
      if (response?.balances) setBalances(response.balances);
      setFetchError(response?.error ?? null);
      setLoading(false);
    });
  };

  if (showAddBlockchain) {
    return <AssetSelect setShowAssetSelect={setShowAddBlockchain} />;
  }

  if (loading) {
    const SkeletonRow = ({ delay = 0 }: { delay?: number }) => (
      <Card
        borderRadius="12px"
        p={3}
        mb={1.5}
        width="100%"
        bg="kk.surface"
        border="1px solid"
        borderColor="kk.line"
        position="relative"
        overflow="hidden"
        sx={{
          '&::after': {
            content: '""',
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(90deg, transparent 0%, rgba(56, 178, 172, 0.06) 45%, rgba(56, 178, 172, 0.14) 50%, rgba(56, 178, 172, 0.06) 55%, transparent 100%)',
            backgroundSize: '200% 100%',
            animation: 'kk-shimmer 2.2s ease-in-out infinite',
            animationDelay: `${delay}s`,
            pointerEvents: 'none',
          },
        }}>
        <Flex align="center" width="100%">
          <SkeletonCircle size="10" startColor="whiteAlpha.100" endColor="whiteAlpha.300" />
          <Box ml={3} flex="1" minWidth="0">
            <HStack spacing={2}>
              <Skeleton
                height="14px"
                width="60px"
                borderRadius="sm"
                startColor="whiteAlpha.100"
                endColor="whiteAlpha.300"
              />
              <Skeleton
                height="14px"
                width="44px"
                borderRadius="full"
                startColor="whiteAlpha.100"
                endColor="whiteAlpha.200"
              />
            </HStack>
            <Skeleton
              mt={2}
              height="12px"
              width="96px"
              borderRadius="sm"
              startColor="whiteAlpha.100"
              endColor="whiteAlpha.300"
            />
          </Box>
          <Flex direction="column" align="flex-end" minW="80px">
            <Skeleton
              height="14px"
              width="56px"
              borderRadius="sm"
              startColor="whiteAlpha.100"
              endColor="whiteAlpha.300"
            />
          </Flex>
        </Flex>
      </Card>
    );

    return (
      <Flex direction="column" width="100%" flex="1" position="relative" overflow="hidden">
        <style>{`
          @keyframes kk-shimmer {
            0% { background-position: -200% 0; }
            100% { background-position: 200% 0; }
          }
          @keyframes kk-breathe {
            0%, 100% { opacity: 0.035; transform: scale(1); }
            50% { opacity: 0.07; transform: scale(1.02); }
          }
          @keyframes kk-text-fade {
            0%, 100% { opacity: 0.45; letter-spacing: 0.25em; }
            50% { opacity: 0.85; letter-spacing: 0.35em; }
          }
        `}</style>

        {/* Subtle KK watermark behind everything */}
        <Box
          position="absolute"
          inset={0}
          pointerEvents="none"
          display="flex"
          alignItems="center"
          justifyContent="center"
          sx={{ animation: 'kk-breathe 4s ease-in-out infinite' }}>
          <Box
            as="img"
            src={chrome.runtime.getURL('kk-logo.png')}
            alt=""
            width="200px"
            borderRadius="2xl"
            filter="grayscale(1) brightness(1.4) contrast(0.9)"
          />
        </Box>

        {/* Hero spinner above the skeletons */}
        <Flex direction="column" align="center" gap={3} pt={2} pb={5} position="relative" zIndex={2}>
          <SpinningDevice scale={0.36} durationSeconds={11} label="FETCHING" />
          <Text
            color="whiteAlpha.700"
            fontSize="xs"
            textTransform="uppercase"
            fontWeight="medium"
            sx={{ animation: 'kk-text-fade 2.2s ease-in-out infinite' }}>
            Fetching balances
          </Text>
        </Flex>

        {/* Skeleton rows matching the real asset card layout */}
        <Stack width="100%" position="relative" zIndex={1}>
          <SkeletonRow delay={0} />
          <SkeletonRow delay={0.15} />
          <SkeletonRow delay={0.3} />
          <SkeletonRow delay={0.45} />
          <SkeletonRow delay={0.6} />
        </Stack>
      </Flex>
    );
  }

  return (
    <Flex flex="1" overflowY="auto" width="100%" direction="column">
      <Stack width="100%">
        {sortedAssets.length === 0 ? (
          fetchError ? (
            <Flex direction="column" justifyContent="center" alignItems="center" gap={3} width="100%" minH="30vh">
              <Text color="kk.text" fontSize="sm" fontWeight="medium">
                Couldn’t load balances
              </Text>
              <Text color="kk.faint" fontSize="xs" textAlign="center" maxW="240px">
                {fetchError}
              </Text>
              <Flex
                align="center"
                justify="center"
                gap={1.5}
                px={5}
                py={2}
                borderRadius="12px"
                border="1px solid"
                borderColor="kk.lineHi"
                _hover={{ bg: 'kk.surfaceHi', cursor: 'pointer' }}
                onClick={retryFetch}
                transition="background 0.15s">
                <Text color="kk.text" fontSize="xs">
                  Retry
                </Text>
              </Flex>
            </Flex>
          ) : (
            <Flex direction="column" justifyContent="center" alignItems="center" gap={4} width="100%" minH="30vh">
              <Text color="kk.faint" fontSize="sm">
                No assets yet — receive funds to get started
              </Text>
              <Flex
                align="center"
                justify="center"
                gap={1.5}
                px={4}
                py={2}
                borderRadius="12px"
                border="1px dashed"
                borderColor="kk.line"
                _hover={{ borderColor: 'kk.lineHi', cursor: 'pointer' }}
                onClick={() => setShowAddBlockchain(true)}
                transition="border-color 0.15s">
                <Text color="kk.faint" fontSize="xs">
                  + Add blockchain
                </Text>
              </Flex>
            </Flex>
          )
        ) : (
          <>
            {sortedAssets.map((asset: any, index: number) => {
              const chainBalances = balances.filter(b => b.networkId === asset.networkId);
              const totalUsdValue = chainBalances.reduce((sum, b) => sum + parseFloat(b.valueUsd || '0'), 0);

              const nativeBalances = chainBalances.filter(b => b.isNative === true || b.caip === asset.caip);
              let totalBalance = '0';
              if (nativeBalances.length > 0) {
                totalBalance = nativeBalances.reduce((acc, b) => acc + parseFloat(b.balance || '0'), 0).toString();
              } else {
                const balance = balances.find(b => b.caip === asset.caip);
                totalBalance = balance?.balance || '0';
              }

              const { integer, largePart, smallPart } = formatBalance(totalBalance);
              const chainName = getChainDisplayName(asset.networkId);

              return (
                <Card
                  key={index}
                  borderRadius="12px"
                  p={3}
                  mb={1.5}
                  width="100%"
                  bg="kk.surface"
                  border="1px solid"
                  borderColor="kk.line"
                  _hover={{ bg: 'kk.surfaceHi', cursor: 'pointer' }}
                  onClick={() => onSelectAsset(asset)}
                  transition="background 0.15s">
                  <Flex align="center" width="100%" gap={3}>
                    <AssetIcon src={asset.icon} symbol={asset.symbol} size={32} />
                    <Box flex="1" minWidth="0">
                      <Flex align="center" gap={2}>
                        <Text fontWeight={600} fontSize="sm" isTruncated color="kk.text">
                          {asset.name}
                        </Text>
                        <Text
                          as="span"
                          fontSize="10px"
                          px="6px"
                          py="1px"
                          borderRadius="full"
                          bg="whiteAlpha.100"
                          color="kk.faint"
                          letterSpacing="0.04em">
                          {chainName}
                        </Text>
                      </Flex>
                      <HStack spacing={1} mt="2px">
                        <Text fontSize="xs" color="kk.dim" className="mono">
                          {integer}.{largePart}
                          {largePart === '0000' && (
                            <Text as="span" color="kk.faint">
                              {smallPart}
                            </Text>
                          )}
                        </Text>
                        <Text as="span" color="kk.faint" fontSize="xs">
                          {asset.symbol}
                        </Text>
                      </HStack>
                    </Box>
                    <Text fontWeight={600} color="kk.text" fontSize="sm" whiteSpace="nowrap">
                      ${formatUsd(totalUsdValue.toString())}
                    </Text>
                  </Flex>
                </Card>
              );
            })}

            <Flex
              align="center"
              justify="center"
              gap={1.5}
              p={3}
              mt={1}
              borderRadius="12px"
              border="1px dashed"
              borderColor="kk.line"
              _hover={{ borderColor: 'kk.lineHi', cursor: 'pointer' }}
              onClick={() => setShowAddBlockchain(true)}
              transition="border-color 0.15s">
              <Text color="kk.faint" fontSize="xs">
                + Add blockchain
              </Text>
            </Flex>
          </>
        )}
      </Stack>
    </Flex>
  );
};

export default Balances;
