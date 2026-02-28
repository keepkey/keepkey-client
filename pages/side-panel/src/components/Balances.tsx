import React, { useState, useEffect } from 'react';
import { Flex, Spinner, Avatar, Box, Text, Badge, Card, Stack, HStack } from '@chakra-ui/react';
import { ChevronRightIcon } from '@chakra-ui/icons';
import AssetSelect from './AssetSelect';
import { blockchainDataStorage, blockchainStorage } from '@extension/storage';
import { COIN_MAP_LONG, NetworkIdToChain, networkIdToIcon } from '@extension/shared';

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

  // Load custom-added chains from storage
  const loadAddedAssets = async (): Promise<any[]> => {
    try {
      const savedChains = await blockchainStorage.getAllBlockchains();
      const added: any[] = [];

      for (const networkId of savedChains) {
        const chainName = (COIN_MAP_LONG as any)[(NetworkIdToChain as any)[networkId]] || 'unknown';
        let name = chainName;
        let image = networkIdToIcon(networkId);

        if (chainName === 'unknown') {
          try {
            const assetData = await blockchainDataStorage.getBlockchainData(networkId);
            if (assetData?.name) {
              name = assetData.name;
              image = assetData.image || image;
            }
          } catch (e) {
            console.error(`Error fetching asset data for ${networkId}:`, e);
          }
        }

        added.push({
          networkId,
          caip: networkId + '/slip44:60',
          name,
          icon: image,
          manual: true,
        });
      }
      return added;
    } catch (e) {
      console.error(e);
      return [];
    }
  };

  // Fetch assets and balances on mount
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);

      chrome.runtime.sendMessage({ type: 'GET_ASSETS' }, async response => {
        if (response?.assets) {
          const addedAssets = await loadAddedAssets();
          const assetMap = new Map();
          response.assets.forEach((a: any) => assetMap.set(a.networkId, a));
          addedAssets.forEach((a: any) => {
            if (!assetMap.has(a.networkId)) assetMap.set(a.networkId, a);
          });
          setAssets(Array.from(assetMap.values()));
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

  return (
    <Flex flex="1" overflowY="auto" width="100%">
      <Stack width="100%">
        {loading ? (
          <Flex justifyContent="center" alignItems="center" width="100%">
            <Spinner size="xl" />
            <Text ml={2}>Loading...</Text>
          </Flex>
        ) : sortedAssets.length === 0 ? (
          <Flex justifyContent="center" alignItems="center" width="100%">
            <Text>No assets found</Text>
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
                        {asset.manual && (
                          <Badge size="sm" colorScheme="purple" fontSize="10px">
                            Custom
                          </Badge>
                        )}
                      </Flex>
                      {asset.manual ? (
                        <Text fontSize="sm" color="whiteAlpha.600">
                          Tap to view balance
                        </Text>
                      ) : (
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
                      )}
                    </Box>
                    {!asset.manual && (
                      <Flex direction="column" align="flex-end" minW="80px">
                        <Text fontWeight="semibold" color="white" fontSize="md">
                          ${formatUsd(totalUsdValue.toString())}
                        </Text>
                      </Flex>
                    )}
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
