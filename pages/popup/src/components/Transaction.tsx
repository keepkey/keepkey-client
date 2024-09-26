import React, { useEffect, useState } from 'react';
import EvmTransaction from './evm';
import UtxoTransaction from './utxo';
import { approvalStorage, requestStorage } from '@extension/storage/dist/lib';
import Confetti from 'react-confetti';
// eslint-disable-next-line import/named
import { Flex, Card, CardBody, Image, Spinner, Heading, Button, Icon, Alert, AlertIcon } from '@chakra-ui/react';
import { WarningIcon } from '@chakra-ui/icons'; // Import the WarningIcon from Chakra UI

const Transaction = ({ event, reloadEvents }: { event: any; reloadEvents: () => void }) => {
  const [transactionType, setTransactionType] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [showConfetti, setShowConfetti] = useState<boolean>(false);
  const [awaitingDeviceApproval, setAwaitingDeviceApproval] = useState<boolean>(false);
  const [transactionInProgress, setTransactionInProgress] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const openSidebar = () => {
    // Send a message to open the sidebar
    chrome.runtime.sendMessage({ type: 'OPEN_SIDEBAR' }, response => {
      if (response?.success) {
        console.log('Sidebar opened successfully');
      } else {
        console.error('Failed to open sidebar:', response?.error);
      }
    });
  };

  const cancelRequest = () => {
    // Send a message to open the sidebar
    chrome.runtime.sendMessage({ type: 'RESET_APP' }, response => {
      if (response?.success) {
        console.log('Sidebar opened successfully');
      } else {
        console.error('Failed to open sidebar:', response?.error);
      }
    });
  };

  const handleResponse = async (decision: 'accept' | 'reject') => {
    try {
      console.log('handleResponse:', decision);
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
      if (message.action === 'transaction_complete') {
        console.log('Transaction completed with txHash:', message.txHash);
        setTxHash(message.txHash);
        setAwaitingDeviceApproval(false);
        setShowConfetti(true);
        setTransactionInProgress(false);
      } else if (message.action === 'transaction_error') {
        const errorDetails = message.e?.message || JSON.stringify(message.e); // Extract meaningful error message
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
    if (event && event?.networkId) {
      if (event.networkId.includes('eip155')) {
        setTransactionType('evm');
      } else if (event.chain === 'bitcoin') {
        setTransactionType('utxo');
      } else {
        setTransactionType('unknown');
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
    switch (transactionType) {
      case 'evm':
        return <EvmTransaction transaction={event} reloadEvents={reloadEvents} handleResponse={handleResponse} />;
      case 'utxo':
        return <UtxoTransaction transaction={event} handleResponse={handleResponse} />;
      default:
        return <div>Unknown Transaction Type</div>;
    }
  };

  if (errorMessage) {
    return (
      <Alert status="error">
        <AlertIcon />
        <div>
          <h3>Error Occurred</h3>
          <p>{errorMessage}</p>
          <Icon as={WarningIcon} color="red.500" /> {/* Red warning icon */}
          <Button onClick={handleCancel}>Retry</Button>
        </div>
      </Alert>
    );
  }

  return (
    <div>
      {transactionInProgress && <Spinner />}

      {!awaitingDeviceApproval && renderTransaction()}

      {awaitingDeviceApproval && (
        <Flex justify="center" align="center" height="100vh">
          <Card width="400px" boxShadow="lg" borderRadius="lg" overflow="hidden">
            <CardBody>
              <Flex direction="column" align="center">
                <Heading as="h2" size="md" mb={4} textAlign="center">
                  Device Signing Request
                </Heading>
                <Image
                  src="https://pioneers.dev/coins/hold-and-release.svg"
                  alt="Approve on device"
                  boxSize="150px"
                  mb={4}
                />
                <Heading as="h3" size="md" mb={4} textAlign="center">
                  Please approve the transaction on your KeepKey
                </Heading>
                <br />
                or....
                <br />
                <br />
                <Button colorScheme="yellow" onClick={handleCancel}>
                  Abort Signing
                </Button>
              </Flex>
            </CardBody>
          </Card>
        </Flex>
      )}

      {txHash && (
        <div>
          <h3>Transaction completed successfully!</h3>
          <p>Transaction Hash: {txHash}</p>
          <button onClick={handleCloseTab}>Close</button>
        </div>
      )}

      {showConfetti && <Confetti />}
    </div>
  );
};

export default Transaction;
