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
import { ChevronLeftIcon, RepeatIcon, SettingsIcon, CalendarIcon } from '@chakra-ui/icons'; // Using CalendarIcon for Activity
import { withErrorBoundary, withSuspense } from '@extension/shared';

import Connect from './components/Connect';
import Loading from './components/Loading';
import Balances from './components/Balances';
import Asset from './components/Asset';
import History from './components/History';
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
  const [showBack, setShowBack] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { isOpen: isSettingsOpen, onOpen: onSettingsOpen, onClose: onSettingsClose } = useDisclosure();

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

  useEffect(() => {
    const messageListener = (message: any) => {
      if (message.type === 'KEEPKEY_STATE_CHANGED' && message.state !== undefined) {
        setKeepkeyState(message.state);
      }
      if (message.type === 'ASSET_CONTEXT_UPDATED' && message.assetContext) {
        setAssetContext(message.assetContext);
        setShowBack(true);
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

  return (
    <Flex direction="column" width="100%" height="100vh" p={4}>
      <Box mb={4}>
        <Text fontWeight="bold">
          KeepKey State: {keepkeyState !== null ? keepkeyState : 'N/A'} -{' '}
          {keepkeyState !== null ? stateNames[keepkeyState] : 'unknown'}
        </Text>

        {/* Row with left-aligned, centered, and right-aligned buttons */}
        <Flex alignItems="center" justifyContent="space-between" p={4} borderBottom="1px solid #ccc" width="100%">
          {/* Left-aligned button (Settings or Back depending on showBack) */}
          <IconButton
            icon={showBack ? <ChevronLeftIcon /> : <SettingsIcon />}
            aria-label={showBack ? 'Back' : 'Settings'}
            onClick={handleSettingsClick}
          />

          {/* Center-aligned Activity button */}
          <Box mx="auto">
            <IconButton
              icon={<CalendarIcon />} // Activity Icon
              aria-label="Activity"
              onClick={handleTransactionsClick} // Handle transaction context
            />
          </Box>

          {/* Right-aligned button (Refresh) */}
          <IconButton icon={<RepeatIcon />} aria-label="Refresh" onClick={() => refreshBalances()} />
        </Flex>
      </Box>

      {/* Render the appropriate content */}
      {renderContent()}

      {/* Modal for Settings */}
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
