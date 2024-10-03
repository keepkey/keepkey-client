import {
  Avatar,
  Button,
  Card,
  Box,
  CardHeader,
  Flex,
  Spinner,
  Stack,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Divider,
} from '@chakra-ui/react';
import React, { useEffect, useState } from 'react';
import { requestStorage } from '@extension/storage';

import RequestDetailsCard from './RequestDetailsCard';
import RequestDataCard from './RequestDataCard';
import CoinControl from './CoinControlCard';
import RequestMethodCard from './RequestMethodCard';
import ProjectFeeCard from './ProjectFeeCard';
import ProjectInfoCard from './ProjectInfoCard';

const openSidebar = () => {
  chrome.runtime.sendMessage({ type: 'OPEN_SIDEBAR' }, response => {
    if (response?.success) {
      console.log('Sidebar opened successfully');
    } else {
      console.error('Failed to open sidebar:', response?.error);
    }
  });
};

const triggerTransactionContextUpdate = (transactionId: string) => {
  chrome.runtime.sendMessage({ type: 'TRANSACTION_CONTEXT_UPDATED', id: transactionId }, response => {
    if (response?.success) {
      console.log(`Transaction context updated for ID: ${transactionId}`);
    } else {
      console.error('Failed to update transaction context:', response?.error);
    }
  });
};

export function UtxoTransaction({ transaction: initialTransaction, handleResponse }: any) {
  const [transaction, setTransaction] = useState(initialTransaction);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showMessage1, setShowMessage1] = useState(false);
  const [showMessage2, setShowMessage2] = useState(false);

  useEffect(() => {
    setTimeout(() => setShowMessage1(true), 3000);
    setTimeout(() => setShowMessage2(true), 6000);
  }, []);

  const fetchTransactionData = async (id: string) => {
    try {
      console.log(`Fetching transaction with id: ${id}`);
      const data = await requestStorage.getEventById(id);
      console.log('Fetched transaction data:', data);

      if (data.utxos) {
        setTransaction(data);
        setIsLoading(false);
      } else {
        console.log('No unsigned transaction found in data.');
      }
    } catch (error: any) {
      console.error('Error fetching transaction from storage:', error);
      setErrorMessage('Error loading transaction: ' + error.message);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTransactionData(transaction.id);
  }, [transaction.id]);

  useEffect(() => {
    const handleMessage = (message: any) => {
      console.log('Message received:', message);
      if (message.action === 'utxo_build_tx') {
        console.log('Received utxo_build_tx event:', message);

        setTimeout(async () => {
          await fetchTransactionData(transaction.id);
        }, 1000);
      } else if (message.action === 'transaction_error') {
        const errorDetails = message.e?.message || JSON.stringify(message.e);
        setErrorMessage('Transaction failed: ' + errorDetails);
        setIsLoading(false);
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);

    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, [transaction.id]);

  const handleReload = () => {
    console.log('Reloading transaction with id:', transaction.id);
    setIsLoading(true);
    fetchTransactionData(transaction.id);
    openSidebar();
    triggerTransactionContextUpdate(transaction.id); // Force the sidebar into the transaction history tab
  };

  if (isLoading) {
    return (
      <Flex direction="column" alignItems="center" justifyContent="center" height="100vh" pt="400px">
        <Card padding="4" boxShadow="lg" borderRadius="md">
          <Flex direction="column" alignItems="center">
            <Spinner size="xl" />
            <p>Transaction ID: {transaction.id}</p>
            {showMessage1 && <p>Building transaction...</p>}
            {showMessage2 && <p>Applying UTXO selection method blackjack...</p>}
            <Button mt={4} onClick={handleReload}>
              View in Sidebar
            </Button>
            {errorMessage && <p style={{ color: 'red' }}>{errorMessage}</p>}
          </Flex>
        </Card>
        <Box height="400px" />
      </Flex>
    );
  }

  return (
    <Flex direction="column" alignItems="center">
      <Card padding="4" boxShadow="lg" borderRadius="md" width="100%" maxWidth="600px">
        <Stack>
          <ProjectInfoCard transaction={transaction} />
          <Divider />
          <RequestMethodCard transaction={transaction} />
          <Divider />
          <Tabs>
            <TabList defaultIndex={1}>
              <Tab>Basic</Tab>
              <Tab>Fees</Tab>
              <Tab>Raw</Tab>
            </TabList>

            <TabPanels>
              <TabPanel>
                <RequestDetailsCard transaction={transaction} />
              </TabPanel>
              <TabPanel>
                <ProjectFeeCard transaction={transaction} />
              </TabPanel>
              <TabPanel>
                <RequestDataCard transaction={transaction} />
              </TabPanel>
            </TabPanels>
          </Tabs>
          <Divider />
          <Flex justifyContent="center" alignItems="center">
            <Button colorScheme="green" onClick={() => handleResponse('accept')} mr={2}>
              Approve
            </Button>
            <Button colorScheme="red" onClick={() => handleResponse('reject')}>
              Reject
            </Button>
          </Flex>
        </Stack>
      </Card>
    </Flex>
  );
}

export default UtxoTransaction;
