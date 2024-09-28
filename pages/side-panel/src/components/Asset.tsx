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
  Select,
  Input,
} from '@chakra-ui/react';
import { Transfer } from './Transfer';
import { Receive } from './Receive';

export function Asset() {
  const [activeTab, setActiveTab] = useState<'send' | 'receive' | null>(null);
  const [loading, setLoading] = useState(true);
  const [balances, setBalances] = useState<any[]>([]);
  const [pubkeys, setPubkeys] = useState<any[]>([]);
  const [paths, setPaths] = useState<any[]>([]);
  const [asset, setAsset] = useState<any>(null); // Define asset state
  const [selectedProvider, setSelectedProvider] = useState<number | 'custom'>(0); // Handle selected provider
  const [customProvider, setCustomProvider] = useState<string>(''); // For custom provider

  // Fetch asset context and balances initially
  useEffect(() => {
    fetchAssetContext();
    fetchBalancesAndPubkeys();
  }, []);

  // Subscribe to events and handle updates
  useEffect(() => {
    const messageListener = (message: any) => {
      if (message.type === 'ASSET_CONTEXT_UPDATED' && message.assetContext) {
        console.log('ASSET_CONTEXT_UPDATED:', message.assetContext);
        setAsset(message.assetContext); // Update the asset state
        fetchBalancesAndPubkeys(); // Reload balances when asset context changes
      }
    };

    // Add event listener for messages from the background script
    chrome.runtime.onMessage.addListener(messageListener);

    return () => {
      // Cleanup the listener when the component unmounts
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, []);

  const fetchAssetContext = () => {
    chrome.runtime.sendMessage({ type: 'GET_ASSET_CONTEXT' }, response => {
      if (chrome.runtime.lastError) {
        console.error('Error fetching asset context:', chrome.runtime.lastError.message);
        return;
      }
      if (response && response.assets) {
        setAsset(response.assets); // Set asset state
      }
    });
  };

  const fetchBalancesAndPubkeys = () => {
    setLoading(true);
    // Fetch balances
    chrome.runtime.sendMessage({ type: 'GET_APP_BALANCES' }, response => {
      if (chrome.runtime.lastError) {
        console.error('Error fetching balances:', chrome.runtime.lastError.message);
        setLoading(false);
        return;
      }
      if (response && response.balances) {
        setBalances(response.balances);
      }
    });

    // Fetch pubkeys
    chrome.runtime.sendMessage({ type: 'GET_PUBKEYS' }, response => {
      if (chrome.runtime.lastError) {
        console.error('Error fetching pubkeys:', chrome.runtime.lastError.message);
        setLoading(false);
        return;
      }
      if (response && response.pubkeys) {
        setPubkeys(response.pubkeys);
      }
    });

    // Fetch paths
    chrome.runtime.sendMessage({ type: 'GET_PATHS' }, response => {
      if (chrome.runtime.lastError) {
        console.error('Error fetching paths:', chrome.runtime.lastError.message);
        setLoading(false);
        return;
      }
      if (response && response.paths) {
        setPaths(response.paths);
      }
      setLoading(false);
    });
  };

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === 'custom') {
      setSelectedProvider('custom');
    } else {
      setSelectedProvider(Number(value));
    }
  };

  const formatBalance = (balance: string) => {
    const [integer, decimal] = balance.split('.');
    const largePart = decimal?.slice(0, 4);
    const smallPart = decimal?.slice(4, 8);
    return { integer, largePart, smallPart };
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

              {/* Select Dropdown for Providers */}
              <Box my={4}>
                <Text>Select Provider:</Text>
                <Select value={selectedProvider} onChange={handleProviderChange} placeholder="Select provider">
                  {asset.providers?.map((provider: any, index: number) => (
                    <option key={index} value={index}>
                      {provider}
                    </option>
                  ))}
                  <option value="custom">Add your own provider</option>
                </Select>
                {selectedProvider === 'custom' && (
                  <Input
                    mt={2}
                    placeholder="Enter custom provider URL"
                    value={customProvider}
                    onChange={e => setCustomProvider(e.target.value)}
                  />
                )}
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
                  {balances
                    .filter((balance: any) => balance.caip === asset.caip)
                    .map((balance: any, index: any) => {
                      const { integer, largePart, smallPart } = formatBalance(balance.balance);
                      return (
                        <Text key={index}>
                          <Text as="span" fontSize="lg">
                            {integer}.{largePart}
                          </Text>
                          <Text as="span" fontSize="xs">
                            {smallPart}
                          </Text>
                          <Box ml={3} flex="1">
                            <Badge ml={2} colorScheme="teal">
                              ({asset.symbol})
                            </Badge>
                          </Box>
                        </Text>
                      );
                    })}
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
              <Text>No asset selected</Text>
            </Flex>
          )}
        </CardBody>
      </Card>
    </Stack>
  );
}

export default Asset;
