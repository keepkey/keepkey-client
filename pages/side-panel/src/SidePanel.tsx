import React, { useState, useEffect } from 'react';
import { Flex, Text, Box } from '@chakra-ui/react';
import { withErrorBoundary, withSuspense } from '@extension/shared';
import axios from 'axios';

import Connect from './components/Connect';
import Loading from './components/Loading';
import Balances from './components/Balances';

const stateNames: { [key: number]: string } = {
  0: 'unknown',
  1: 'disconnected',
  2: 'connected',
  3: 'busy',
  4: 'errored',
};

const SidePanel = () => {
  const [balances, setBalances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [keepkeyState, setKeepkeyState] = useState<number | null>(null);
  const [signRequest, setSignRequest] = useState<any>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [currentProvider, setCurrentProvider] = useState<any>(null);

  useEffect(() => {
    const messageListener = (message: any) => {
      if (message.type === 'KEEPKEY_STATE_CHANGED' && message.state !== undefined) {
        setKeepkeyState(message.state);
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);
    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, []);

  const renderContent = () => {
    if (isConnecting) return <Loading setIsConnecting={setIsConnecting} keepkeyState={keepkeyState} />;

    switch (keepkeyState) {
      case 0:
      case 1:
        return <Loading setIsConnecting={setIsConnecting} keepkeyState={keepkeyState} />;
      case 2:
        return <Balances balances={balances} loading={loading} />;
      case 3:
        return <Loading setIsConnecting={setIsConnecting} keepkeyState={keepkeyState} />;
      case 4:
        return <Connect setIsConnecting={setIsConnecting} />;
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
      </Box>
      {renderContent()}
    </Flex>
  );
};

export default withErrorBoundary(withSuspense(SidePanel, <div>Loading...</div>), <div>Error Occurred</div>);
