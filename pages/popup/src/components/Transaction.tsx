import React, { useEffect, useState } from 'react';
import EvmTransaction from './evm';
import UtxoTransaction from './utxo';
import OtherTransaction from './other';
import TendermintTransaction from './tendermint';
import { approvalStorage, requestStorage } from '@extension/storage/dist/lib';
import { Flex, Spinner, Alert, AlertIcon, Button, Icon } from '@chakra-ui/react';
import { WarningIcon } from '@chakra-ui/icons';
import AwaitingApproval from './AwaitingApproval';
import TxidPage from './TxidPage';

// Function to request asset context from background script
const requestAssetContext = () => {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'GET_ASSET_CONTEXT' }, response => {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError);
      }
      resolve(response);
    });
  });
};

const Transaction = ({ event, reloadEvents }: { event: any; reloadEvents: () => void }) => {
  const [transactionType, setTransactionType] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [awaitingDeviceApproval, setAwaitingDeviceApproval] = useState<boolean>(false);
  const [transactionInProgress, setTransactionInProgress] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showTxidPage, setShowTxidPage] = useState<boolean>(false);
  const [assetContext, setAssetContext] = useState<any>(null); // Local state for asset context
  const [explorerUrl, setExplorerUrl] = useState<string | null>(null);
  const [showRefreshWarning, setShowRefreshWarning] = useState<boolean>(false);

  // Fetch the assetContext on component mount
  useEffect(() => {
    requestAssetContext()
      .then((context: any) => {
        setAssetContext(context); // Set asset context state
        console.log('assetContext: ', context);
      })
      .catch(error => {
        console.error('Failed to fetch asset context:', error);
      });
  }, []);

  useEffect(() => {
    // Once assetContext and txHash are both available, construct explorer URL
    if (assetContext && txHash) {
      const explorerLink = assetContext?.assets?.explorerTxLink;
      if (explorerLink) {
        const finalUrl = explorerLink + txHash;
        setExplorerUrl(finalUrl);
        console.log('Generated explorerUrl:', finalUrl);
      } else {
        console.error('explorerTxLink is missing in asset context.');
      }
    }
  }, [assetContext, txHash]);

  const openSidebar = () => {
    chrome.runtime.sendMessage({ type: 'OPEN_SIDEBAR' }, response => {
      if (response?.success) {
        console.log('Sidebar opened successfully');
      } else {
        console.error('Failed to open sidebar:', response?.error);
      }
    });
  };

  const cancelRequest = () => {
    chrome.runtime.sendMessage({ type: 'RESET_APP' }, response => {
      if (response?.success) {
        console.log('Sidebar reset successfully');
      } else {
        console.error('Failed to reset the app:', response?.error);
      }
    });

    setShowRefreshWarning(true);
  };

  const handleResponse = async (decision: 'accept' | 'reject') => {
    try {
      //play sound /sounds/send.mp3
      const sendSound = new Audio('../../public/sounds/send.mp3');
      sendSound.play();

      chrome.runtime.sendMessage({ action: 'eth_sign_response', response: { decision, eventId: event.id } });

      if (decision === 'reject') {
        await requestStorage.removeEventById(event.id);
        reloadEvents();
      } else if (decision === 'accept') {
        openSidebar();
        setAwaitingDeviceApproval(true);
      }
    } catch (error) {
      console.error('Error handling response:', error);
    }
  };

  useEffect(() => {
    const handleMessage = (message: any) => {
      console.log('message received:', message);
      if (message.action === 'transaction_complete') {
        setShowTxidPage(true);
        setTxHash(message.txHash); // Set the txHash from the event
        setAwaitingDeviceApproval(false);
        setTransactionInProgress(false);
      } else if (message.action === 'transaction_error') {
        const errorDetails = message.error || message.e?.message || JSON.stringify(message.e);
        setErrorMessage('Transaction failed: ' + errorDetails);
        setTransactionInProgress(false);
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);

    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  useEffect(() => {
    console.log('event:', event);
    if (event?.networkId) {
      if (event.networkId.includes('eip155')) {
        setTransactionType('evm');
      } else {
        switch (event.chain) {
          case 'bitcoin':
          case 'bitcoincash':
          case 'dogecoin':
          case 'litecoin':
          case 'dash':
            setTransactionType('utxo');
            break;
          case 'cosmos':
          case 'thorchain':
          case 'osmosis':
          case 'mayachain':
            setTransactionType('tendermint');
            break;
          case 'ripple':
            setTransactionType('other');
            break;
          default:
            setTransactionType('unknown');
        }
      }
    }
  }, [event]);

  const handleCloseTab = async () => {
    if (txHash) {
      try {
        const updatedEvent = { ...event, status: 'approval', txHash };
        await requestStorage.removeEventById(event.id);
        await approvalStorage.addEvent(updatedEvent);
        reloadEvents();
        chrome.runtime.sendMessage({ action: 'open_sidebar' });
      } catch (error) {
        console.error('Error closing tab and storing event:', error);
      }
    }
  };

  const handleCancel = () => {
    cancelRequest();
    setAwaitingDeviceApproval(false);
    setTransactionInProgress(false);
    reloadEvents();
  };

  const renderTransaction = () => {
    console.log('transactionType:', transactionType);
    switch (transactionType) {
      case 'evm':
        return <EvmTransaction transaction={event} reloadEvents={reloadEvents} handleResponse={handleResponse} />;
      case 'tendermint':
        return <TendermintTransaction transaction={event} handleResponse={handleResponse} />;
      case 'utxo':
        return <UtxoTransaction transaction={event} handleResponse={handleResponse} />;
      case 'other':
        return <OtherTransaction transaction={event} handleResponse={handleResponse} />;
      default:
        return <div>Unknown Transaction Type {transactionType}</div>;
    }
  };

  if (errorMessage) {
    return (
      <Alert status="error">
        <AlertIcon />
        <Flex height="100vh" alignItems="center" justifyContent="center">
          <div>
            <h3>Error Occurred</h3>
            <p>{errorMessage}</p>
            <Icon as={WarningIcon} color="red.500" />
            <Button onClick={handleCancel}>Retry</Button>
          </div>
        </Flex>
      </Alert>
    );
  }

  if (showTxidPage && txHash && explorerUrl) {
    // Show the txid page if the transaction is complete and explorerUrl is available
    return <TxidPage txHash={txHash} explorerUrl={explorerUrl} onClose={handleCloseTab} />;
  }

  return (
    <div>
      {transactionInProgress && <Spinner />}

      {!awaitingDeviceApproval && renderTransaction()}

      {awaitingDeviceApproval && <AwaitingApproval onCancel={handleCancel} />}

      {showRefreshWarning && (
        <Alert status="warning" mt={4}>
          <AlertIcon />
          <p>You must refresh the dApp page to reconnect your wallet.</p>
        </Alert>
      )}
    </div>
  );
};

export default Transaction;
