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
  const isUtxo = asset.networkId?.startsWith('bip122:');

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

    // UTXO chains: pubkey-list rows have empty .address and Pioneer's
    // /portfolio response stuffs the xpub into b.address (line ~439 in
    // background/index.ts), so falling back to asset.pubkeys[0].address
    // or asset.address would surface either nothing or an unusable
    // xpub string in the address bar / explorer link. Derive the real
    // receive address via GET_UTXO_ADDRESS using the asset's note +
    // script_type (which the header / SET_ASSET_CONTEXT enrichment
    // both populate).
    if (isUtxo && asset.networkId) {
      setLoadingAddress(true);
      chrome.runtime.sendMessage(
        {
          type: 'GET_UTXO_ADDRESS',
          networkId: asset.networkId,
          scriptType: asset.script_type,
          note: asset.note,
        },
        response => {
          if (response?.address) setAddress(response.address);
          else setAddress('');
          setLoadingAddress(false);
        },
      );
      return;
    }

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
  }, [asset.networkId, asset.address, asset.pubkeys?.[0]?.address, asset.note, asset.script_type, isEvm, isUtxo]);

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
      {/* Top spacer — pushes hero/address/buttons up off the top edge.
          Smaller than the tabs flex grow below (1 : 2) so the hero sits at
          roughly the upper third rather than dead-center; visually the
          balance + Send/Receive block reads as the focal point. */}
      <Box flex={1} minH={0} flexShrink={1} />

      {/* Balance Hero */}
      <VStack spacing={1} align="center" pt={3} pb={2} px={2} flexShrink={0}>
        <HStack spacing={2} align="center">
          <Avatar src={iconUrl} size="sm" />
          <Text fontSize="sm" fontWeight="medium" color="whiteAlpha.600">
            {asset.name || asset.symbol}
          </Text>
          {asset.networkId === 'tron:27Lqcw' && <TronLinkBadge />}
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

      {/* Tab Bar — Tokens / Activity. flex={2} vs the top spacer's flex={1}
          biases the hero block higher (≈ upper third) instead of dead-center. */}
      <Box flex={2} minH={0} px={2}>
        <Tabs variant="soft-rounded" colorScheme="blue" size="sm" display="flex" flexDirection="column" h="100%">
          <TabList mb={1} gap={1} flexShrink={0}>
            {!isUtxoNetwork && (
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
            )}
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
            {/* Tokens Tab — hidden on chains that don't support tokens
                (currently UTXO). Both the Tab and its TabPanel are dropped
                together so Chakra's positional indexing stays in sync. */}
            {!isUtxoNetwork && (
              <TabPanel p={0}>
                <Tokens asset={{ ...asset, address }} networkId={asset.networkId} />
              </TabPanel>
            )}

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

// Passive indicator shown next to the asset name on the Tron asset page —
// tells the user Tron dApps use the TronLink protocol (which KeepKey
// implements). Not a link; TronLink is an unaffiliated wallet.
const TronLinkBadge = () => (
  <Flex
    alignItems="center"
    gap={1}
    px={1.5}
    py={0.5}
    borderRadius="full"
    bg="rgba(47,94,252,0.14)"
    border="1px solid"
    borderColor="rgba(47,94,252,0.36)">
    <Flex w="10px" h="10px" borderRadius="full" bg="#2f5efc" alignItems="center" justifyContent="center" flexShrink={0}>
      <TronLinkGlyph size={6} />
    </Flex>
    <Text fontSize="9px" color="#8fa9ff" letterSpacing="0.06em" fontWeight={600} textTransform="uppercase">
      TronLink
    </Text>
  </Flex>
);

// Minimal TronLink mark — triangle/paper-plane silhouette in white.
const TronLinkGlyph = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path
      d="M4.5 5.5L19.5 11.2c.6.24.6 1.1 0 1.34l-6.6 2.64-2.64 6.6c-.24.6-1.1.6-1.34 0L3.18 6.84c-.24-.6.36-1.2.96-.96l.36.12z"
      fill="white"
    />
  </svg>
);

export default AssetDetail;
