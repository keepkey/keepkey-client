import React, { useState, useEffect } from 'react';
import { Flex, Spinner, Avatar, Box, Text, Badge, Card, Stack, Button } from '@chakra-ui/react';
import AssetSelect from './AssetSelect'; // Import AssetSelect component
import { blockchainDataStorage, blockchainStorage } from '@extension/storage';
import { COIN_MAP_LONG } from '@pioneer-platform/pioneer-coins';
import { NetworkIdToChain } from '@coinmasters/types';

const Balances = ({ setShowBack }: any) => {
  const [balances, setBalances] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [assetContext, setAssetContext] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAssetSelect, setShowAssetSelect] = useState(false); // New state to toggle between Balances and AssetSelect

  // Function to add custom (added) assets
  const addAddedAssets = async () => {
    try {
      const addedAssets = [];
      // Get enabled chains
      const savedChains = await blockchainStorage.getAllBlockchains();

      for (let i = 0; i < savedChains.length; i++) {
        const networkId = savedChains[i];
        const chainName = (COIN_MAP_LONG as any)[(NetworkIdToChain as any)[networkId]] || 'unknown';

        const blockchain = {
          networkId: networkId,
          name: chainName,
          image: `https://pioneers.dev/coins/${chainName}.png`,
          isEnabled: true,
        };

        // If the name is "unknown", fetch additional asset data
        if (chainName === 'unknown') {
          try {
            // Get from storage
            const assetData = await blockchainDataStorage.getBlockchainData(networkId);
            console.log('storage assetData:', assetData);

            if (assetData && assetData.name) {
              blockchain.name = assetData.name;
              blockchain.image = assetData.image || `https://pioneers.dev/coins/${assetData.name.toLowerCase()}.png`;
            }
          } catch (error) {
            console.error(`Error fetching asset data for networkId ${networkId}:`, error);
          }
        }

        const asset = {
          networkId: networkId,
          caip: networkId + '/slip44:60',
          name: blockchain.name,
          icon: blockchain.image,
          manual: true, // Flag to identify custom added assets
        };

        // Push to addedAssets array
        addedAssets.push(asset);
      }
      return addedAssets;
    } catch (e) {
      console.error(e);
      return [];
    }
  };

  // Function to format the balance
  const formatBalance = (balance: string) => {
    try {
      // Parse the balance to ensure it's a valid number
      const numericBalance = parseFloat(balance);

      // If balance is NaN, use 0
      const safeBalance = isNaN(numericBalance) ? '0' : balance;

      const [integer, decimal] = safeBalance.split('.');
      const largePart = decimal?.slice(0, 4) || '0000';
      const smallPart = decimal?.slice(4, 6) || '00';

      return { integer, largePart, smallPart };
    } catch (error) {
      console.error('Error in formatBalance:', error);
      // Fallback to zeroed format
      return { integer: '0', largePart: '0000', smallPart: '00' };
    }
  };

  // Function to format USD value
  const formatUsd = (value: string) => {
    return parseFloat(value).toFixed(2);
  };

  // Fetch assets, balances, and asset context from background script
  useEffect(() => {
    const fetchAssetsAndBalances = async () => {
      setLoading(true);

      // Fetch assets
      chrome.runtime.sendMessage({ type: 'GET_ASSETS' }, async response => {
        if (chrome.runtime.lastError) {
          console.error('Error fetching assets:', chrome.runtime.lastError.message);
          setLoading(false);
          return;
        }
        if (response && response.assets) {
          console.log(response.assets);

          const addedAssets = await addAddedAssets();
          const combined = response.assets.concat(addedAssets);
          setAssets(combined);
        } else {
          console.error('Error: No assets found in the response');
        }
      });

      // Fetch balances
      chrome.runtime.sendMessage({ type: 'GET_APP_BALANCES' }, response => {
        if (chrome.runtime.lastError) {
          console.error('Error fetching balances:', chrome.runtime.lastError.message);
          setLoading(false);
          return;
        }
        if (response && response.balances) {
          console.log('Balances: ', response.balances.length);
          setBalances(response.balances);
        } else {
          console.error('Error: No balances found in the response');
        }

        setLoading(false);
      });

      // Fetch asset context
      chrome.runtime.sendMessage({ type: 'GET_ASSET_CONTEXT' }, response => {
        if (chrome.runtime.lastError) {
          console.error('Error fetching asset context:', chrome.runtime.lastError.message);
          return;
        }
        if (response && response.assetContext) {
          setAssetContext(response.assetContext);
          setShowBack(true);
        }
      });
    };

    // Call the function to fetch data on component mount
    fetchAssetsAndBalances();
  }, []);

  const onSelect = (asset: any) => {
    console.log('Asset selected:', asset);
    try {
      chrome.runtime.sendMessage(
        {
          type: 'SET_ASSET_CONTEXT',
          asset,
        },
        response => {
          if (chrome.runtime.lastError) {
            console.error('Error sending message:', chrome.runtime.lastError);
          }
          console.log('SET_ASSET_CONTEXT response: ', response);
          if (response && response.error) {
            console.error('Error setting asset context:', response.error);
          } else {
            console.log('Asset context set successfully:', response);
          }
        },
      );
    } catch (e) {
      console.error(e);
    }
  };

  const sortedAssets = [...assets]
    .filter(asset => balances.find(balance => balance.caip === asset.caip) || asset.manual) // Include assets with balances or marked as manual (custom)
    .sort((a: any, b: any) => {
      const balanceA = balances.find(balance => balance.caip === a.caip);
      const balanceB = balances.find(balance => balance.caip === b.caip);
      const valueUsdA = balanceA ? parseFloat(balanceA.valueUsd) : 0;
      const valueUsdB = balanceB ? parseFloat(balanceB.valueUsd) : 0;
      return valueUsdB - valueUsdA; // Sort in descending order by value in USD
    });

  if (showAssetSelect) {
    // setShowBack(true)
    // If showAssetSelect is true, render the AssetSelect component
    return <AssetSelect setShowBack={setShowBack} setShowAssetSelect={setShowAssetSelect} />;
  }

  return (
    <Flex flex="1" overflowY="auto" width="100%">
      <Stack width="100%">
        {loading ? (
          <Flex justifyContent="center" alignItems="center" width="100%">
            <Spinner size="xl" />
            Loading....
          </Flex>
        ) : assetContext ? (
          <Asset />
        ) : (
          <>
            {sortedAssets.length === 0 ? (
              <Flex justifyContent="center" alignItems="center" width="100%">
                <Text>No assets found</Text>
              </Flex>
            ) : (
              sortedAssets.map((asset: any, index: any) => {
                const balance = balances.find(b => b.caip === asset.caip);
                const { integer, largePart, smallPart } = formatBalance(balance?.balance || '0.00');

                const chainBalances = balances.filter(b => b.networkId === asset.networkId);
                const totalUsdValue = chainBalances.reduce((sum, b) => sum + parseFloat(b.valueUsd || '0'), 0);
                const tokenCount = chainBalances.filter(b => !b.isNative).length;

                return (
                  <Card key={index} borderRadius="md" p={4} mb={1} width="100%">
                    <Flex align="center" width="100%">
                      <Avatar src={asset.icon} />
                      <Box ml={3} flex="1" minWidth="0">
                        <Text fontWeight="bold" isTruncated>
                          {asset.name} {asset.manual && <Badge colorScheme="purple">Added Asset</Badge>}
                        </Text>

                        {asset.manual ? (
                          // For custom added assets
                          <>
                            <Text color="gray.500">Click to view balance</Text>
                          </>
                        ) : (
                          // For regular assets with balance
                          <>
                            <Text as="span" fontSize="lg">
                              {integer}.
                              <Text as="span" fontSize="lg">
                                {largePart}
                              </Text>
                              {largePart === '0000' && (
                                <Text as="span" fontSize="sm">
                                  {smallPart}
                                </Text>
                              )}
                              <Badge ml={2} colorScheme="teal">
                                {asset.symbol}
                              </Badge>
                              <br />
                              {/*<Badge colorScheme="green">USD {formatUsd(balance?.valueUsd || '0.00')}</Badge>*/}
                              <Badge colorScheme="green">USD {formatUsd(totalUsdValue.toString())}</Badge>
                              {tokenCount > 1 && <Text fontSize="sm">Tokens: {tokenCount}</Text>}
                              {/*{tokenCount > 1 && <Text fontSize="sm" color="gray.500">Tokens: {tokenCount}</Text>}*/}
                            </Text>
                          </>
                        )}
                      </Box>
                      <Button ml="auto" onClick={() => onSelect(asset)} size="md">
                        Select
                      </Button>
                    </Flex>
                  </Card>
                );
              })
            )}

            {/* Add Blockchain Placeholder */}
            <Card borderRadius="md" p={4} mb={1} width="100%" bg="gray.100" border="2px dashed teal">
              <Flex align="center" width="100%" justifyContent="center">
                <Button colorScheme="teal" size="lg" onClick={() => setShowAssetSelect(true)}>
                  Add Blockchain
                </Button>
              </Flex>
            </Card>
          </>
        )}
      </Stack>
    </Flex>
  );
};

export default Balances;
