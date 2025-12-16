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
  Tooltip,
  Heading,
  Icon,
  HStack,
  VStack,
  Drawer,
  DrawerOverlay,
  DrawerContent,
  DrawerHeader,
  DrawerBody,
  DrawerCloseButton,
  Avatar,
  Badge,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  useToast,
} from '@chakra-ui/react';
import {
  ChevronLeftIcon,
  RepeatIcon,
  SettingsIcon,
  CalendarIcon,
  CheckCircleIcon,
  WarningIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  ChevronDownIcon,
  CopyIcon,
  CheckIcon,
  AddIcon,
} from '@chakra-ui/icons';
import { withErrorBoundary, withSuspense } from '@extension/shared';

import Connect from './components/Connect';
import Loading from './components/Loading';
import Balances from './components/Balances';
import Asset from './components/Asset';
import History from './components/History';
import Settings from './components/Settings';
import { Transfer } from './components/Transfer';
import { Receive } from './components/Receive';
import { DonutChart, ChartLegend, DonutChartItem } from './components/chart';

const stateNames: { [key: number]: string } = {
  0: 'unknown',
  1: 'disconnected',
  2: 'connected',
  3: 'busy',
  4: 'errored',
  5: 'paired',
};

const SidePanel = () => {
  const [balances, setBalances] = useState<any[]>([]);
  const [totalUsdBalance, setTotalUsdBalance] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [keepkeyState, setKeepkeyState] = useState<number | null>(null);
  const [assetContext, setAssetContext] = useState<any>(null);
  const [transactionContext, setTransactionContext] = useState<any>(null);
  const [showBack, setShowBack] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedTokenForAction, setSelectedTokenForAction] = useState<any>(null);

  // New state for account selection
  const [networkContext, setNetworkContext] = useState<any>(null);
  const [pubkeyContext, setPubkeyContextState] = useState<any>(null);
  const [availablePubkeys, setAvailablePubkeys] = useState<any[]>([]);
  const [hasCopiedAddress, setHasCopiedAddress] = useState(false);

  const { isOpen: isSettingsOpen, onOpen: onSettingsOpen, onClose: onSettingsClose } = useDisclosure();
  const { isOpen: isSendOpen, onOpen: onSendOpen, onClose: onSendClose } = useDisclosure();
  const { isOpen: isReceiveOpen, onOpen: onReceiveOpen, onClose: onReceiveClose } = useDisclosure();
  const [activeSliceIndex, setActiveSliceIndex] = useState<number | null>(null);
  const toast = useToast();

  // Color palette for different assets
  const getAssetColor = (symbol: string): string => {
    const colorMap: { [key: string]: string } = {
      'BTC': '#F7931A',
      'ETH': '#627EEA',
      'USDT': '#26A17B',
      'USDC': '#2775CA',
      'BNB': '#F3BA2F',
      'XRP': '#23292F',
      'ADA': '#0033AD',
      'DOGE': '#C2A633',
      'SOL': '#14F195',
      'DOT': '#E6007A',
      'MATIC': '#8247E5',
      'LTC': '#345D9D',
      'AVAX': '#E84142',
      'ATOM': '#2E3148',
      'RUNE': '#33FF99',
      'MAYA': '#00C9FF',
      'OSMO': '#5E12A0',
      'BCH': '#8DC351',
      'DASH': '#008CE7',
    };

    return colorMap[symbol.toUpperCase()] || `#${Math.floor(Math.random() * 16777215).toString(16)}`;
  };

  // Fetch total balance from all tokens
  const fetchTotalBalance = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'GET_APP_BALANCES' }, response => {
      if (response && response.balances) {
        setBalances(response.balances);
        const total = response.balances.reduce((sum: number, b: any) => sum + parseFloat(b.valueUsd || '0'), 0);
        setTotalUsdBalance(total);
      }
    });
  }, []);

  useEffect(() => {
    if (keepkeyState === 5) {
      fetchTotalBalance();
    }
  }, [keepkeyState, fetchTotalBalance]);

  // Handle global send action
  const handleGlobalSend = () => {
    if (balances.length > 0) {
      // Find the token with highest USD value as default
      const sortedBalances = [...balances].sort(
        (a, b) => parseFloat(b.valueUsd || '0') - parseFloat(a.valueUsd || '0'),
      );
      const defaultToken = sortedBalances[0];
      setSelectedTokenForAction(defaultToken);
      // Set asset context and open send
      chrome.runtime.sendMessage({ type: 'SET_ASSET_CONTEXT', asset: defaultToken }, () => {
        onSendOpen();
      });
    }
  };

  // Handle global receive action
  const handleGlobalReceive = () => {
    if (balances.length > 0) {
      const sortedBalances = [...balances].sort(
        (a, b) => parseFloat(b.valueUsd || '0') - parseFloat(a.valueUsd || '0'),
      );
      const defaultToken = sortedBalances[0];
      setSelectedTokenForAction(defaultToken);
      chrome.runtime.sendMessage({ type: 'SET_ASSET_CONTEXT', asset: defaultToken }, () => {
        onReceiveOpen();
      });
    }
  };

  const refreshBalances = async () => {
    try {
      setIsRefreshing(true);
      setKeepkeyState(null);
      chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' }, response => {
        if (response?.success) {
          console.log('Sidebar opened successfully');
        } else {
          console.error('Failed to open sidebar:', response?.error);
        }
      });
      chrome.runtime.sendMessage({ type: 'ON_START' }, response => {
        if (response?.success) {
          console.log('Sidebar opened successfully');
        } else {
          console.error('Failed to open sidebar:', response?.error);
        }
      });
    } catch (e) {
      console.error(e);
    } finally {
      setTimeout(() => setIsRefreshing(false), 12000); // Stop the spinner after 2 seconds
    }
  };

  // Fetch contexts on mount
  useEffect(() => {
    const fetchContexts = () => {
      chrome.runtime.sendMessage({ type: 'GET_ASSET_CONTEXT' }, response => {
        if (response?.assets) {
          setAssetContext(response.assets);
          setNetworkContext(response.assets);

          // Fetch pubkeys for this network
          if (response.assets.networkId) {
            chrome.runtime.sendMessage(
              {
                type: 'GET_PUBKEYS_FOR_NETWORK',
                networkId: response.assets.networkId,
              },
              pubkeyResponse => {
                if (pubkeyResponse?.pubkeys) {
                  setAvailablePubkeys(pubkeyResponse.pubkeys);
                }
              },
            );
          }
        }
      });

      chrome.runtime.sendMessage({ type: 'GET_PUBKEY_CONTEXT' }, response => {
        if (response?.pubkeyContext) {
          setPubkeyContextState(response.pubkeyContext);
        }
      });
    };

    fetchContexts();
  }, []);

  useEffect(() => {
    const messageListener = (message: any) => {
      if (message.type === 'KEEPKEY_STATE_CHANGED' && message.state !== undefined) {
        setKeepkeyState(message.state);
      }
      if (message.type === 'ASSET_CONTEXT_UPDATED' && message.assetContext) {
        setAssetContext(message.assetContext);
        setNetworkContext(message.assetContext);
        setShowBack(true);

        // Refresh available pubkeys for new network
        if (message.assetContext.networkId) {
          chrome.runtime.sendMessage(
            {
              type: 'GET_PUBKEYS_FOR_NETWORK',
              networkId: message.assetContext.networkId,
            },
            response => {
              if (response?.pubkeys) {
                setAvailablePubkeys(response.pubkeys);
              }
            },
          );
        }
      }
      if (message.type === 'PUBKEY_CONTEXT_UPDATED' && message.pubkeyContext) {
        setPubkeyContextState(message.pubkeyContext);
      }
      if (message.type === 'TRANSACTION_CONTEXT_UPDATED' && message.id) {
        console.log('TRANSACTION_CONTEXT_UPDATED', message.id);
        setTransactionContext(message.id); // Show Activity page on transaction event
        setShowBack(true); // Ensure the "Back" button is shown
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);
    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, []);

  const renderContent = () => {
    // If transactionContext is available, show the History view
    if (transactionContext) {
      return <History transactionContext={transactionContext} />;
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
        if (assetContext) {
          return <Asset asset={assetContext} onClose={() => setAssetContext(null)} />;
        } else {
          return <Balances balances={balances} loading={loading} setShowBack={setShowBack} />;
        }
      default:
        return (
          <Flex direction="column" justifyContent="center" alignItems="center" height="100%">
            <Text fontSize="2xl" fontWeight="bold" textAlign="center" mb={4}>
              Welcome to the KeepKey Browser Extension
            </Text>
            <Button
              colorScheme="green"
              size="lg"
              onClick={refreshBalances}
              isLoading={isRefreshing}
              disabled={isRefreshing}>
              {isRefreshing ? <Spinner size="md" color="white" /> : 'Begin'}
            </Button>
          </Flex>
        );
    }
  };

  const handleSettingsClick = () => {
    if (showBack) {
      // Clear assetContext on the frontend
      setAssetContext(null);
      setTransactionContext(null);
      setShowBack(false); // Hide the back button

      // Clear assetContext on the backend
      chrome.runtime.sendMessage({ type: 'CLEAR_ASSET_CONTEXT' }, response => {
        if (response?.success) {
          console.log('Asset context cleared on backend');
        } else {
          console.error('Failed to clear asset context on backend:', response?.error);
        }
      });
    } else {
      // Open settings
      onSettingsOpen();
      setShowBack(true); // Show the back button when settings are opened
    }
  };

  const handleTransactionsClick = () => {
    try {
      setTransactionContext('none'); // Switch to the transaction context
      setShowBack(true); // Show the back button
    } catch (e) {
      console.error(e);
    }
  };

  // Format currency for display
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  // Helper functions for account selection
  const formatAddress = (address: string) => {
    if (!address) return '';
    if (address.length <= 16) return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const getAccountLabel = (pubkey: any, allPubkeys: any[], index?: number) => {
    // Try to extract account number from note
    if (pubkey?.note) {
      const match = pubkey.note.match(/account\s*(\d+)/i);
      if (match) {
        return `Account ${match[1]}`;
      }
    }
    // Try from addressNList (last hardened index)
    if (pubkey?.addressNList && pubkey.addressNList.length > 2) {
      const accountIndex = pubkey.addressNList[2] & 0x7fffffff; // Remove hardening bit
      return `Account ${accountIndex}`;
    }
    // Fallback to array index
    return `Account ${index ?? 0}`;
  };

  const isSelectedPubkey = (pubkey: any, current: any) => {
    if (!current) return false;
    return (
      pubkey.address === current.address || pubkey.pubkey === current.pubkey || pubkey.master === current.master
    );
  };

  const handleAccountSelect = (pubkey: any) => {
    chrome.runtime.sendMessage(
      {
        type: 'SET_PUBKEY_CONTEXT',
        pubkey,
      },
      response => {
        if (response?.success) {
          setPubkeyContextState(response.pubkeyContext);
          toast({
            title: 'Account switched',
            description: `Now using ${getAccountLabel(pubkey, availablePubkeys)}`,
            status: 'success',
            duration: 2000,
          });
        }
      },
    );
  };

  const handleCopyAddress = () => {
    const address = pubkeyContext?.address || pubkeyContext?.master;
    if (address) {
      navigator.clipboard.writeText(address);
      setHasCopiedAddress(true);
      toast({
        title: 'Address copied!',
        status: 'success',
        duration: 2000,
      });
      setTimeout(() => setHasCopiedAddress(false), 2000);
    }
  };

  const handleAddAccount = () => {
    // TODO: Open modal to select network and account type
    // For now, just show a message
    toast({
      title: 'Add Account',
      description: 'Feature coming soon - allows adding new derivation paths',
      status: 'info',
      duration: 3000,
    });
  };

  // Transform balances into chart data
  const chartData: DonutChartItem[] = balances
    .filter((balance: any) => parseFloat(balance.valueUsd || '0') > 0)
    .map((balance: any) => ({
      name: balance.symbol || balance.ticker || 'Unknown',
      value: parseFloat(balance.valueUsd || '0'),
      color: getAssetColor(balance.symbol || balance.ticker || ''),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10); // Limit to top 10 assets for clarity

  return (
    <Flex direction="column" width="100%" height="100vh" p={4}>
      {/* Enhanced Header with Network + Account Selection */}
      <Flex alignItems="center" justifyContent="space-between" mb={2} gap={2} flexWrap="wrap">
        {/* Left: Back/Settings + Logo + Status */}
        <Flex alignItems="center" gap={2}>
          <IconButton
            icon={showBack ? <ChevronLeftIcon boxSize={5} /> : <SettingsIcon />}
            aria-label={showBack ? 'Back' : 'Settings'}
            variant="ghost"
            size="sm"
            onClick={handleSettingsClick}
          />
          <Avatar size="xs" src="https://api.keepkey.info/coins/keepkey.png" />
          <Tooltip label={`${keepkeyState !== null ? stateNames[keepkeyState] : 'unknown'}`} placement="right" hasArrow>
            <span>
              {keepkeyState === 5 ? (
                <Icon as={CheckCircleIcon} color="green.400" boxSize={4} />
              ) : (
                <Icon as={WarningIcon} color="yellow.400" boxSize={4} />
              )}
            </span>
          </Tooltip>
        </Flex>

        {/* Center/Right: Network + Account Selector (only when paired) */}
        {keepkeyState === 5 && networkContext && (
          <Flex alignItems="center" gap={2} flex={1} justifyContent="flex-end">
            {/* Network Logo */}
            <Avatar size="xs" src={networkContext.icon} />

            {/* Account Dropdown + Copy Button */}
            <Menu>
              <MenuButton
                as={Box}
                cursor="pointer"
                _hover={{ opacity: 0.8 }}
                px={2}
                py={1}
                borderRadius="md"
                bg="whiteAlpha.100">
                <Flex alignItems="center" gap={1}>
                  <Text fontSize="xs" color="whiteAlpha.600">
                    {getAccountLabel(pubkeyContext, availablePubkeys)}
                  </Text>
                  <Text fontFamily="mono" fontSize="xs" color="white">
                    {formatAddress(pubkeyContext?.address || pubkeyContext?.master)}
                  </Text>
                  <ChevronDownIcon boxSize={3} />
                </Flex>
              </MenuButton>

              <MenuList bg="gray.800" borderColor="whiteAlpha.200" minW="200px">
                {availablePubkeys.map((pubkey, index) => (
                  <MenuItem
                    key={index}
                    onClick={() => handleAccountSelect(pubkey)}
                    bg={isSelectedPubkey(pubkey, pubkeyContext) ? 'whiteAlpha.200' : 'transparent'}
                    _hover={{ bg: 'whiteAlpha.100' }}>
                    <VStack align="start" spacing={0}>
                      <Text fontSize="xs" color="whiteAlpha.600">
                        {getAccountLabel(pubkey, availablePubkeys, index)}
                      </Text>
                      <Text fontFamily="mono" fontSize="xs">
                        {formatAddress(pubkey.address || pubkey.master)}
                      </Text>
                    </VStack>
                  </MenuItem>
                ))}

                {/* Add Account Button */}
                <MenuItem icon={<AddIcon />} onClick={handleAddAccount} color="blue.400" _hover={{ bg: 'whiteAlpha.100' }}>
                  Add Account
                </MenuItem>
              </MenuList>
            </Menu>

            {/* Copy Address Button */}
            <IconButton
              icon={hasCopiedAddress ? <CheckIcon /> : <CopyIcon />}
              aria-label="Copy address"
              size="xs"
              variant="ghost"
              colorScheme={hasCopiedAddress ? 'green' : 'gray'}
              onClick={handleCopyAddress}
            />
          </Flex>
        )}

        {/* Refresh Button */}
        <IconButton
          icon={<RepeatIcon />}
          aria-label="Refresh"
          variant="ghost"
          size="sm"
          isLoading={isRefreshing}
          onClick={() => refreshBalances()}
        />
      </Flex>

      {/* Total Balance & Global Actions - Only show when paired */}
      {keepkeyState === 5 && !showBack && (
        <Box
          bg="rgba(255, 255, 255, 0.05)"
          borderRadius="xl"
          p={5}
          mb={4}
          border="1px solid"
          borderColor="whiteAlpha.100">
          {/* Total Balance with Donut Chart */}
          <VStack spacing={3} mb={4}>
            <Text fontSize="sm" color="whiteAlpha.600" fontWeight="medium">
              Total Balance
            </Text>

            {/* Donut Chart */}
            {chartData.length > 0 ? (
              <Flex direction="column" align="center" width="100%">
                <DonutChart
                  data={chartData}
                  height={200}
                  width={200}
                  showTotalLabel={false}
                  activeIndex={activeSliceIndex ?? undefined}
                  onHoverSlice={setActiveSliceIndex}
                />

                {/* Total Balance Display */}
                <Heading size="xl" color="white" mt={2}>
                  {formatCurrency(totalUsdBalance)}
                </Heading>

                {/* Chart Legend - Shows active slice info */}
                <Box width="100%" mt={2}>
                  <ChartLegend
                    data={chartData}
                    total={totalUsdBalance}
                    activeIndex={activeSliceIndex ?? undefined}
                  />
                </Box>
              </Flex>
            ) : (
              <Heading size="xl" color="white">
                {formatCurrency(totalUsdBalance)}
              </Heading>
            )}
          </VStack>

          {/* Global Action Buttons */}
          <HStack spacing={3} justify="center">
            <Button
              leftIcon={<ArrowUpIcon />}
              colorScheme="blue"
              variant="solid"
              size="md"
              flex={1}
              onClick={handleGlobalSend}
              isDisabled={balances.length === 0}>
              Send
            </Button>
            <Button
              leftIcon={<ArrowDownIcon />}
              colorScheme="green"
              variant="solid"
              size="md"
              flex={1}
              onClick={handleGlobalReceive}
              isDisabled={balances.length === 0}>
              Receive
            </Button>
          </HStack>
        </Box>
      )}

      {/* Render the appropriate content */}
      <Box flex={1} overflowY="auto">
        {renderContent()}
      </Box>

      {/* Modal for Settings */}
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
        <DrawerContent bg="gray.900" h="100vh">
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
        <DrawerContent bg="gray.900" h="100vh">
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
