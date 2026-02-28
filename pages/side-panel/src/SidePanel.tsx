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
  Avatar,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  useToast,
} from '@chakra-ui/react';
import {
  RepeatIcon,
  SettingsIcon,
  CheckCircleIcon,
  WarningIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  CopyIcon,
  CheckIcon,
  AddIcon,
} from '@chakra-ui/icons';
import { withErrorBoundary, withSuspense } from '@extension/shared';

import Connect from './components/Connect';
import Loading from './components/Loading';
import Balances from './components/Balances';
import History from './components/History';
import Settings from './components/Settings';
import { Transfer } from './components/Transfer';
import { Receive } from './components/Receive';
import AssetDetail from './components/AssetDetail';

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
  const [keepkeyState, setKeepkeyState] = useState<number | null>(null);
  const [transactionContext, setTransactionContext] = useState<any>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<any>(null);

  // Account selection state
  const [networkContext, setNetworkContext] = useState<any>(null);
  const [pubkeyContext, setPubkeyContextState] = useState<any>(null);
  const [availablePubkeys, setAvailablePubkeys] = useState<any[]>([]);
  const [hasCopiedAddress, setHasCopiedAddress] = useState(false);

  // Disclosures for drawers/modals
  const { isOpen: isSettingsOpen, onOpen: onSettingsOpen, onClose: onSettingsClose } = useDisclosure();
  const { isOpen: isSendOpen, onOpen: onSendOpen, onClose: onSendClose } = useDisclosure();
  const { isOpen: isReceiveOpen, onOpen: onReceiveOpen, onClose: onReceiveClose } = useDisclosure();
  const { isOpen: isAssetDetailOpen, onOpen: onAssetDetailOpen, onClose: onAssetDetailClose } = useDisclosure();
  const toast = useToast();

  // Fetch total balance
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

  // Handle asset selection from Balances list
  const handleAssetSelect = (asset: any) => {
    setSelectedAsset(asset);
    chrome.runtime.sendMessage({ type: 'SET_ASSET_CONTEXT', asset }, () => {
      onAssetDetailOpen();
    });
  };

  // Handle global send action
  const handleGlobalSend = () => {
    if (balances.length > 0) {
      const sortedBalances = [...balances].sort(
        (a, b) => parseFloat(b.valueUsd || '0') - parseFloat(a.valueUsd || '0'),
      );
      const defaultToken = sortedBalances[0];
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

  // Fetch contexts on mount
  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_PUBKEY_CONTEXT' }, response => {
      if (response?.pubkeyContext) {
        setPubkeyContextState(response.pubkeyContext);
      }
    });
  }, []);

  // Listen for state changes
  useEffect(() => {
    const messageListener = (message: any) => {
      if (message.type === 'KEEPKEY_STATE_CHANGED' && message.state !== undefined) {
        setKeepkeyState(message.state);
      }
      if (message.type === 'ASSET_CONTEXT_UPDATED' && message.assetContext) {
        setNetworkContext(message.assetContext);
        if (message.assetContext.networkId) {
          chrome.runtime.sendMessage(
            { type: 'GET_PUBKEYS_FOR_NETWORK', networkId: message.assetContext.networkId },
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
        setTransactionContext(message.id);
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);
    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, []);

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
    if (pubkey?.note) {
      const match = pubkey.note.match(/account\s*(\d+)/i);
      if (match) return `Account ${match[1]}`;
    }
    if (pubkey?.addressNList && pubkey.addressNList.length > 2) {
      const accountIndex = pubkey.addressNList[2] & 0x7fffffff;
      return `Account ${accountIndex}`;
    }
    return `Account ${index ?? 0}`;
  };

  const isSelectedPubkey = (pubkey: any, current: any) => {
    if (!current) return false;
    return pubkey.address === current.address || pubkey.pubkey === current.pubkey || pubkey.master === current.master;
  };

  const handleAccountSelect = (pubkey: any) => {
    chrome.runtime.sendMessage({ type: 'SET_PUBKEY_CONTEXT', pubkey }, response => {
      if (response?.success) {
        setPubkeyContextState(response.pubkeyContext);
        toast({
          title: 'Account switched',
          description: `Now using ${getAccountLabel(pubkey, availablePubkeys)}`,
          status: 'success',
          duration: 2000,
        });
      }
    });
  };

  const handleCopyAddress = () => {
    const address = pubkeyContext?.address || pubkeyContext?.master;
    if (address) {
      navigator.clipboard.writeText(address);
      setHasCopiedAddress(true);
      toast({ title: 'Address copied!', status: 'success', duration: 2000 });
      setTimeout(() => setHasCopiedAddress(false), 2000);
    }
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

  return (
    <Flex direction="column" width="100%" height="100vh" p={4}>
      {/* Header */}
      <Flex alignItems="center" justifyContent="space-between" mb={2} gap={2}>
        {/* Left: Settings + Logo + Status */}
        <Flex alignItems="center" gap={2}>
          <IconButton
            icon={<SettingsIcon />}
            aria-label="Settings"
            variant="ghost"
            size="sm"
            onClick={onSettingsOpen}
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

        {/* Center: Account Selector (only when paired) */}
        {keepkeyState === 5 && availablePubkeys.length > 0 && (
          <Flex alignItems="center" gap={2} flex={1} justifyContent="flex-end">
            {networkContext?.icon && <Avatar size="xs" src={networkContext.icon} />}
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
                <MenuItem
                  icon={<AddIcon />}
                  onClick={() =>
                    toast({ title: 'Add Account', description: 'Feature coming soon', status: 'info', duration: 3000 })
                  }
                  color="blue.400"
                  _hover={{ bg: 'whiteAlpha.100' }}>
                  Add Account
                </MenuItem>
              </MenuList>
            </Menu>
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

      {/* Total Balance & Quick Actions - Only when paired and on home screen */}
      {keepkeyState === 5 && !transactionContext && (
        <Box mb={3} textAlign="center">
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
      <Box flex={1} overflowY="auto">
        {renderContent()}
      </Box>

      {/* Asset Detail Drawer */}
      <Drawer isOpen={isAssetDetailOpen} placement="bottom" onClose={onAssetDetailClose} size="full">
        <DrawerOverlay bg="blackAlpha.800" />
        <DrawerContent bg="gray.900" h="100vh">
          <DrawerHeader borderBottomWidth="1px" borderColor="whiteAlpha.200" py={3}>
            <Flex align="center" w="full">
              <IconButton
                aria-label="Go back"
                icon={<ChevronLeftIcon boxSize={6} />}
                variant="ghost"
                size="sm"
                onClick={onAssetDetailClose}
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
