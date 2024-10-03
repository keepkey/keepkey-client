import React, { useState, useEffect } from 'react';
import { Flex, Spinner, Avatar, Box, Text, Badge, Card, Stack, Button } from '@chakra-ui/react';
import AssetSelect from './AssetSelect'; // Import AssetSelect component

const Balances = ({ setShowBack }: any) => {
  const [balances, setBalances] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [assetContext, setAssetContext] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAssetSelect, setShowAssetSelect] = useState(false); // New state to toggle between Balances and AssetSelect

  // Function to format the balance
  const formatBalance = (balance: string) => {
    const [integer, decimal] = balance.split('.');
    const largePart = decimal?.slice(0, 4);
    const smallPart = decimal?.slice(4, 6);
    return { integer, largePart, smallPart };
  };

  // Function to format USD value
  const formatUsd = (value: string) => {
    return parseFloat(value).toFixed(2);
  };

  // Fetch assets, balances, and asset context from background script
  useEffect(() => {
    const fetchAssetsAndBalances = () => {
      setLoading(true);

      // Fetch assets
      chrome.runtime.sendMessage({ type: 'GET_ASSETS' }, response => {
        if (chrome.runtime.lastError) {
          console.error('Error fetching assets:', chrome.runtime.lastError.message);
          setLoading(false);
          return;
        }
        if (response && response.assets) {
          setAssets(response.assets);
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
    .filter(asset => balances.find(balance => balance.caip === asset.caip)) // Only display assets with balances
    .sort((a: any, b: any) => {
      const balanceA = balances.find(balance => balance.caip === a.caip);
      const balanceB = balances.find(balance => balance.caip === b.caip);
      const valueUsdA = balanceA ? parseFloat(balanceA.valueUsd) : 0;
      const valueUsdB = balanceB ? parseFloat(balanceB.valueUsd) : 0;
      return valueUsdB - valueUsdA; // Sort in descending order by value in USD
    });

  if (showAssetSelect) {
    // If showAssetSelect is true, render the AssetSelect component
    return <AssetSelect modalSelected={() => setShowAssetSelect(false)} />;
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
                return (
                  <Card key={index} borderRadius="md" p={4} mb={1} width="100%">
                    <Flex align="center" width="100%">
                      <Avatar src={asset.icon} />
                      <Box ml={3} flex="1" minWidth="0">
                        <Text fontWeight="bold" isTruncated>
                          {asset.name}
                        </Text>
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
                          <Badge colorScheme="green">USD {formatUsd(balance?.valueUsd || '0.00')}</Badge>
                        </Text>
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
