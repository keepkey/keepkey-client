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
import sendSoundFile from '../assets/sounds/send.mp3';

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
    // Explorer URL is now provided directly in the transaction_complete message
    // No need to construct it here
  }, []);

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
        // Play success sound after device signs transaction
        try {
          const sendSound = new Audio(sendSoundFile);
          sendSound.play();
        } catch (e) {
          console.error('Error playing sound:', e);
        }

        setShowTxidPage(true);
        setTxHash(message.txHash); // Set the txHash from the event

        // Set explorer URL if provided in the message
        if (message.explorerTxLink && message.txHash) {
          const finalUrl = message.explorerTxLink + message.txHash;
          setExplorerUrl(finalUrl);
          console.log('Explorer URL from message:', finalUrl);
        }

        setAwaitingDeviceApproval(false);
        setTransactionInProgress(false);
      } else if (message.action === 'signature_complete') {
        // Play success sound after device signs message
        try {
          const sendSound = new Audio(sendSoundFile);
          sendSound.play();
        } catch (e) {
          console.error('Error playing sound:', e);
        }

        // For signatures (not transactions), clean up and close popup
        console.log('Signature complete, closing popup');
        setAwaitingDeviceApproval(false);
        setTransactionInProgress(false);

        // Remove the event from storage and close popup
        requestStorage
          .removeEventById(event.id)
          .then(() => {
            // Close the popup window after a brief delay to show success
            setTimeout(() => {
              window.close();
            }, 500);
          })
          .catch(error => {
            console.error('Error removing event:', error);
            // Close anyway even if there's an error
            setTimeout(() => {
              window.close();
            }, 500);
          });
      } else if (message.action === 'transaction_error') {
        const errorDetails = message.error || message.e?.message || JSON.stringify(message.e);
        const errorText = 'Transaction failed: ' + errorDetails;

        // If user denied the transaction, just close the popup
        if (
          errorDetails.includes('User denied') ||
          errorDetails.includes('user rejected') ||
          errorDetails.includes('User rejected')
        ) {
          console.log('User denied transaction, closing popup');
          // Remove event and close popup after brief delay
          requestStorage
            .removeEventById(event.id)
            .then(() => {
              setTimeout(() => {
                window.close();
              }, 1000);
            })
            .catch(() => {
              // Close anyway even if removal fails
              setTimeout(() => {
                window.close();
              }, 1000);
            });
        } else {
          // Show error for other types of failures
          setErrorMessage(errorText);
          setTransactionInProgress(false);
        }
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);

    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, [event.id]);

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
      <Flex direction="column" height="100vh" alignItems="center" justifyContent="center" p={6}>
        <Alert
          status="error"
          variant="subtle"
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
          textAlign="center"
          minHeight="200px"
          borderRadius="lg">
          <AlertIcon boxSize="40px" mr={0} />
          <Flex direction="column" mt={4} alignItems="center">
            <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '12px' }}>Error Occurred</h3>
            <p style={{ marginBottom: '20px' }}>{errorMessage}</p>
            <Flex gap={2}>
              <Button colorScheme="red" onClick={handleCancel}>
                Close
              </Button>
            </Flex>
          </Flex>
        </Alert>
      </Flex>
    );
  }

  if (showTxidPage && txHash) {
    // Show the txid page if the transaction is complete
    // explorerUrl is optional - TxidPage can handle it being undefined
    return <TxidPage txHash={txHash} explorerUrl={explorerUrl || ''} onClose={handleCloseTab} />;
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
