import React, { useEffect, useState } from 'react';
import EvmTransaction from './evm';
import UtxoTransaction from './utxo';
import OtherTransaction from './other';
import TendermintTransaction from './tendermint';
import ChainNotEnabledCard from './ChainNotEnabledCard';
import { approvalStorage, requestStorage } from '@extension/storage';
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

const Transaction = ({
  event,
  reloadEvents,
  onDismiss,
}: {
  event: any;
  reloadEvents: () => void;
  onDismiss: () => void;
}) => {
  const [transactionType, setTransactionType] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [awaitingDeviceApproval, setAwaitingDeviceApproval] = useState<boolean>(false);
  const [transactionInProgress, setTransactionInProgress] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Categorical hint forwarded from the background so we can render
  // category-specific UI (e.g. timeout) without regex-matching `message`.
  const [errorKind, setErrorKind] = useState<string | null>(null);
  const [showTxidPage, setShowTxidPage] = useState<boolean>(false);
  const [assetContext, setAssetContext] = useState<any>(null); // Local state for asset context
  const [explorerUrl, setExplorerUrl] = useState<string | null>(null);
  const [showRefreshWarning, setShowRefreshWarning] = useState<boolean>(false);

  // Some approved requests don't touch the device at all (config-only
  // flows like wallet_addEthereumChain — the background stores the RPC,
  // switches the web3 provider, then emits signature_complete straight
  // away). Showing the "Please approve on your KeepKey" overlay for
  // these flashes a wrong instruction at the user before the dismiss
  // fires. Track them as a distinct state with a less alarming copy.
  const NO_DEVICE_STEP_TYPES = new Set(['wallet_addEthereumChain']);
  const hasDeviceStep = !NO_DEVICE_STEP_TYPES.has(event?.type);

  // Fetch the assetContext on component mount
  useEffect(() => {
    requestAssetContext()
      .then((context: any) => {
        setAssetContext(context); // Set asset context state
        console.log('assetContext: ', context);
      })
      .catch((error: any) => {
        console.error('Failed to fetch asset context:', error);
      });
  }, []);

  useEffect(() => {
    // Explorer URL is now provided directly in the transaction_complete message
    // No need to construct it here
  }, []);

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
        if (hasDeviceStep) {
          setAwaitingDeviceApproval(true);
        } else {
          // Config-only flow (e.g. wallet_addEthereumChain). No device
          // prompt; show the generic in-progress spinner instead so the
          // user sees acknowledgement while the background finishes
          // writing the chain and emits signature_complete, which will
          // dismiss the overlay via onDismiss.
          setTransactionInProgress(true);
        }
      }
    } catch (error) {
      console.error('Error handling response:', error);
    }
  };

  useEffect(() => {
    const handleMessage = (message: any) => {
      console.log('message received:', message);
      // Only handle messages addressed to THIS event. Messages without an
      // eventId are legacy/unscoped; accept them for backward compatibility
      // so nothing hangs if an older handler is still in flight.
      if (message?.eventId && message.eventId !== event.id) return;
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

        // For signatures (not transactions), clean up and dismiss the overlay
        console.log('Signature complete, dismissing approval overlay');
        setAwaitingDeviceApproval(false);
        setTransactionInProgress(false);

        // Remove the event from storage and dismiss overlay
        requestStorage
          .removeEventById(event.id)
          .then(() => {
            setTimeout(() => {
              onDismiss();
            }, 500);
          })
          .catch((error: any) => {
            console.error('Error removing event:', error);
            setTimeout(() => {
              onDismiss();
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
          console.log('User denied transaction, dismissing approval overlay');
          requestStorage
            .removeEventById(event.id)
            .then(() => {
              setTimeout(() => {
                onDismiss();
              }, 1000);
            })
            .catch(() => {
              setTimeout(() => {
                onDismiss();
              }, 1000);
            });
        } else {
          // Show error for other types of failures
          setErrorMessage(errorText);
          setErrorKind(typeof message.kind === 'string' ? message.kind : null);
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
          case 'solana':
            setTransactionType('other');
            break;
          case 'ton':
            setTransactionType('other');
            break;
          case 'tron':
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
        onDismiss();
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

  // Info-only "chain not enabled" surface — no approval flow, just lets
  // the user see why nothing happened after a dApp wallet_switchEthereumChain
  // and points them at Chainlist. The 4902 has already gone back to the
  // dApp by the time this renders.
  if (event?.type === 'chain_not_enabled') {
    return <ChainNotEnabledCard event={event} onDismiss={onDismiss} />;
  }

  if (errorMessage) {
    // Treat timeouts as a soft retryable state, not a fatal error. The
    // device is fine, the dApp request is just one-shot — the user has
    // to reject and re-initiate from the dApp page. Loud red copy made
    // this feel like something broke.
    //
    // Categorization comes from the typed `kind` forwarded by the
    // background. A regex on `errorMessage` is the legacy fallback and
    // exists only so older builds in the wild (or paths that haven't
    // adopted createTimeoutError yet) still show the friendlier card.
    const isTimeout = errorKind === 'timeout' || /timed out|timeout/i.test(errorMessage);
    const status = isTimeout ? 'warning' : 'error';
    const heading = isTimeout ? 'Took too long' : 'Error Occurred';
    const body = isTimeout
      ? 'No response from your KeepKey in time. Reject the request in the dApp, then try again.'
      : errorMessage;
    const buttonScheme = isTimeout ? 'yellow' : 'red';
    const buttonLabel = 'Close';
    return (
      <Flex direction="column" height="100vh" alignItems="center" justifyContent="center" p={6}>
        <Alert
          status={status}
          variant="subtle"
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
          textAlign="center"
          minHeight="200px"
          borderRadius="lg">
          <AlertIcon boxSize="40px" mr={0} />
          <Flex direction="column" mt={4} alignItems="center">
            <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '12px' }}>{heading}</h3>
            <p style={{ marginBottom: '20px' }}>{body}</p>
            <Flex gap={2}>
              <Button colorScheme={buttonScheme} onClick={handleCancel}>
                {buttonLabel}
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

  // No-device config flow that's been accepted: hide the review form
  // and the "approve on device" overlay entirely. Render a minimal
  // "Saving…" state while the background finishes writing the config
  // and fires signature_complete (which dismisses via onDismiss).
  if (transactionInProgress && !hasDeviceStep) {
    return (
      <Flex direction="column" justify="center" align="center" height="60vh" gap={4}>
        <Spinner size="xl" thickness="4px" color="teal.300" />
        <p style={{ color: 'rgba(255,255,255,0.7)', textAlign: 'center' }}>
          {event?.type === 'wallet_addEthereumChain' ? 'Saving network configuration…' : 'Processing…'}
        </p>
      </Flex>
    );
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
