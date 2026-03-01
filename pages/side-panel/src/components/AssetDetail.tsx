import React, { useState, useEffect } from 'react';
import {
  VStack,
  HStack,
  Box,
  Flex,
  Text,
  Button,
  Avatar,
  useToast,
  IconButton,
  Spinner,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Badge,
} from '@chakra-ui/react';
import { ArrowUpIcon, ArrowDownIcon, CopyIcon, CheckIcon, ExternalLinkIcon } from '@chakra-ui/icons';
import { getExplorerAddressUrl, getExplorerTxUrl } from '@extension/shared';
import { Tokens } from './Tokens';
import { requestStorage } from '@extension/storage';
import { formatDistanceToNow } from 'date-fns';

interface AssetDetailProps {
  asset: any;
  balances: any[];
  onSend: () => void;
  onReceive: () => void;
}

const AssetDetail = ({ asset, balances, onSend, onReceive }: AssetDetailProps) => {
  const [address, setAddress] = useState<string>('');
  const [hasCopied, setHasCopied] = useState(false);
  const [loadingAddress, setLoadingAddress] = useState(false);
  const [events, setEvents] = useState<any[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [liveBalance, setLiveBalance] = useState<number | null>(null);
  const [liveUsdValue, setLiveUsdValue] = useState<number | null>(null);
  const [livePriceUsd, setLivePriceUsd] = useState<number | null>(null);
  const toast = useToast();

  const isEvm = asset.networkId?.startsWith('eip155:');

  // Fallback: cached Pioneer balance for non-EVM or while loading
  const chainBalances = balances.filter(b => b.networkId === asset.networkId);
  const nativeBalances = chainBalances.filter(b => b.isNative === true);
  const cachedBalance =
    nativeBalances.length > 0
      ? nativeBalances.reduce((acc, b) => acc + parseFloat(b.balance || '0'), 0)
      : parseFloat(chainBalances.find(b => b.caip?.startsWith(asset.networkId))?.balance || '0');
  const cachedUsdValue = chainBalances.reduce((sum, b) => sum + parseFloat(b.valueUsd || '0'), 0);
  const cachedPriceUsd = nativeBalances[0] ? parseFloat(nativeBalances[0].priceUsd || '0') : 0;

  // Use live data when available (EVM), fallback to cached
  const totalBalance = liveBalance !== null ? liveBalance : cachedBalance;
  const totalUsdValue = liveUsdValue !== null ? liveUsdValue : cachedUsdValue;
  const priceUsd = livePriceUsd !== null ? livePriceUsd : cachedPriceUsd;

  // Build icon URL
  const iconUrl = asset.icon || `https://api.keepkey.info/coins/${btoa(asset.caip || '').replace(/=+$/, '')}.png`;

  // Fetch address and live balance when asset changes
  useEffect(() => {
    // Reset live balance on asset change
    setLiveBalance(null);
    setLiveUsdValue(null);
    setLivePriceUsd(null);

    const accountAddress = asset.pubkeys?.[0]?.address || asset.address || '';
    if (accountAddress) {
      setAddress(accountAddress);
    } else if (asset.networkId) {
      setLoadingAddress(true);
      chrome.runtime.sendMessage({ type: 'GET_PUBKEYS_FOR_NETWORK', networkId: asset.networkId }, response => {
        if (response?.pubkeys?.[0]) {
          setAddress(response.pubkeys[0].address || response.pubkeys[0].master || '');
        }
        setLoadingAddress(false);
      });
      return;
    }

    // For EVM chains, fetch fresh balance for the selected account address via RPC
    if (isEvm && accountAddress) {
      chrome.runtime.sendMessage(
        { type: 'GET_EVM_BALANCE', networkId: asset.networkId, address: accountAddress },
        response => {
          if (response && !response.error) {
            setLiveBalance(parseFloat(response.balance || '0'));
            setLiveUsdValue(parseFloat(response.valueUsd || '0'));
            setLivePriceUsd(parseFloat(response.priceUsd || '0'));
          }
        },
      );
    }
  }, [asset.networkId, asset.address, asset.pubkeys?.[0]?.address, isEvm]);

  // Load activity events filtered by networkId
  useEffect(() => {
    const loadEvents = async () => {
      setEventsLoading(true);
      try {
        const data = await requestStorage.getEvents();
        if (data && data.length > 0) {
          const filtered = data
            .filter((e: any) => e.networkId === asset.networkId)
            .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
          setEvents(filtered);
        } else {
          setEvents([]);
        }
      } catch {
        setEvents([]);
      }
      setEventsLoading(false);
    };
    loadEvents();
  }, [asset.networkId]);

  const handleCopy = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      setHasCopied(true);
      toast({ title: 'Address copied!', status: 'success', duration: 2000 });
      setTimeout(() => setHasCopied(false), 2000);
    }
  };

  const handleOpenExplorer = () => {
    if (!address) return;
    const url = getExplorerAddressUrl(asset.networkId, address);
    if (url) {
      window.open(url, '_blank');
    } else {
      toast({ title: 'No explorer available for this network', status: 'info', duration: 2000 });
    }
  };

  const formatAddr = (addr: string) => {
    if (!addr) return '';
    if (addr.length <= 20) return addr;
    return `${addr.slice(0, 10)}...${addr.slice(-8)}`;
  };

  const formatUsd = (value: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);

  const isUtxoNetwork = asset.networkId?.startsWith('bip122:');

  return (
    <Flex direction="column" h="100%" minH={0}>
      {/* Balance Hero */}
      <VStack spacing={1} align="center" pt={3} pb={2} px={2} flexShrink={0}>
        <HStack spacing={2} align="center">
          <Avatar src={iconUrl} size="sm" />
          <Text fontSize="sm" fontWeight="medium" color="whiteAlpha.600">
            {asset.name || asset.symbol}
          </Text>
        </HStack>
        <Text fontSize="xl" fontWeight="bold" color="white" lineHeight="1.2">
          {formatUsd(totalUsdValue)}
        </Text>
        <HStack spacing={1}>
          <Text fontSize="xs" color="whiteAlpha.600">
            {totalBalance.toFixed(4)} {asset.symbol}
          </Text>
          {priceUsd > 0 && (
            <Text fontSize="xs" color="whiteAlpha.400">
              @ {formatUsd(priceUsd)}
            </Text>
          )}
        </HStack>
      </VStack>

      {/* Address Bar */}
      <Box px={2} pb={2} flexShrink={0}>
        {loadingAddress ? (
          <Flex justify="center">
            <Spinner size="xs" />
          </Flex>
        ) : address ? (
          <Flex
            bg="whiteAlpha.50"
            borderRadius="md"
            px={2}
            py={1}
            align="center"
            gap={1}
            maxW="100%"
            justify="center"
            mx="auto">
            <Text fontFamily="mono" fontSize="xs" color="whiteAlpha.500" isTruncated>
              {formatAddr(address)}
            </Text>
            <IconButton
              icon={hasCopied ? <CheckIcon boxSize={2} /> : <CopyIcon boxSize={2} />}
              aria-label="Copy address"
              size="xs"
              variant="ghost"
              minW="20px"
              h="20px"
              colorScheme={hasCopied ? 'green' : 'gray'}
              onClick={handleCopy}
            />
            <IconButton
              icon={<ExternalLinkIcon boxSize={2} />}
              aria-label="View on explorer"
              size="xs"
              variant="ghost"
              minW="20px"
              h="20px"
              colorScheme="blue"
              onClick={handleOpenExplorer}
            />
          </Flex>
        ) : null}
      </Box>

      {/* Action Buttons */}
      <HStack spacing={2} w="100%" px={2} pb={2} flexShrink={0}>
        <Button
          leftIcon={<ArrowUpIcon boxSize={3} />}
          colorScheme="orange"
          variant="solid"
          size="sm"
          flex={1}
          fontSize="xs"
          fontWeight="semibold"
          borderRadius="md"
          onClick={onSend}>
          Send
        </Button>
        <Button
          leftIcon={<ArrowDownIcon boxSize={3} />}
          colorScheme="green"
          variant="solid"
          size="sm"
          flex={1}
          fontSize="xs"
          fontWeight="semibold"
          borderRadius="md"
          onClick={onReceive}>
          Receive
        </Button>
      </HStack>

      {/* Tab Bar — Tokens / Activity */}
      <Box flex={1} minH={0} px={2}>
        <Tabs variant="soft-rounded" colorScheme="blue" size="sm" display="flex" flexDirection="column" h="100%">
          <TabList mb={1} gap={1} flexShrink={0}>
            <Tab
              color="whiteAlpha.500"
              _selected={{ color: 'white', bg: 'whiteAlpha.150' }}
              fontSize="xs"
              fontWeight="medium"
              py={1}
              px={3}
              borderRadius="md">
              Tokens
            </Tab>
            <Tab
              color="whiteAlpha.500"
              _selected={{ color: 'white', bg: 'whiteAlpha.150' }}
              fontSize="xs"
              fontWeight="medium"
              py={1}
              px={3}
              borderRadius="md">
              Activity
              {events.length > 0 && (
                <Badge ml={1} colorScheme="blue" fontSize="0.5rem" borderRadius="full" px={1}>
                  {events.length}
                </Badge>
              )}
            </Tab>
          </TabList>
          <TabPanels flex={1} minH={0} overflowY="auto">
            {/* Tokens Tab */}
            <TabPanel p={0}>
              {isUtxoNetwork ? (
                <VStack align="center" py={6}>
                  <Text fontSize="sm" color="whiteAlpha.500">
                    No tokens for UTXO chains
                  </Text>
                </VStack>
              ) : (
                <Tokens asset={{ ...asset, address }} networkId={asset.networkId} />
              )}
            </TabPanel>

            {/* Activity Tab */}
            <TabPanel p={0}>
              {eventsLoading ? (
                <Flex justify="center" py={6}>
                  <Spinner size="md" color="blue.400" />
                </Flex>
              ) : events.length > 0 ? (
                <VStack align="stretch" spacing={2}>
                  {events.map((event: any) => {
                    const isSend = event.type === 'send' || event.method?.includes('send');
                    const txid = event.txid && typeof event.txid === 'object' ? event.txid.txid : event.txid;
                    const explorerUrl = txid ? getExplorerTxUrl(asset.networkId, txid) : null;

                    return (
                      <Flex
                        key={event.id}
                        bg="whiteAlpha.50"
                        borderRadius="lg"
                        px={3}
                        py={2}
                        align="center"
                        cursor={explorerUrl ? 'pointer' : 'default'}
                        _hover={explorerUrl ? { bg: 'whiteAlpha.100' } : {}}
                        onClick={() => explorerUrl && window.open(explorerUrl, '_blank')}
                        border="1px solid"
                        borderColor="whiteAlpha.100">
                        <Box
                          w="32px"
                          h="32px"
                          borderRadius="full"
                          bg={isSend ? 'red.900' : 'green.900'}
                          display="flex"
                          alignItems="center"
                          justifyContent="center"
                          mr={3}
                          flexShrink={0}>
                          {isSend ? (
                            <ArrowUpIcon boxSize={3} color="red.300" />
                          ) : (
                            <ArrowDownIcon boxSize={3} color="green.300" />
                          )}
                        </Box>
                        <Box flex={1} minW={0}>
                          <Flex align="center" gap={2}>
                            <Text fontSize="sm" fontWeight="medium" color="white">
                              {isSend ? 'Sent' : 'Transaction'}
                            </Text>
                            <Badge
                              fontSize="0.5rem"
                              colorScheme={event.blockHeight ? 'green' : 'yellow'}
                              variant="subtle">
                              {event.blockHeight ? 'Confirmed' : 'Pending'}
                            </Badge>
                          </Flex>
                          <Text fontSize="xs" color="whiteAlpha.500">
                            {event.timestamp ? formatDistanceToNow(new Date(event.timestamp)) + ' ago' : 'Unknown'}
                          </Text>
                        </Box>
                        {explorerUrl && <ExternalLinkIcon boxSize={3} color="whiteAlpha.400" flexShrink={0} />}
                      </Flex>
                    );
                  })}
                </VStack>
              ) : (
                <VStack align="center" py={6} spacing={2}>
                  <Text fontSize="sm" color="whiteAlpha.500">
                    No recent activity
                  </Text>
                  {address && (
                    <Button
                      size="xs"
                      variant="ghost"
                      colorScheme="blue"
                      rightIcon={<ExternalLinkIcon />}
                      onClick={handleOpenExplorer}>
                      View on Explorer
                    </Button>
                  )}
                </VStack>
              )}
            </TabPanel>
          </TabPanels>
        </Tabs>
      </Box>
    </Flex>
  );
};

export default AssetDetail;
