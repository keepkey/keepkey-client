import React, { useState, useEffect } from 'react';
import {
  VStack,
  HStack,
  Box,
  Flex,
  Text,
  Button,
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
import { ArrowUpIcon, ArrowDownIcon, CopyIcon, CheckIcon, ExternalLinkIcon, RepeatIcon } from '@chakra-ui/icons';
import { AssetIcon } from './AssetIcon';
import { SpinningDevice } from './SpinningDevice';
import { KNOWN_EVM_CHAINS, EVM_NATIVE_GAS } from './header/headerConstants';
import { getExplorerAddressUrl, getExplorerTxUrl } from '@extension/shared';
import { Tokens } from './Tokens';
import { requestStorage } from '@extension/storage';
import { formatDistanceToNow } from 'date-fns';

interface AssetDetailProps {
  asset: any;
  balances: any[];
  onSend: () => void;
  onReceive: () => void;
  onSwap?: () => void;
}

const AssetDetail = ({ asset, balances, onSend, onReceive, onSwap }: AssetDetailProps) => {
  const [address, setAddress] = useState<string>('');
  const [hasCopied, setHasCopied] = useState(false);
  const [loadingAddress, setLoadingAddress] = useState(false);
  const [events, setEvents] = useState<any[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const toast = useToast();

  const isEvm = asset.networkId?.startsWith('eip155:');
  const isUtxo = asset.networkId?.startsWith('bip122:');
  // Hive is read-only for now: it lists + receives, but Send/Swap aren't wired
  // (generic Send emits a shape hiveTransfer can't consume). Gate them off so
  // we don't surface a guaranteed-failing action.
  const isReadOnly = asset.networkId === 'hive:beeab0de';

  // Fallback: cached Pioneer balance for non-EVM or while loading
  const chainBalances = balances.filter(b => b.networkId === asset.networkId);
  const nativeBalances = chainBalances.filter(b => b.isNative === true);
  const cachedBalance =
    nativeBalances.length > 0
      ? nativeBalances.reduce((acc, b) => acc + parseFloat(b.balance || '0'), 0)
      : parseFloat(chainBalances.find(b => b.caip?.startsWith(asset.networkId))?.balance || '0');

  const cachedUsdValue = chainBalances.reduce((sum, b) => sum + parseFloat(b.valueUsd || '0'), 0);
  const cachedPriceUsd = nativeBalances[0] ? parseFloat(nativeBalances[0].priceUsd || '0') : 0;

  // Render from the cached aggregate (sum across accounts) so the detail page
  // matches the dashboard exactly. GET_EVM_BALANCE still fires below to refresh
  // the cache (per-account write-back + BALANCES_UPDATED); SidePanel passes the
  // refreshed balances back down, so this stays fresh AND consistent.
  const totalBalance = cachedBalance;
  const totalUsdValue = cachedUsdValue;
  const priceUsd = cachedPriceUsd;

  // Build icon URL
  const iconUrl = asset.icon || `https://api.keepkey.info/coins/${btoa(asset.caip || '').replace(/=+$/, '')}.png`;

  // EVM native-asset labeling. The dashboard rows carry the chain's short symbol
  // as the "asset" (Base→BASE, Arbitrum→ARB, Optimism→OP), but those chains pay
  // gas in ETH — so the page should read "Ethereum / ETH on Base". Only relabel
  // the *native* row (never an ERC-20): a token like USDC keeps its own name.
  const chainMeta = isEvm ? KNOWN_EVM_CHAINS[asset.networkId as keyof typeof KNOWN_EVM_CHAINS] : undefined;
  // Only the native row gets gas-asset relabeling. The symbol-match fallback
  // (for native rows that arrive without isNative set) must exclude ERC-20s —
  // otherwise the ARB/OP/MATIC *governance tokens*, whose tickers equal their
  // chain's dropdown symbol, get mislabeled as "Ethereum / ETH on Arbitrum".
  // Token rows reliably carry token:true through SET_ASSET_CONTEXT.
  const isNativeRow = asset.isNative === true || (!asset.token && !!chainMeta && asset.symbol === chainMeta.symbol);
  const gasAsset = isEvm && isNativeRow ? EVM_NATIVE_GAS[asset.networkId as keyof typeof EVM_NATIVE_GAS] : undefined;
  const displaySymbol = gasAsset?.symbol ?? asset.symbol;
  const displayName = gasAsset?.name ?? asset.name ?? asset.symbol;
  const networkName = chainMeta?.name ?? asset.name;
  // "on <network>" only when the gas asset differs from its host chain (ETH on
  // Base) — not for a chain's own namesake token (ETH on Ethereum, AVAX on
  // Avalanche).
  const showNetworkBadge = !!gasAsset && !!networkName && gasAsset.name !== networkName;

  // Fetch address and live balance when asset changes
  useEffect(() => {
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
        const resolved = response?.pubkeys?.[0]?.address || response?.pubkeys?.[0]?.master || '';
        if (resolved) setAddress(resolved);
        setLoadingAddress(false);
        // EVM: refresh the cache for the resolved account so detail + dashboard
        // stay fresh even when the address was resolved asynchronously here.
        if (isEvm && resolved) {
          chrome.runtime.sendMessage({ type: 'GET_EVM_BALANCE', networkId: asset.networkId, address: resolved });
        }
      });
      return;
    }

    // For EVM chains, fire a fresh RPC balance for this account. We don't read
    // the response — the background writes the live value back into the cached
    // row (keyed by address) and pushes BALANCES_UPDATED, so SidePanel re-sends
    // refreshed `balances` down and this page (which renders from the cached
    // aggregate) updates in lockstep with the dashboard.
    if (isEvm && accountAddress) {
      chrome.runtime.sendMessage({ type: 'GET_EVM_BALANCE', networkId: asset.networkId, address: accountAddress });
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
      {/* Spinning KeepKey hero — the device's OLED carries the asset + balance,
          so the top of the page reads as the focal point instead of dead space.
          Device sits at the top; the tab list below (flex grow) takes the rest,
          so there's no empty band above or below. */}
      <VStack spacing={1} align="center" pt={3} pb={1} px={2} flexShrink={0}>
        <SpinningDevice
          scale={0.42}
          durationSeconds={14}
          screen={
            <Flex direction="column" align="center" justify="center" w="100%" gap="2px" lineHeight="1">
              <Flex align="center" gap="5px">
                <AssetIcon src={iconUrl} symbol={displaySymbol} size={15} />
                <Text fontSize="11px" fontWeight={600} letterSpacing="0.08em" color="#e8e6dc">
                  {displaySymbol}
                </Text>
              </Flex>
              <Text fontFamily="ui-monospace, Menlo, monospace" fontSize="15px" fontWeight={700} color="#f3f1e7">
                <DustAmount value={totalBalance} />
              </Text>
            </Flex>
          }
        />
        <Text fontSize="2xl" fontWeight="bold" color="kk.text" lineHeight="1.1">
          {formatUsd(totalUsdValue)}
        </Text>
        <HStack spacing={2} align="center">
          <Text fontSize="sm" fontWeight="medium" color="kk.dim">
            {displayName}
          </Text>
          {showNetworkBadge && <NetworkBadge name={networkName!} />}
          {asset.networkId === 'tron:27Lqcw' && <TronLinkBadge />}
        </HStack>
        <HStack spacing={1}>
          <Text fontSize="xs" color="kk.faint">
            <DustAmount value={totalBalance} /> {displaySymbol}
          </Text>
          {priceUsd > 0 && (
            <Text fontSize="xs" color="kk.faint">
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
            bg="kk.surface"
            borderRadius="md"
            px={2}
            py={1}
            align="center"
            gap={1}
            maxW="100%"
            justify="center"
            mx="auto">
            <Text fontFamily="mono" fontSize="xs" color="kk.dim" isTruncated>
              {formatAddr(address)}
            </Text>
            <IconButton
              icon={hasCopied ? <CheckIcon boxSize={2} /> : <CopyIcon boxSize={2} />}
              aria-label="Copy address"
              size="xs"
              variant="ghost"
              minW="20px"
              h="20px"
              color={hasCopied ? 'kk.good' : 'kk.dim'}
              onClick={handleCopy}
            />
            <IconButton
              icon={<ExternalLinkIcon boxSize={2} />}
              aria-label="View on explorer"
              size="xs"
              variant="ghost"
              minW="20px"
              h="20px"
              color="kk.accent"
              onClick={handleOpenExplorer}
            />
          </Flex>
        ) : null}
      </Box>

      {/* Action Buttons */}
      <HStack spacing={2} w="100%" px={2} pb={2} flexShrink={0}>
        {!isReadOnly && (
          <Button
            leftIcon={<ArrowUpIcon boxSize={3} />}
            variant="solid"
            size="sm"
            flex={1}
            fontSize="xs"
            fontWeight="semibold"
            borderRadius="md"
            onClick={onSend}>
            Send
          </Button>
        )}
        <Button
          leftIcon={<ArrowDownIcon boxSize={3} />}
          variant="ghost"
          size="sm"
          flex={1}
          fontSize="xs"
          fontWeight="semibold"
          borderRadius="md"
          onClick={onReceive}>
          Receive
        </Button>
        {onSwap && !isReadOnly && (
          <Button
            leftIcon={<RepeatIcon boxSize={3} />}
            variant="ghost"
            size="sm"
            flex={1}
            fontSize="xs"
            fontWeight="semibold"
            borderRadius="md"
            onClick={onSwap}>
            Swap
          </Button>
        )}
      </HStack>

      {/* Tab Bar — Tokens / Activity. flex grows to fill everything below the
          hero so the list reaches the bottom edge (no trailing empty band). */}
      <Box flex={1} minH={0} px={2}>
        <Tabs variant="soft-rounded" size="sm" display="flex" flexDirection="column" h="100%">
          <TabList mb={1} gap={1} flexShrink={0}>
            {!isUtxoNetwork && (
              <Tab
                color="kk.dim"
                _selected={{ color: 'kk.text', bg: 'kk.surfaceHi' }}
                fontSize="xs"
                fontWeight="medium"
                py={1}
                px={3}
                borderRadius="md">
                Tokens
              </Tab>
            )}
            <Tab
              color="kk.dim"
              _selected={{ color: 'kk.text', bg: 'kk.surfaceHi' }}
              fontSize="xs"
              fontWeight="medium"
              py={1}
              px={3}
              borderRadius="md">
              Activity
              {events.length > 0 && (
                <Badge ml={1} bg="kk.surfaceHi" color="kk.dim" fontSize="0.5rem" borderRadius="full" px={1}>
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
                  <Spinner size="md" color="kk.accent" />
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
                        bg="kk.surface"
                        borderRadius="lg"
                        px={3}
                        py={2}
                        align="center"
                        cursor={explorerUrl ? 'pointer' : 'default'}
                        _hover={explorerUrl ? { bg: 'kk.surfaceHi' } : {}}
                        onClick={() => explorerUrl && window.open(explorerUrl, '_blank')}
                        border="1px solid"
                        borderColor="kk.line">
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
                            <ArrowUpIcon boxSize={3} color="kk.bad" />
                          ) : (
                            <ArrowDownIcon boxSize={3} color="kk.good" />
                          )}
                        </Box>
                        <Box flex={1} minW={0}>
                          <Flex align="center" gap={2}>
                            <Text fontSize="sm" fontWeight="medium" color="kk.text">
                              {isSend ? 'Sent' : 'Transaction'}
                            </Text>
                            <Badge
                              fontSize="0.5rem"
                              bg={event.blockHeight ? 'kk.good' : 'kk.warn'}
                              color="kk.bg2"
                              variant="subtle">
                              {event.blockHeight ? 'Confirmed' : 'Pending'}
                            </Badge>
                          </Flex>
                          <Text fontSize="xs" color="kk.dim">
                            {event.timestamp ? formatDistanceToNow(new Date(event.timestamp)) + ' ago' : 'Unknown'}
                          </Text>
                        </Box>
                        {explorerUrl && <ExternalLinkIcon boxSize={3} color="kk.faint" flexShrink={0} />}
                      </Flex>
                    );
                  })}
                </VStack>
              ) : (
                <VStack align="center" py={6} spacing={2}>
                  <Text fontSize="sm" color="kk.dim">
                    No recent activity
                  </Text>
                  {address && (
                    <Button
                      size="xs"
                      variant="ghost"
                      color="kk.accent"
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

// Renders a crypto amount with up to 8 decimals of precision. The integer and
// first 4 decimals read at full size; decimals 5–8 ("dust") render smaller and
// dimmer, so a headline balance stays scannable while sub-0.0001 precision is
// still legible at a glance. Trailing-zero dust is trimmed (0.5 → "0.5000", not
// "0.50000000"). Meant to sit inside a <Text>: the spans inherit its font and
// color; only the dust shrinks and fades.
const DustAmount = ({ value }: { value: number }) => {
  const [intPart, frac = ''] = (Number.isFinite(value) ? value : 0).toFixed(8).split('.');
  const head = frac.slice(0, 4);
  const dust = frac.slice(4).replace(/0+$/, '');
  return (
    <>
      {intPart}.{head}
      {dust && (
        <Box as="span" fontSize="0.7em" opacity={0.5}>
          {dust}
        </Box>
      )}
    </>
  );
};

// Network badge shown next to a native asset whose gas token differs from its
// host chain (e.g. "Ethereum  ◦on Base"). The glyph is AssetIcon's deterministic
// monogram keyed on the network name, so it reads as an intentional branded mark
// rather than a generic dot.
const NetworkBadge = ({ name }: { name: string }) => (
  <Flex
    align="center"
    gap={1}
    pl="3px"
    pr={2}
    py="2px"
    borderRadius="full"
    bg="kk.surface"
    border="1px solid"
    borderColor="kk.line">
    <AssetIcon symbol={name} size={12} />
    <Text fontSize="9px" color="kk.dim" fontWeight={600} letterSpacing="0.04em">
      on {name}
    </Text>
  </Flex>
);

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
