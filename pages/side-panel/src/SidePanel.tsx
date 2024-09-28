import React, { useState, useEffect } from 'react';
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
} from '@chakra-ui/react';
import { ChevronLeftIcon, RepeatIcon, SettingsIcon } from '@chakra-ui/icons';
import { withErrorBoundary, withSuspense } from '@extension/shared';

import Connect from './components/Connect';
import Loading from './components/Loading';
import Balances from './components/Balances';
import Asset from './components/Asset';
import Settings from './components/Settings';

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
  const [loading, setLoading] = useState(true);
  const [keepkeyState, setKeepkeyState] = useState<number | null>(null);
  const [assetContext, setAssetContext] = useState<any>(null);
  const [transactionContext, setTransactionContext] = useState<any>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false); // Added state to handle loading spinner

  const { isOpen: isSettingsOpen, onOpen: onSettingsOpen, onClose: onSettingsClose } = useDisclosure();

  const refreshBalances = async () => {
    try {
      setIsRefreshing(true); // Start the loading spinner
      setKeepkeyState(null);
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
      setTimeout(() => setIsRefreshing(false), 2000); // Stop the spinner after 2 seconds (adjust as needed)
    }
  };

  useEffect(() => {
    const messageListener = (message: any) => {
      if (message.type === 'KEEPKEY_STATE_CHANGED' && message.state !== undefined) {
        setKeepkeyState(message.state);
      }
      if (message.type === 'ASSET_CONTEXT_UPDATED' && message.assetContext) {
        console.log('ASSET_CONTEXT_UPDATED:', message.assetContext);
        setAssetContext(message.assetContext);
      }
      if (message.type === 'TRANSACTION_CONTEXT_UPDATED' && message.transactionContext) {
        setTransactionContext(message.transactionContext);
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);
    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, []);

  const renderContent = () => {
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
        }
        return <Balances balances={balances} loading={loading} />;
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
              isLoading={isRefreshing} // Disable and show spinner while loading
              disabled={isRefreshing} // Prevent multiple presses
            >
              {isRefreshing ? <Spinner size="md" color="white" /> : 'Begin'}
            </Button>
          </Flex>
        );
    }
  };

  return (
    <Flex direction="column" width="100%" height="100vh" p={4}>
      <Box mb={4}>
        <Text fontWeight="bold">
          KeepKey State: {keepkeyState !== null ? keepkeyState : 'N/A'} -{' '}
          {keepkeyState !== null ? stateNames[keepkeyState] : 'unknown'}
        </Text>
        <Flex alignItems="center" p={4} borderBottom="1px solid #ccc" width="100%">
          {assetContext ? (
            <IconButton icon={<ChevronLeftIcon />} aria-label="Go back" onClick={() => setAssetContext(null)} />
          ) : (
            <IconButton icon={<SettingsIcon />} aria-label="Settings" onClick={onSettingsOpen} />
          )}
          <IconButton icon={<RepeatIcon />} aria-label="Refresh" onClick={() => refreshBalances()} ml="auto" />
        </Flex>
      </Box>
      {renderContent()}

      <Modal isOpen={isSettingsOpen} onClose={onSettingsClose} size="xl">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            <Text fontSize="lg" fontWeight="bold" textAlign="center">
              Settings For Your KeepKey
            </Text>
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Settings />
          </ModalBody>
        </ModalContent>
      </Modal>
    </Flex>
  );
};

export default withErrorBoundary(withSuspense(SidePanel, <div>Loading...</div>), <div>Error Occurred</div>);
