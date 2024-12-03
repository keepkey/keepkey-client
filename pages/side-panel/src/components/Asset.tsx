import React, { useState, useEffect } from 'react';
import {
  VStack,
  Avatar,
  Box,
  Stack,
  Flex,
  Text,
  Button,
  Spinner,
  Badge,
  Card,
  CardBody,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
} from '@chakra-ui/react';
import { Transfer } from './Transfer';
import { Receive } from './Receive';
import AppStore from './AppStore'; // Import the new AppStore component

export function Asset() {
  const [activeTab, setActiveTab] = useState<'send' | 'receive' | null>(null);
  const [loading, setLoading] = useState(true);
  const [balances, setBalances] = useState<any[]>([]);
  const [pubkeys, setPubkeys] = useState<any[]>([]);
  const [asset, setAsset] = useState<any>(null);

  // Fetch asset context on initial load
  useEffect(() => {
    fetchAssetContext();
  }, []);

  // Subscribe to asset context updates
  useEffect(() => {
    const messageListener = (message: any) => {
      if (message.type === 'ASSET_CONTEXT_UPDATED' && message.assetContext) {
        console.log('ASSET_CONTEXT_UPDATED:', message.assetContext);
        setAsset(message.assetContext);
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
    setLoading(true);
    chrome.runtime.sendMessage({ type: 'GET_ASSET_CONTEXT' }, response => {
      if (chrome.runtime.lastError) {
        console.error('Error fetching asset context:', chrome.runtime.lastError.message);
        setLoading(false);
        return;
      }
      if (response && response.assets) {
        console.log('response.assets:', response.assets);
        setAsset(response.assets);
      } else {
        setLoading(false);
      }
    });
  };

  const fetchBalancesAndPubkeys = (assetLoaded: any) => {
    if (assetLoaded.caip.includes('eip155')) {
      fetchEthereumBalance(assetLoaded);
    } else {
      fetchAppBalances(assetLoaded);
    }
  };

  const fetchEthereumBalance = (assetLoaded: any) => {
    setLoading(true);
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
          const balanceWei = BigInt(response.result);
          const balanceEth = Number(balanceWei) / 1e18;
          const formattedBalance = formatBalance(balanceEth);

          setBalances([{ balance: formattedBalance, symbol: assetLoaded.symbol }]);
        } else {
          console.error('Invalid response for balance:', response);
        }
        setLoading(false);
      },
    );
  };

  const fetchAppBalances = (assetLoaded: any) => {
    setLoading(true);
    chrome.runtime.sendMessage({ type: 'GET_APP_BALANCES' }, response => {
      if (chrome.runtime.lastError) {
        console.error('Error fetching balances:', chrome.runtime.lastError.message);
        setLoading(false);
        return;
      }
      if (response && response.balances) {
        let filteredBalances = response.balances.filter((balance: any) => balance.caip === assetLoaded.caip);

        //if balances > 1 then sum all balances
        if (filteredBalances.length > 1) {
          const totalBalance = filteredBalances.reduce((acc, balance) => acc + Number(balance.balance), 0);
          filteredBalances = [{ balance: totalBalance, symbol: assetLoaded.symbol }];
        }

        setBalances(filteredBalances);
      } else {
        console.error('Invalid response for balances:', response);
      }
      setLoading(false);
    });
  };

  const formatBalance = (balance: number) => {
    if (balance === 0) {
      return '0.0000';
    }
    return balance.toFixed(4);
  };

  const openUrl = (url: string) => {
    window.open(url, '_blank');
  };

  return (
    <Flex direction="column" minHeight="100vh" width="100%">
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
              <Text>No asset selected (Go Back!)</Text>
            </Flex>
          )}
        </CardBody>
      </Card>

      {/* Push AppStore to the bottom */}
      <Box flexGrow={1} />

      <Box mt={4}>
        <Tabs variant="enclosed" mt={4}>
          <TabList>
            <Tab>Dapps</Tab>
          </TabList>
          <TabPanels>
            <TabPanel>
              <AppStore networkId={asset?.networkId} /> {/* The AppStore is now in its own component */}
            </TabPanel>
          </TabPanels>
        </Tabs>
      </Box>
    </Flex>
  );
}

export default Asset;
