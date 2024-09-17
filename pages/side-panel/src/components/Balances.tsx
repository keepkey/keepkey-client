import React, { useState, useEffect } from 'react';
import { Flex, Spinner, Avatar, Box, Text, Badge, Card, Stack, Button } from '@chakra-ui/react';

const Balances = () => {
  const [balances, setBalances] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [assetContext, setAssetContext] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [app, setApp] = useState<any>({});

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
        console.log('GET_ASSETS response:', response);
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
        console.log('GET_APP_BALANCES response:', response);
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
        console.log('GET_ASSET_CONTEXT response:', response);
        if (response && response.assetContext) {
          setAssetContext(response.assetContext);
        }
      });
    };

    // Call the function to fetch data on component mount
    fetchAssetsAndBalances();
  }, []);

  const onSelect = (asset: any) => {
    console.log('Asset selected:', asset);
  };

  return (
    <Flex flex="1" overflowY="auto" width="100%">
      <Stack width="100%">
        {assetContext ? (
          <Asset usePioneer={app.usePioneer} onClose={() => setAssetContext(null)} asset={app?.assetContext} />
        ) : (
          <>
            {!assets || assets.length === 0 ? (
              <Flex justifyContent="center" alignItems="center" width="100%">
                <Spinner size="xl" />
                Loading....
              </Flex>
            ) : (
              <>
                {assets.map((asset: any, index: any) => (
                  <Card key={index} borderRadius="md" p={4} mb={1} width="100%">
                    <Flex align="center" width="100%">
                      <Avatar src={asset.icon} />
                      <Box ml={3} flex="1" minWidth="0">
                        <Text fontWeight="bold" isTruncated>
                          {asset.name}
                        </Text>
                        {balances
                          .filter((balance: any) => balance.caip === asset.caip)
                          .map((balance: any, index: any) => {
                            const { integer, largePart, smallPart } = formatBalance(balance.balance);
                            return (
                              <Text key={index}>
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
                                <Badge colorScheme="green">USD {formatUsd(balance.valueUsd)}</Badge>
                              </Text>
                            );
                          }).length === 0 ? (
                          <Spinner size="sm" />
                        ) : null}
                      </Box>
                      <Button ml="auto" onClick={() => onSelect(asset)} size="md">
                        Select
                      </Button>
                    </Flex>
                  </Card>
                ))}
              </>
            )}
          </>
        )}
      </Stack>
    </Flex>
  );
};

export default Balances;
