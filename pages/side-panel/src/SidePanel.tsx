import React, { useState, useEffect } from 'react';
import { Flex, Text, Box } from '@chakra-ui/react';
import { withErrorBoundary, withSuspense } from '@extension/shared';

import Connect from './components/Connect';
import Loading from './components/Loading';
import Balances from './components/Balances';
import Asset from './components/Asset';
import Transaction from './components/Transaction'; // Assuming you have this component

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
  const [assetContext, setAssetContext] = useState<any>(null); // Added asset context
  const [transactionContext, setTransactionContext] = useState<any>(null); // Added transaction context
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    const messageListener = (message: any) => {
      if (message.type === 'KEEPKEY_STATE_CHANGED' && message.state !== undefined) {
        setKeepkeyState(message.state);
      }
      if (message.type === 'ASSET_CONTEXT_UPDATED' && message.assetContext) {
        setAssetContext(message.assetContext); // Update asset context
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
      case 0: // unknown
      case 1: // disconnected
        return <Loading setIsConnecting={setIsConnecting} keepkeyState={keepkeyState} />;

      case 2: // connected
        if (transactionContext) {
          return <Transaction transactionContext={transactionContext} />;
        }
        if (assetContext) {
          return <Asset asset={assetContext} onClose={() => setAssetContext(null)} />;
        }
        return <Balances balances={balances} loading={loading} />;

      case 3: // busy
        return <Loading setIsConnecting={setIsConnecting} keepkeyState={keepkeyState} />;

      case 4: // errored
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
      {keepkeyState === null && <Text>Device not connected or detected. Please connect your KeepKey device.</Text>}
      {renderContent()}
    </Flex>
  );
};

export default withErrorBoundary(withSuspense(SidePanel, <div>Loading...</div>), <div>Error Occurred</div>);
