import React, { useState, useEffect } from 'react';
import { VStack, Avatar, Box, Stack, Flex, Text, Button, Spinner, Badge, Card, CardBody } from '@chakra-ui/react';
import { Transfer } from './Transfer';
import { Receive } from './Receive';

export function Asset() {
  const [activeTab, setActiveTab] = useState<'send' | 'receive' | null>(null);
  const [loading, setLoading] = useState(true);
  const [balances, setBalances] = useState<any[]>([]);
  const [pubkeys, setPubkeys] = useState<any[]>([]);
  const [asset, setAsset] = useState<any>(null); // Define asset state

  // Fetch asset context on initial load
  useEffect(() => {
    fetchAssetContext();
  }, []);

  // Subscribe to asset context updates
  useEffect(() => {
    const messageListener = (message: any) => {
      if (message.type === 'ASSET_CONTEXT_UPDATED' && message.assetContext) {
        console.log('ASSET_CONTEXT_UPDATED:', message.assetContext);
        setAsset(message.assetContext); // Update asset state
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);
    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, []);

  // Fetch balances and pubkeys when asset changes
  useEffect(() => {
    if (asset) {
      fetchBalancesAndPubkeys(asset);
    }
  }, [asset]);

  const fetchAssetContext = () => {
    setLoading(true); // Start loading when fetching asset context
    chrome.runtime.sendMessage({ type: 'GET_ASSET_CONTEXT' }, response => {
      if (chrome.runtime.lastError) {
        console.error('Error fetching asset context:', chrome.runtime.lastError.message);
        setLoading(false); // Stop loading on error
        return;
      }
      if (response && response.assets) {
        console.log('response.assets:', response.assets);
        setAsset(response.assets); // Set asset state
      } else {
        setLoading(false); // Stop loading if no asset is returned
      }
    });
  };

  const fetchBalancesAndPubkeys = (assetLoaded: any) => {
    // If the asset is an eip155 chain, fetch the balance manually
    if (assetLoaded.caip.includes('eip155')) {
      fetchEthereumBalance(assetLoaded);
    } else {
      // For other chains, fetch balances via GET_APP_BALANCES and filter by asset
      fetchAppBalances(assetLoaded);
    }
  };

  const fetchEthereumBalance = (assetLoaded: any) => {
    setLoading(true); // Start loading
    const addressEth = assetLoaded.pubkeys[0]?.address;
    if (!addressEth) {
      console.error('No Ethereum address found');
      setLoading(false);
      return;
    }

    chrome.runtime.sendMessage(
      {
        type: 'WALLET_REQUEST',
        requestInfo: {
          chain: 'ethereum',
          method: 'eth_getBalance',
          params: [addressEth, 'latest'],
        },
      },
      response => {
        if (chrome.runtime.lastError) {
          console.error('Error fetching balance:', chrome.runtime.lastError.message);
          setLoading(false);
          return;
        }
        if (response && response.result) {
          const balanceWei = BigInt(response.result); // Fetching balance as BigInt
          const balanceEth = Number(balanceWei) / 1e18; // Convert from Wei to Ether
          const formattedBalance = formatBalance(balanceEth); // Format the balance here

          setBalances([{ balance: formattedBalance, symbol: assetLoaded.symbol }]);
        } else {
          console.error('Invalid response for balance:', response);
        }
        setLoading(false); // Stop loading after fetching balance
      },
    );
  };

  const fetchAppBalances = (assetLoaded: any) => {
    setLoading(true); // Start loading
    chrome.runtime.sendMessage({ type: 'GET_APP_BALANCES' }, response => {
      if (chrome.runtime.lastError) {
        console.error('Error fetching balances:', chrome.runtime.lastError.message);
        setLoading(false);
        return;
      }
      if (response && response.balances) {
        // Filter balances by selected asset
        const filteredBalances = response.balances.filter((balance: any) => balance.caip === assetLoaded.caip);
        setBalances(filteredBalances);
      } else {
        console.error('Invalid response for balances:', response);
      }
      setLoading(false); // Stop loading after fetching balances
    });
  };

  // Updated function to format balance with 4 sigfigs or show 0.0000 if balance is zero
  const formatBalance = (balance: number) => {
    if (balance === 0) {
      return '0.0000';
    }
    // Convert the number to a string and ensure 4 significant figures
    return balance.toFixed(4);
  };

  const openUrl = (url: string) => {
    window.open(url, '_blank');
  };

  return (
    <Stack spacing={4} width="100%">
      <Card>
        <CardBody>
          {loading ? (
            <Flex justifyContent="center" p={5}>
              <Spinner size="xl" />
              <Text ml={3}>Loading...</Text>
            </Flex>
          ) : activeTab === null && asset ? (
            <>
              <Box textAlign="center">
                <Badge>caip: {asset.caip}</Badge>
              </Box>

              <Flex align="center" justifyContent="space-between" mb={4}>
                <Avatar size="xl" src={asset.icon} />
                <Box ml={3} flex="1">
                  <Text fontSize="lg" fontWeight="bold">
                    {asset.name}
                  </Text>
                  <Text fontSize="md" color="gray.500">
                    {asset.symbol}
                  </Text>
                </Box>
                <Box>
                  {balances.length > 0 ? (
                    balances.map((balance: any, index: any) => (
                      <Text key={index}>
                        <Text as="span" fontSize="lg">
                          {formatBalance(Number(balance.balance))}
                        </Text>
                        <Box ml={3} flex="1">
                          <Badge ml={2} colorScheme="teal">
                            ({balance.symbol || asset.symbol})
                          </Badge>
                        </Box>
                      </Text>
                    ))
                  ) : (
                    <Text>No balance available</Text>
                  )}
                </Box>
              </Flex>
              <Flex direction="column" align="center" mb={4} width="100%">
                <Button my={2} size="md" variant="outline" width="100%" onClick={() => setActiveTab('send')}>
                  Send {asset.name}
                </Button>
                <Button my={2} size="md" variant="outline" width="100%" onClick={() => setActiveTab('receive')}>
                  Receive {asset.name}
                </Button>
                {/* Transaction History Buttons */}
                {pubkeys
                  .filter((pubkey: any) => {
                    if (asset?.networkId?.startsWith('eip155')) {
                      return pubkey.networks.some((networkId: any) => networkId.startsWith('eip155'));
                    }
                    return pubkey.networks.includes(asset.networkId);
                  })
                  .map((pubkey: any, index: any) => (
                    <Button
                      key={index}
                      my={2}
                      size="md"
                      variant="outline"
                      width="100%"
                      onClick={() =>
                        openUrl(
                          pubkey.type === 'address'
                            ? asset.explorerAddressLink + '/' + pubkey.address
                            : asset.explorerXpubLink + '/' + pubkey.pubkey,
                        )
                      }>
                      <Box>
                        <Text>View Transaction History</Text>
                        <Badge>
                          <Text size="sm">({pubkey.note})</Text>
                        </Badge>
                      </Box>
                    </Button>
                  ))}
              </Flex>
            </>
          ) : activeTab === 'send' ? (
            <Transfer onClose={() => setActiveTab(null)} />
          ) : activeTab === 'receive' ? (
            <Receive onClose={() => setActiveTab(null)} />
          ) : (
            <Flex justifyContent="center" p={5}>
              <Text>No asset selected</Text>
            </Flex>
          )}
        </CardBody>
      </Card>
    </Stack>
  );
}

export default Asset;
