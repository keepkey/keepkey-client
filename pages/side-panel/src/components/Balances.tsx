import React, { useState, useEffect } from 'react';
import {
  Flex,
  Spinner,
  Avatar,
  Box,
  Text,
  Badge,
  Card,
  Stack,
  HStack,
  Skeleton,
  SkeletonCircle,
} from '@chakra-ui/react';
import { ChevronRightIcon } from '@chakra-ui/icons';
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
}

const Balances = ({ onSelectAsset }: BalancesProps) => {
  const [balances, setBalances] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAssetSelect, setShowAssetSelect] = useState(false);

  const formatBalance = (balance: string) => {
    const numericBalance = parseFloat(balance);
    const safeBalance = isNaN(numericBalance) ? '0' : balance;
    const [integer, decimal] = safeBalance.split('.');
    const largePart = decimal?.slice(0, 4) || '0000';
    const smallPart = decimal?.slice(4, 6) || '00';
    return { integer, largePart, smallPart };
  };

  const formatUsd = (value: string) => parseFloat(value).toFixed(2);

  // Fetch assets and balances on mount
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);

      // GET_ASSETS now includes both static and custom chains
      chrome.runtime.sendMessage({ type: 'GET_ASSETS' }, response => {
        if (response?.assets) {
          setAssets(response.assets);
        }
      });

      chrome.runtime.sendMessage({ type: 'GET_APP_BALANCES' }, response => {
        if (response?.balances) {
          setBalances(response.balances);
        }
        setLoading(false);
      });
    };

    fetchData();
  }, []);

  // Sort assets by total USD value descending
  const sortedAssets = [...assets].sort((assetA: any, assetB: any) => {
    const valueA = balances
      .filter(bal => bal.networkId === assetA.networkId)
      .reduce((s, bal) => s + parseFloat(bal.valueUsd || '0'), 0);
    const valueB = balances
      .filter(bal => bal.networkId === assetB.networkId)
      .reduce((s, bal) => s + parseFloat(bal.valueUsd || '0'), 0);
    return valueB - valueA;
  });

  if (showAssetSelect) {
    return <AssetSelect setShowBack={() => {}} setShowAssetSelect={setShowAssetSelect} />;
  }

  if (loading) {
    const SkeletonRow = ({ delay = 0 }: { delay?: number }) => (
      <Card
        borderRadius="lg"
        p={3}
        mb={2}
        width="100%"
        bg="rgba(255, 255, 255, 0.03)"
        border="1px solid"
        borderColor="whiteAlpha.100"
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
              <Skeleton height="14px" width="60px" borderRadius="sm" startColor="whiteAlpha.100" endColor="whiteAlpha.300" />
              <Skeleton height="14px" width="44px" borderRadius="full" startColor="whiteAlpha.100" endColor="whiteAlpha.200" />
            </HStack>
            <Skeleton mt={2} height="12px" width="96px" borderRadius="sm" startColor="whiteAlpha.100" endColor="whiteAlpha.300" />
          </Box>
          <Flex direction="column" align="flex-end" minW="80px">
            <Skeleton height="14px" width="56px" borderRadius="sm" startColor="whiteAlpha.100" endColor="whiteAlpha.300" />
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
          @keyframes kk-spin-cw {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          @keyframes kk-spin-ccw {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(-360deg); }
          }
          @keyframes kk-glow {
            0%, 100% {
              box-shadow: 0 0 18px 2px rgba(56, 178, 172, 0.25), 0 0 36px 6px rgba(56, 178, 172, 0.10);
              transform: scale(1);
            }
            50% {
              box-shadow: 0 0 28px 4px rgba(56, 178, 172, 0.45), 0 0 52px 10px rgba(56, 178, 172, 0.18);
              transform: scale(1.08);
            }
          }
          @keyframes kk-dot-pulse {
            0%, 100% { opacity: 0.4; transform: scale(0.85); }
            50% { opacity: 1; transform: scale(1.15); }
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
        <Flex
          direction="column"
          align="center"
          gap={3}
          pt={2}
          pb={5}
          position="relative"
          zIndex={2}>
          <Box position="relative" width="88px" height="88px">
            {/* Soft pulsing glow */}
            <Box
              position="absolute"
              top="50%"
              left="50%"
              width="56px"
              height="56px"
              borderRadius="full"
              transform="translate(-50%, -50%)"
              bg="rgba(56, 178, 172, 0.15)"
              sx={{ animation: 'kk-glow 2.4s ease-in-out infinite' }}
            />
            {/* Outer ring — clockwise, teal */}
            <Box
              position="absolute"
              inset={0}
              borderRadius="full"
              border="3px solid transparent"
              borderTopColor="teal.300"
              borderRightColor="teal.400"
              sx={{ animation: 'kk-spin-cw 1.4s cubic-bezier(0.5, 0, 0.5, 1) infinite' }}
            />
            {/* Middle ring — counter-clockwise, paler */}
            <Box
              position="absolute"
              top="10px"
              left="10px"
              right="10px"
              bottom="10px"
              borderRadius="full"
              border="2px solid transparent"
              borderBottomColor="teal.200"
              borderLeftColor="whiteAlpha.400"
              sx={{ animation: 'kk-spin-ccw 2.1s cubic-bezier(0.4, 0, 0.6, 1) infinite' }}
            />
            {/* Inner ring — clockwise, thin */}
            <Box
              position="absolute"
              top="22px"
              left="22px"
              right="22px"
              bottom="22px"
              borderRadius="full"
              border="1.5px solid transparent"
              borderTopColor="whiteAlpha.600"
              sx={{ animation: 'kk-spin-cw 0.9s linear infinite' }}
            />
            {/* Breathing center dot */}
            <Box
              position="absolute"
              top="50%"
              left="50%"
              width="10px"
              height="10px"
              borderRadius="full"
              transform="translate(-50%, -50%)"
              bg="teal.300"
              boxShadow="0 0 10px 2px rgba(56, 178, 172, 0.6)"
              sx={{ animation: 'kk-dot-pulse 1.2s ease-in-out infinite' }}
            />
          </Box>
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
          <Flex justifyContent="center" alignItems="center" width="100%" minH="40vh">
            <Text color="whiteAlpha.600">No assets found</Text>
          </Flex>
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
                  borderRadius="lg"
                  p={3}
                  mb={2}
                  width="100%"
                  bg="rgba(255, 255, 255, 0.03)"
                  border="1px solid"
                  borderColor="whiteAlpha.100"
                  _hover={{ bg: 'rgba(255, 255, 255, 0.06)', cursor: 'pointer' }}
                  onClick={() => onSelectAsset(asset)}
                  transition="all 0.2s">
                  <Flex align="center" width="100%">
                    <Avatar src={asset.icon} size="md" />
                    <Box ml={3} flex="1" minWidth="0">
                      <Flex align="center" gap={2}>
                        <Text fontWeight="semibold" fontSize="md" isTruncated color="white">
                          {asset.name}
                        </Text>
                        <Badge size="sm" colorScheme="gray" variant="subtle" fontSize="10px" px={2} borderRadius="full">
                          {chainName}
                        </Badge>
                      </Flex>
                      <HStack spacing={2} mt={0.5}>
                        <Text fontSize="md" color="white" fontWeight="medium">
                          {integer}.{largePart}
                          {largePart === '0000' && (
                            <Text as="span" fontSize="xs" color="whiteAlpha.600">
                              {smallPart}
                            </Text>
                          )}
                          <Text as="span" color="whiteAlpha.700" ml={1} fontSize="sm">
                            {asset.symbol}
                          </Text>
                        </Text>
                      </HStack>
                    </Box>
                    <Flex direction="column" align="flex-end" minW="80px">
                      <Text fontWeight="semibold" color="white" fontSize="md">
                        ${formatUsd(totalUsdValue.toString())}
                      </Text>
                    </Flex>
                    <ChevronRightIcon color="whiteAlpha.400" ml={2} />
                  </Flex>
                </Card>
              );
            })}

            <Flex
              align="center"
              justify="center"
              p={4}
              mt={2}
              borderRadius="lg"
              border="1px dashed"
              borderColor="whiteAlpha.200"
              _hover={{ borderColor: 'whiteAlpha.400', cursor: 'pointer' }}
              onClick={() => setShowAssetSelect(true)}
              transition="all 0.2s">
              <Text color="whiteAlpha.600" fontSize="sm">
                + Add Blockchain
              </Text>
            </Flex>
          </>
        )}
      </Stack>
    </Flex>
  );
};

export default Balances;
