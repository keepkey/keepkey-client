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
  VStack,
  HStack,
  Avatar,
  Switch,
  Button,
  Link,
  Image,
} from '@chakra-ui/react';
import { ChevronLeftIcon, RepeatIcon, SettingsIcon } from '@chakra-ui/icons';
import { withErrorBoundary, withSuspense } from '@extension/shared';

import Connect from './components/Connect';
import Loading from './components/Loading';
import Balances from './components/Balances';
import Asset from './components/Asset';

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

  const { isOpen: isSettingsOpen, onOpen: onSettingsOpen, onClose: onSettingsClose } = useDisclosure();

  const refreshBalances = async () => {
    try {
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
    }
  };

  // Timer to check if keepkeyState is not 5, and if so, call refreshBalances
  useEffect(() => {
    const timer = setInterval(() => {
      if (keepkeyState !== 5) {
        console.log('KeepKey state is not paired (5). Retrying...');
        refreshBalances();
      }
    }, 5000); // 5-second timer

    return () => clearInterval(timer); // Cleanup timer on component unmount
  }, [keepkeyState]); // Dependency on keepkeyState

  useEffect(() => {
    const messageListener = (message: any) => {
      if (message.type === 'KEEPKEY_STATE_CHANGED' && message.state !== undefined) {
        setKeepkeyState(message.state);
      }
      if (message.type === 'ASSET_CONTEXT_UPDATED' && message.assetContext) {
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
        return <Loading setIsConnecting={setIsConnecting} keepkeyState={keepkeyState} />;
      case 2:
        return <Loading setIsConnecting={setIsConnecting} keepkeyState={keepkeyState} />;
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
        return <Text>Device not connected.</Text>;
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
      {keepkeyState === null && <Text>Device not connected or detected. Please connect your KeepKey device.</Text>}
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
            <VStack spacing={4}>
              <Link href="https://www.keepkey.com" isExternal w="100%">
                <Button variant="ghost" w="100%">
                  About KeepKey
                </Button>
              </Link>
              <Image src={'https://i.ibb.co/jR8WcJM/kk.gif'} alt="KeepKey" />
            </VStack>
            <VStack spacing={4} align="stretch">
              <Text fontSize="md" fontWeight="bold">
                Enable Masking
              </Text>
              <HStack w="100%" justifyContent="space-between">
                <HStack>
                  <Avatar
                    size="md"
                    name="Firefox"
                    src="https://forum.zeroqode.com/uploads/default/original/2X/4/401498d7adfbb383fea695394f4f653ea4e7c9a7.png"
                  />
                  <Text>Enable Firefox</Text>
                </HStack>
                <Switch size="md" />
              </HStack>
              <HStack w="100%" justifyContent="space-between">
                <HStack>
                  <Avatar
                    size="md"
                    name="XDEFI"
                    src="https://images.crunchbase.com/image/upload/c_pad,f_auto,q_auto:eco,dpr_1/cs5s7reskl2onltpd7gw"
                  />
                  <Text>Enable XDEFI</Text>
                </HStack>
                <Switch size="md" />
              </HStack>
              <HStack w="100%" justifyContent="space-between">
                <HStack>
                  <Avatar
                    size="md"
                    name="Keplr"
                    src="https://cdn.dealspotr.com/io-images/logo/keplr.jpg?fit=contain&trim=true&flatten=true&extend=10&width=500&height=500"
                  />
                  <Text>Enable Keplr</Text>
                </HStack>
                <Switch size="md" />
              </HStack>
              <Text fontSize="sm" color="gray.500">
                This setting may conflict with these apps if also enabled.
              </Text>
            </VStack>
          </ModalBody>
        </ModalContent>
      </Modal>
    </Flex>
  );
};

export default withErrorBoundary(withSuspense(SidePanel, <div>Loading...</div>), <div>Error Occurred</div>);
