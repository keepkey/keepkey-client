import React, { useState, useEffect, useCallback } from 'react';
import {
  useDisclosure,
  Flex,
  Text,
  Box,
  IconButton,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  Spinner,
  Button,
  Heading,
  HStack,
  Drawer,
  DrawerOverlay,
  DrawerContent,
  DrawerHeader,
  DrawerBody,
} from '@chakra-ui/react';
import { ArrowUpIcon, ArrowDownIcon, ChevronLeftIcon } from '@chakra-ui/icons';
import { withErrorBoundary, withSuspense } from '@extension/shared';
import { requestStorage } from '@extension/storage';

import Connect from './components/Connect';
import Loading from './components/Loading';
import Balances from './components/Balances';
import History from './components/History';
import Settings from './components/Settings';
import { Transfer } from './components/Transfer';
import { Receive } from './components/Receive';
import AssetDetail from './components/AssetDetail';
import DonutChart from './components/DonutChart';
import NetworkAccountHeader from './components/NetworkAccountHeader';
import Transaction from './approval/Transaction';

// Events older than this are dropped on load — an abandoned-tab pending
// request shouldn't hijack the sidebar forever.
const MAX_EVENT_AGE_MINUTES = 10;

const HEADER_HEIGHT = '60px';

const SidePanel = () => {
  const [balances, setBalances] = useState<any[]>([]);
  const [totalUsdBalance, setTotalUsdBalance] = useState<number>(0);
  const [keepkeyState, setKeepkeyState] = useState<number | null>(null);
  const [transactionContext, setTransactionContext] = useState<any>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<any>(null);
  const [balancesInitialLoading, setBalancesInitialLoading] = useState(true);
  const [pendingEvent, setPendingEvent] = useState<any | null>(null);

  // Disclosures for drawers/modals
  const { isOpen: isSettingsOpen, onOpen: onSettingsOpen, onClose: onSettingsClose } = useDisclosure();
  const { isOpen: isSendOpen, onOpen: onSendOpen, onClose: onSendClose } = useDisclosure();
  const { isOpen: isReceiveOpen, onOpen: onReceiveOpen, onClose: onReceiveClose } = useDisclosure();
  const { isOpen: isAssetDetailOpen, onOpen: onAssetDetailOpen, onClose: onAssetDetailClose } = useDisclosure();
  // Fetch total balance
  const fetchTotalBalance = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'GET_APP_BALANCES' }, response => {
      if (response && response.balances) {
        setBalances(response.balances);
        const total = response.balances.reduce((sum: number, b: any) => sum + parseFloat(b.valueUsd || '0'), 0);
        setTotalUsdBalance(total);
      }
      setBalancesInitialLoading(false);
    });
  }, []);

  useEffect(() => {
    if (keepkeyState === 5) {
      setBalancesInitialLoading(true);
      fetchTotalBalance();
    }
  }, [keepkeyState, fetchTotalBalance]);

  // Handle asset selection from Balances list
  const handleAssetSelect = (asset: any) => {
    setSelectedAsset(asset);
    chrome.runtime.sendMessage({ type: 'SET_ASSET_CONTEXT', asset }, () => {
      onAssetDetailOpen();
    });
  };

  // Handle closing asset detail — clear context so header returns to branding
  const handleAssetDetailClose = () => {
    onAssetDetailClose();
    setSelectedAsset(null);
    chrome.runtime.sendMessage({ type: 'CLEAR_ASSET_CONTEXT' });
  };

  // Prefer native chain rows over ERC-20 / SPL tokens when picking a
  // default for global Send / Receive. Picking the highest-USD raw row
  // meant a stablecoin or token could hijack the default action — a
  // behavior change from the asset-centric UX and a surprise for users
  // who expect "Send" to mean "send from my main chain wallet".
  const pickDefaultAsset = () => {
    if (balances.length === 0) return null;
    const byUsd = (a: any, b: any) => parseFloat(b.valueUsd || '0') - parseFloat(a.valueUsd || '0');
    const natives = balances.filter((b: any) => b.isNative).sort(byUsd);
    if (natives.length > 0) return natives[0];
    return [...balances].sort(byUsd)[0];
  };

  // Handle global send action
  const handleGlobalSend = () => {
    const defaultToken = pickDefaultAsset();
    if (defaultToken) {
      chrome.runtime.sendMessage({ type: 'SET_ASSET_CONTEXT', asset: defaultToken }, () => {
        onSendOpen();
      });
    }
  };

  // Handle global receive action
  const handleGlobalReceive = () => {
    const defaultToken = pickDefaultAsset();
    if (defaultToken) {
      chrome.runtime.sendMessage({ type: 'SET_ASSET_CONTEXT', asset: defaultToken }, () => {
        onReceiveOpen();
      });
    }
  };

  // Send/Receive from asset detail drawer
  const handleAssetSend = () => {
    onSendOpen();
  };

  const handleAssetReceive = () => {
    onReceiveOpen();
  };

  const refreshBalances = async () => {
    try {
      setIsRefreshing(true);
      setKeepkeyState(null);
      chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' }, response => {
        if (response?.success) {
          console.log('Cache cleared');
        }
      });
      chrome.runtime.sendMessage({ type: 'ON_START' }, response => {
        if (response?.success) {
          console.log('ON_START triggered');
        }
      });
    } catch (e) {
      console.error(e);
    } finally {
      setTimeout(() => setIsRefreshing(false), 12000);
    }
  };

  // Subscribe to requestStorage so any dApp-triggered approval request shown
  // here takes over the panel as an overlay. Abandoned events beyond the age
  // window are evicted on load so a stuck request can't wedge the UI.
  const fetchPendingEvent = useCallback(async () => {
    try {
      const events = (await requestStorage.getEvents()) || [];
      const now = Date.now();
      const fresh: any[] = [];
      for (const ev of events) {
        const ageMs = now - new Date(ev.timestamp).getTime();
        if (ageMs <= MAX_EVENT_AGE_MINUTES * 60_000) {
          fresh.push(ev);
        } else {
          void requestStorage.removeEventById(ev.id);
        }
      }
      // Newest-first — matches popup behavior; user sees the freshest request.
      fresh.reverse();
      setPendingEvent(fresh[0] ?? null);
    } catch (e) {
      console.error('SidePanel: fetchPendingEvent failed', e);
      setPendingEvent(null);
    }
  }, []);

  useEffect(() => {
    fetchPendingEvent();
    const unsubscribe = requestStorage.subscribe?.(() => {
      fetchPendingEvent();
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [fetchPendingEvent]);

  // Listen for state changes and external asset context updates (e.g. dApp wallet_addEthereumChain)
  useEffect(() => {
    const messageListener = (message: any) => {
      if (message.type === 'KEEPKEY_STATE_CHANGED' && message.state !== undefined) {
        setKeepkeyState(message.state);
      }
      if (message.type === 'TRANSACTION_CONTEXT_UPDATED' && message.id) {
        setTransactionContext(message.id);
      }
      if (message.type === 'ASSET_CONTEXT_UPDATED' && message.assetContext?.networkId) {
        const ctx = message.assetContext;
        // Pass the full context through. The old projection dropped
        // accountIndex, pubkeys, contractAddress, decimals, balances —
        // anything the asset-detail / send / receive flows read to
        // stay consistent with the rest of the sidebar. Fill in the
        // display-required fields with sensible fallbacks when the
        // context was minimally populated.
        const asset = {
          ...ctx,
          caip: ctx.caip || ctx.networkId,
          name: ctx.name || ctx.networkId,
          symbol: ctx.symbol || ctx.nativeCurrency?.symbol || '',
          icon: ctx.icon || '',
          address: ctx.address || '',
        };
        setSelectedAsset(asset);
        onAssetDetailOpen();
      }
      if (message.type === 'ASSET_CONTEXT_CLEARED') {
        setSelectedAsset(null);
      }
      // Background pushes this after cachedBalances is refreshed. Without it,
      // cold-start shows a pre-Solana snapshot because the panel only fetches
      // once on state=5 and never re-queries when the background later lands
      // Solana + SPL tokens after the initial fetch.
      if (message.type === 'BALANCES_UPDATED') {
        fetchTotalBalance();
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);
    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, [onAssetDetailOpen, fetchTotalBalance]);

  // Format currency for display
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const renderContent = () => {
    if (transactionContext) {
      return (
        <>
          <Flex mb={2}>
            <IconButton
              icon={<ChevronLeftIcon boxSize={5} />}
              aria-label="Back"
              variant="ghost"
              size="sm"
              onClick={() => setTransactionContext(null)}
            />
            <Text fontWeight="semibold" ml={2} alignSelf="center">
              Activity
            </Text>
          </Flex>
          <History transactionContext={transactionContext} />
        </>
      );
    }

    switch (keepkeyState) {
      case 0:
      case 1:
      case 2:
      case 3:
        return <Loading setIsConnecting={setIsConnecting} keepkeyState={keepkeyState} />;
      case 4:
        return <Connect setIsConnecting={setIsConnecting} />;
      case 5:
        return <Balances onSelectAsset={handleAssetSelect} />;
      default:
        return (
          <Flex direction="column" justifyContent="center" alignItems="center" height="100%" minH="300px">
            <Box mb={4} borderRadius="2xl" overflow="hidden" boxShadow="0 0 40px rgba(0, 200, 150, 0.15)">
              <img src="/kk.gif" alt="KeepKey" style={{ maxWidth: '160px', borderRadius: '16px' }} />
            </Box>
            <Text fontSize="xl" fontWeight="bold" textAlign="center" mb={1} color="white">
              Welcome to KeepKey
            </Text>
            <Text fontSize="sm" color="whiteAlpha.600" mb={5} textAlign="center">
              Your hardware wallet, in the browser
            </Text>
            <Button
              colorScheme="green"
              size="lg"
              onClick={refreshBalances}
              isLoading={isRefreshing}
              disabled={isRefreshing}
              px={8}
              borderRadius="xl"
              _hover={{ transform: 'scale(1.02)' }}
              transition="all 0.2s">
              {isRefreshing ? <Spinner size="md" color="white" /> : 'Get Started'}
            </Button>
            <Box mt={6} opacity={0.25}>
              <img src="/logo_vertical.svg" alt="KeepKey" style={{ maxWidth: '80px' }} />
            </Box>
          </Flex>
        );
    }
  };

  // Pending dApp approval takes over the panel. We intentionally skip rendering
  // the usual header/balances below so the user can't accidentally navigate
  // while an approval is live — matches the old popup's singular-focus UX.
  if (pendingEvent) {
    return (
      <Flex direction="column" width="100%" height="100vh" bg="gray.900" overflowY="auto" p={4}>
        <Transaction event={pendingEvent} reloadEvents={fetchPendingEvent} onDismiss={fetchPendingEvent} />
      </Flex>
    );
  }

  return (
    <Flex direction="column" width="100%" height="100vh">
      {/* Sticky header — floats above drawers */}
      <Box position="sticky" top={0} zIndex={1500} bg="gray.900" px={4} pt={4} pb={1} flexShrink={0} overflow="visible">
        <NetworkAccountHeader
          keepkeyState={keepkeyState}
          isRefreshing={isRefreshing}
          onSettingsOpen={onSettingsOpen}
          onRefresh={refreshBalances}
          onSelectNetwork={handleAssetSelect}
        />
      </Box>

      {/* Scrollable body below header */}
      <Flex direction="column" flex={1} overflowY="auto" px={4} pb={4}>
        {/* Total Balance & Quick Actions - Only when paired and on home screen, after initial load */}
        {keepkeyState === 5 && !transactionContext && !balancesInitialLoading && (
          <Box mb={3} textAlign="center">
            {balances.length > 0 && totalUsdBalance > 0 && (
              <Box mb={2}>
                <DonutChart balances={balances} totalUsd={totalUsdBalance} />
              </Box>
            )}
            <Heading size="lg" color="white" mb={2}>
              {formatCurrency(totalUsdBalance)}
            </Heading>
            <HStack spacing={3} justify="center">
              <Button
                leftIcon={<ArrowUpIcon />}
                colorScheme="blue"
                variant="solid"
                size="sm"
                onClick={handleGlobalSend}
                isDisabled={balances.length === 0}>
                Send
              </Button>
              <Button
                leftIcon={<ArrowDownIcon />}
                colorScheme="green"
                variant="solid"
                size="sm"
                onClick={handleGlobalReceive}
                isDisabled={balances.length === 0}>
                Receive
              </Button>
            </HStack>
          </Box>
        )}

        {/* Main content */}
        <Box flex={1}>{renderContent()}</Box>
      </Flex>

      {/* Asset Detail Drawer */}
      <Drawer isOpen={isAssetDetailOpen} placement="bottom" onClose={handleAssetDetailClose} size="full">
        <DrawerOverlay bg="blackAlpha.800" />
        <DrawerContent bg="gray.900" h={`calc(100vh - ${HEADER_HEIGHT})`} mt={HEADER_HEIGHT}>
          <DrawerHeader borderBottomWidth="1px" borderColor="whiteAlpha.200" py={3}>
            <Flex align="center" w="full">
              <IconButton
                aria-label="Go back"
                icon={<ChevronLeftIcon boxSize={6} />}
                variant="ghost"
                size="sm"
                onClick={handleAssetDetailClose}
                mr={2}
              />
              <Text fontWeight="semibold" fontSize="lg">
                {selectedAsset?.name || 'Asset'}
              </Text>
            </Flex>
          </DrawerHeader>
          <DrawerBody>
            {selectedAsset && (
              <AssetDetail
                asset={selectedAsset}
                balances={balances}
                onSend={handleAssetSend}
                onReceive={handleAssetReceive}
              />
            )}
          </DrawerBody>
        </DrawerContent>
      </Drawer>

      {/* Settings Modal */}
      <Modal isOpen={isSettingsOpen} onClose={onSettingsClose} size="xl">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            <Text fontSize="lg" fontWeight="bold" textAlign="center">
              Settings
            </Text>
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Settings />
          </ModalBody>
        </ModalContent>
      </Modal>

      {/* Send Drawer */}
      <Drawer isOpen={isSendOpen} placement="bottom" onClose={onSendClose} size="full">
        <DrawerOverlay bg="blackAlpha.800" />
        <DrawerContent bg="gray.900" h={`calc(100vh - ${HEADER_HEIGHT})`} mt={HEADER_HEIGHT}>
          <DrawerHeader borderBottomWidth="1px" borderColor="whiteAlpha.200" py={3}>
            <Flex align="center" w="full">
              <IconButton
                aria-label="Go back"
                icon={<ChevronLeftIcon boxSize={6} />}
                variant="ghost"
                size="sm"
                onClick={onSendClose}
                mr={2}
              />
              <Text fontWeight="semibold" fontSize="lg">
                Send
              </Text>
            </Flex>
          </DrawerHeader>
          <DrawerBody>
            <Transfer />
          </DrawerBody>
        </DrawerContent>
      </Drawer>

      {/* Receive Drawer */}
      <Drawer isOpen={isReceiveOpen} placement="bottom" onClose={onReceiveClose} size="full">
        <DrawerOverlay bg="blackAlpha.800" />
        <DrawerContent bg="gray.900" h={`calc(100vh - ${HEADER_HEIGHT})`} mt={HEADER_HEIGHT}>
          <DrawerHeader borderBottomWidth="1px" borderColor="whiteAlpha.200" py={3}>
            <Flex align="center" w="full">
              <IconButton
                aria-label="Go back"
                icon={<ChevronLeftIcon boxSize={6} />}
                variant="ghost"
                size="sm"
                onClick={onReceiveClose}
                mr={2}
              />
              <Text fontWeight="semibold" fontSize="lg">
                Receive
              </Text>
            </Flex>
          </DrawerHeader>
          <DrawerBody p={0}>
            <Receive onClose={onReceiveClose} balances={balances} />
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    </Flex>
  );
};

export default withErrorBoundary(withSuspense(SidePanel, <div>Loading...</div>), <div>Error Occurred</div>);
