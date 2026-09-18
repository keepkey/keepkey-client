import React, { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
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
  Drawer,
  DrawerOverlay,
  DrawerContent,
  DrawerHeader,
  DrawerBody,
} from '@chakra-ui/react';
import { ArrowUpIcon, ArrowDownIcon, ChevronLeftIcon, RepeatIcon } from '@chakra-ui/icons';
import { withErrorBoundary, withSuspense } from '@extension/shared';
import { requestStorage } from '@extension/storage';

import Connect from './components/Connect';
import Loading from './components/Loading';
import Balances from './components/Balances';
import { SpinningDevice } from './components/SpinningDevice';
import History from './components/History';
import Settings from './components/Settings';
import { Transfer } from './components/Transfer';
import { Receive } from './components/Receive';
import Swap from './swap/Swap';
import AssetDetail from './components/AssetDetail';
import NetworkAccountHeader from './components/NetworkAccountHeader';
import RollingBalance from './components/v2/RollingBalance';
import AllocationBar, { type AllocationSegment } from './components/v2/AllocationBar';
import { colorForSymbol } from './styles/assetColor';
import Transaction from './approval/Transaction';

// Events older than this are dropped on load — an abandoned-tab pending
// request shouldn't hijack the sidebar forever.
const MAX_EVENT_AGE_MINUTES = 10;

// Drawers and modals open below the sticky header, which floats above them.
// Its height isn't fixed (the chain/account sub-bar only shows once paired),
// so it is measured at runtime and published on :root — modals portal out to
// <body>, outside any element we could scope the variable to.
const HEADER_HEIGHT = 'var(--kk-header-h)';

// Page drawers run without Chakra's focus lock (see the Asset Detail drawer),
// and that lock is what moved focus into a drawer on open and back to the
// trigger on close. Without it focus stayed on the trigger behind the overlay:
// Escape (handled inside the drawer) did nothing and Enter re-fired the
// trigger. The drawer's portal mounts a frame after isOpen flips, hence rAF.
// `isOpen` must mean "open and in the DOM": the approval takeover unmounts the
// drawers while their disclosure stays open, and the drawer has to be focused
// again when it remounts. Layout effect so the trigger is read before the page
// body turns inert, which takes focus off it.
const useDrawerFocus = (isOpen: boolean) => {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!isOpen) return;
    const trigger = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => ref.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      trigger?.focus();
    };
  }, [isOpen]);
  return ref;
};

const SidePanel = () => {
  const [balances, setBalances] = useState<any[]>([]);
  const [totalUsdBalance, setTotalUsdBalance] = useState<number>(0);
  const [keepkeyState, setKeepkeyState] = useState<number | null>(null);
  const [transactionContext, setTransactionContext] = useState<any>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<any>(null);
  // CAIP to preselect as the swap "from" when launched from an asset page;
  // undefined when opened via the generic home Swap button.
  const [swapFromCaip, setSwapFromCaip] = useState<string | undefined>(undefined);
  const [balancesInitialLoading, setBalancesInitialLoading] = useState(true);
  const [pendingEvent, setPendingEvent] = useState<any | null>(null);
  // "Add blockchain" picker takeover — lifted out of <Balances> so the home
  // button and dashboard-hiding logic can see it. Keeping it inside Balances
  // meant SidePanel kept rendering the donut/balance/Send-Receive block on
  // top of the picker, and the home button couldn't reset it.
  const [showAddBlockchain, setShowAddBlockchain] = useState(false);

  // Disclosures for drawers/modals
  const { isOpen: isSettingsOpen, onOpen: onSettingsOpen, onClose: onSettingsClose } = useDisclosure();
  const { isOpen: isSendOpen, onOpen: onSendOpen, onClose: onSendClose } = useDisclosure();
  const { isOpen: isReceiveOpen, onOpen: onReceiveOpen, onClose: onReceiveClose } = useDisclosure();
  const { isOpen: isSwapOpen, onOpen: onSwapOpen, onClose: onSwapClose } = useDisclosure();
  const { isOpen: isAssetDetailOpen, onOpen: onAssetDetailOpen, onClose: onAssetDetailClose } = useDisclosure();
  // Page drawers that are open and in the DOM (see useDrawerFocus), in JSX order.
  const drawersOpen: Record<string, boolean> = {
    assetDetail: isAssetDetailOpen && !pendingEvent,
    send: isSendOpen && !pendingEvent,
    receive: isReceiveOpen && !pendingEvent,
    swap: isSwapOpen && !pendingEvent,
  };
  const assetDetailRef = useDrawerFocus(drawersOpen.assetDetail);
  const sendRef = useDrawerFocus(drawersOpen.send);
  const receiveRef = useDrawerFocus(drawersOpen.receive);
  const swapRef = useDrawerFocus(drawersOpen.swap);
  const anyDrawerOpen = isAssetDetailOpen || isSendOpen || isReceiveOpen || isSwapOpen;

  // Drawers stack: Asset Detail opens Send / Receive over itself, and the
  // header's chain picker (live over every drawer) opens Asset Detail over the
  // others. Each drawer's portal mounts when it opens, so the last one opened
  // is on top; drawers remounting together after the approval takeover mount
  // in JSX order. Without the focus trap Tab would reach a covered drawer's
  // controls, so every open drawer but the top one is inert. Adjusted during
  // render, not in an effect, so a drawer stops being inert in the same commit
  // that closes the one above it, before useDrawerFocus refocuses its trigger.
  const [drawerStack, setDrawerStack] = useState<string[]>([]);
  const nextDrawerStack = [
    ...drawerStack.filter(id => drawersOpen[id]),
    ...Object.keys(drawersOpen).filter(id => drawersOpen[id] && !drawerStack.includes(id)),
  ];
  if (nextDrawerStack.join() !== drawerStack.join()) setDrawerStack(nextDrawerStack);
  const coveredDrawerProps = (id: string) => ({
    inert: nextDrawerStack.slice(0, -1).includes(id) ? '' : undefined,
  });

  // Publishes the sticky header's height for HEADER_HEIGHT. The element is held
  // in state (callback ref) so the observer re-attaches when the header
  // remounts after a pending dApp approval takeover.
  const [headerEl, setHeaderEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!headerEl) return;
    const observer = new ResizeObserver(() => {
      document.documentElement.style.setProperty('--kk-header-h', `${headerEl.offsetHeight}px`);
    });
    observer.observe(headerEl);
    return () => observer.disconnect();
  }, [headerEl]);

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

  // Allocation bar segments (KEEPKEY_STYLE.md §0). Chain brand colours are
  // enriched onto the balance rows by the background where known; fall back to
  // the shared deterministic palette so a segment is never colourless.
  // Balances carry one row per pubkey, so a caip repeats (BTC script types,
  // extra accounts); sum per caip or the bar gets duplicate keys and the legend
  // splits one asset in two.
  const allocationSegments: AllocationSegment[] = React.useMemo(() => {
    const byId = new Map<string, AllocationSegment>();
    for (const b of balances) {
      const label = b.symbol || b.ticker || '?';
      const id = b.caip || `${b.networkId}:${label}`;
      const value = parseFloat(b.valueUsd || '0');
      const seg = byId.get(id);
      if (seg) seg.value += value;
      else byId.set(id, { id, label, color: b.color || colorForSymbol(label), value });
    }
    return [...byId.values()].filter(s => s.value > 0);
  }, [balances]);

  // Segments grow from scaleX(0); flipping this a frame after the balances land
  // is what gives the transition somewhere to travel from.
  const [allocationGrown, setAllocationGrown] = useState(false);
  useEffect(() => {
    if (balancesInitialLoading || allocationSegments.length === 0) {
      setAllocationGrown(false);
      return;
    }
    const id = window.setTimeout(() => setAllocationGrown(true), 80);
    return () => window.clearTimeout(id);
  }, [balancesInitialLoading, allocationSegments.length]);

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

  // Shield-badge "home" action — collapse any open drawers and clear context
  // so the user lands back on the Balances view.
  const handleGoHome = () => {
    if (isAssetDetailOpen) handleAssetDetailClose();
    if (isSendOpen) onSendClose();
    if (isReceiveOpen) onReceiveClose();
    if (isSwapOpen) onSwapClose();
    if (transactionContext) setTransactionContext(null);
    if (showAddBlockchain) setShowAddBlockchain(false);
    setSelectedAsset(null);
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

  const handleAssetSwap = () => {
    setSwapFromCaip(selectedAsset?.caip);
    handleAssetDetailClose();
    onSwapOpen();
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
        // Update the selected-asset state so an already-open drawer
        // reflects the new context, but DON'T auto-open. This listener
        // fires on every SET_ASSET_CONTEXT — including our own header
        // auto-default sync on cold start and dApp-triggered chain
        // switches — and users shouldn't have a drawer surface
        // unprompted. Explicit opens go through handleAssetSelect
        // (asset list / header click), which both setSelectedAsset
        // AND onAssetDetailOpen.
        setSelectedAsset(asset);
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
  }, [fetchTotalBalance]);

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
        return (
          <Balances
            onSelectAsset={handleAssetSelect}
            showAddBlockchain={showAddBlockchain}
            setShowAddBlockchain={setShowAddBlockchain}
          />
        );
      default:
        return (
          <Flex direction="column" justifyContent="center" alignItems="center" height="100%" minH="300px">
            <Box mb={4}>
              <SpinningDevice scale={0.46} durationSeconds={10} label="KEEPKEY" />
            </Box>
            <Text fontSize="xl" fontWeight="bold" textAlign="center" mb={1} color="white">
              Welcome to KeepKey
            </Text>
            <Text fontSize="sm" color="whiteAlpha.600" mb={5} textAlign="center">
              Your hardware wallet, in the browser
            </Text>
            <Button
              variant="outline"
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
      <Flex direction="column" width="100%" height="100vh" bg="kk.bg" overflowY="auto" p={4}>
        <Transaction event={pendingEvent} reloadEvents={fetchPendingEvent} onDismiss={fetchPendingEvent} />
      </Flex>
    );
  }

  return (
    <Flex direction="column" width="100%" height="100vh">
      {/* Sticky header — floats above drawers */}
      <Box
        ref={setHeaderEl}
        position="sticky"
        top={0}
        zIndex={1500}
        bg="kk.bg"
        borderBottom="1px solid"
        borderColor="kk.line"
        px={4}
        pt={4}
        pb={2}
        flexShrink={0}
        overflow="visible">
        <NetworkAccountHeader
          keepkeyState={keepkeyState}
          isRefreshing={isRefreshing}
          onSettingsOpen={onSettingsOpen}
          onHome={handleGoHome}
          onRefresh={refreshBalances}
          onSelectNetwork={handleAssetSelect}
        />
      </Box>

      {/* Scrollable body below header. Inert while a page drawer covers it:
          without the drawers' focus trap, Tab would otherwise walk into the
          balance rows and dashboard buttons behind the overlay. (Spread
          because React 18's types don't declare `inert` yet.) */}
      <Flex direction="column" flex={1} overflowY="auto" px={4} pb={4} {...{ inert: anyDrawerOpen ? '' : undefined }}>
        {/* Total Balance & Quick Actions - Only when paired and on home screen, after initial load */}
        {keepkeyState === 5 && !transactionContext && !balancesInitialLoading && !showAddBlockchain && (
          // v2 dashboard hero (KEEPKEY_STYLE.md §0): left-aligned editorial
          // block — micro label, rolling mono numeral, 3px allocation bar. The
          // donut is retired; a bar reads allocation at 400px and costs 3px of
          // height instead of 160.
          <Box mb={3}>
            <Text className="kk-eyebrow">Total balance</Text>
            <RollingBalance value={totalUsdBalance} size={40} />
            <AllocationBar segments={allocationSegments} grown={allocationGrown} />

            <Box display="grid" gridTemplateColumns="repeat(3,1fr)" gap="8px" mt="24px">
              <Button
                leftIcon={<ArrowUpIcon />}
                variant="solid"
                height="44px"
                fontSize="12px"
                onClick={handleGlobalSend}
                isDisabled={balances.length === 0}>
                Send
              </Button>
              <Button
                leftIcon={<RepeatIcon />}
                variant="keycapSecondary"
                height="44px"
                fontSize="12px"
                onClick={() => {
                  setSwapFromCaip(undefined);
                  onSwapOpen();
                }}>
                Swap
              </Button>
              <Button
                leftIcon={<ArrowDownIcon />}
                variant="keycapSecondary"
                height="44px"
                fontSize="12px"
                onClick={handleGlobalReceive}
                isDisabled={balances.length === 0}>
                Receive
              </Button>
            </Box>
          </Box>
        )}

        {/* Main content */}
        <Box flex={1}>{renderContent()}</Box>
      </Flex>

      {/* Asset Detail Drawer — no title bar: the sticky NetworkAccountHeader
          above already shows which network/account is active, so a second
          "Ethereum" header would duplicate context. A small back button floats
          over the body to preserve the close affordance.
          Every page drawer runs without Chakra's focus trap and scroll lock
          (trapFocus / blockScrollOnMount off): the header's chain/account
          sheets render above the drawer, and a focus trap would steal their
          search field while the scroll lock swallowed their wheel scroll.
          useDrawerFocus still moves focus in on open and back on close.
          useInert is off too, or the drawer would aria-hide the header along
          with the page; the page body is made inert instead. */}
      <Drawer
        isOpen={isAssetDetailOpen}
        placement="bottom"
        onClose={handleAssetDetailClose}
        size="full"
        trapFocus={false}
        blockScrollOnMount={false}
        useInert={false}>
        <DrawerOverlay bg="blackAlpha.800" />
        <DrawerContent
          ref={assetDetailRef}
          {...coveredDrawerProps('assetDetail')}
          bg="kk.bg"
          h={`calc(100vh - ${HEADER_HEIGHT})`}
          mt={HEADER_HEIGHT}>
          <DrawerBody p={0} position="relative">
            <IconButton
              aria-label="Close asset"
              icon={<ChevronLeftIcon boxSize={5} />}
              variant="ghost"
              size="sm"
              onClick={handleAssetDetailClose}
              position="absolute"
              top={2}
              left={2}
              zIndex={2}
            />
            <Box pt={10} px={4} pb={4} h="full">
              {selectedAsset && (
                <AssetDetail
                  asset={selectedAsset}
                  balances={balances}
                  onSend={handleAssetSend}
                  onReceive={handleAssetReceive}
                  onSwap={handleAssetSwap}
                />
              )}
            </Box>
          </DrawerBody>
        </DrawerContent>
      </Drawer>

      {/* Settings Modal */}
      <Modal isOpen={isSettingsOpen} onClose={onSettingsClose} size="xl" scrollBehavior="inside">
        <ModalOverlay />
        <ModalContent mt={HEADER_HEIGHT} maxH={`calc(85vh - ${HEADER_HEIGHT})`}>
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
      <Drawer
        isOpen={isSendOpen}
        placement="bottom"
        onClose={onSendClose}
        size="full"
        trapFocus={false}
        blockScrollOnMount={false}
        useInert={false}>
        <DrawerOverlay bg="blackAlpha.800" />
        <DrawerContent
          ref={sendRef}
          {...coveredDrawerProps('send')}
          bg="kk.bg"
          h={`calc(100vh - ${HEADER_HEIGHT})`}
          mt={HEADER_HEIGHT}>
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
      <Drawer
        isOpen={isReceiveOpen}
        placement="bottom"
        onClose={onReceiveClose}
        size="full"
        trapFocus={false}
        blockScrollOnMount={false}
        useInert={false}>
        <DrawerOverlay bg="blackAlpha.800" />
        <DrawerContent
          ref={receiveRef}
          {...coveredDrawerProps('receive')}
          bg="kk.bg"
          h={`calc(100vh - ${HEADER_HEIGHT})`}
          mt={HEADER_HEIGHT}>
          <DrawerBody p={0} position="relative">
            <IconButton
              aria-label="Close receive"
              icon={<ChevronLeftIcon boxSize={5} />}
              variant="ghost"
              size="sm"
              onClick={onReceiveClose}
              position="absolute"
              top={2}
              left={2}
              zIndex={2}
            />
            <Box pt={10} h="full">
              <Receive onClose={onReceiveClose} balances={balances} />
            </Box>
          </DrawerBody>
        </DrawerContent>
      </Drawer>

      {/* Swap Drawer — native swap UI (faithful port of the BEX design); the Swap
          component provides its own back/close affordance. */}
      <Drawer
        isOpen={isSwapOpen}
        placement="bottom"
        onClose={onSwapClose}
        size="full"
        trapFocus={false}
        blockScrollOnMount={false}
        useInert={false}>
        <DrawerOverlay bg="blackAlpha.800" />
        <DrawerContent
          ref={swapRef}
          {...coveredDrawerProps('swap')}
          bg="kk.bg"
          h={`calc(100vh - ${HEADER_HEIGHT})`}
          mt={HEADER_HEIGHT}>
          <DrawerBody p={0}>
            <Swap onClose={onSwapClose} initialFromCaip={swapFromCaip} />
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    </Flex>
  );
};

export default withErrorBoundary(withSuspense(SidePanel, <div>Loading...</div>), <div>Error Occurred</div>);
