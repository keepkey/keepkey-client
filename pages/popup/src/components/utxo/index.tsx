import {
  Avatar,
  Button,
  Card,
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
import ProjectInfoCard from './ProjectInfoCard';

export function UtxoTransaction({ transaction: initialTransaction, handleResponse }: any) {
  // Initialize transaction state from prop
  const [transaction, setTransaction] = useState(initialTransaction);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showMessage1, setShowMessage1] = useState(false);
  const [showMessage2, setShowMessage2] = useState(false);

  // Delay the appearance of messages
  useEffect(() => {
    setTimeout(() => setShowMessage1(true), 3000); // Show first message after 3 seconds
    setTimeout(() => setShowMessage2(true), 6000); // Show second message after 6 seconds
  }, []);

  // Fetch the unsigned transaction and stop loading when it's populated
  const fetchTransactionData = async (id: string) => {
    try {
      console.log(`Fetching transaction with id: ${id}`);
      const data = await requestStorage.getEventById(id);
      console.log('Fetched transaction data:', data); // Log the data for debugging

      if (data.unsignedTx) {
        setTransaction(data); // Update transaction state
        setIsLoading(false); // Stop spinner when data is populated
      } else {
        console.log('No unsigned transaction found in data.');
      }
    } catch (error) {
      console.error('Error fetching transaction from storage:', error);
      setErrorMessage('Error loading transaction: ' + error.message);
      setIsLoading(false); // Stop spinner if there is an error
    }
  };

  useEffect(() => {
    // Fetch transaction data when the component mounts
    fetchTransactionData(transaction.id);
  }, [transaction.id]);

  // Listen for events that update the transaction state
  useEffect(() => {
    const handleMessage = async (message: any) => {
      console.log('Message received:', message);
      if (message.action === 'utxo_build_tx') {
        console.log('Received utxo_build_tx event:', message);
        await fetchTransactionData(message.unsignedTx.id); // Fetch updated transaction
      } else if (message.action === 'transaction_error') {
        const errorDetails = message.e?.message || JSON.stringify(message.e);
        setErrorMessage('Transaction failed: ' + errorDetails);
        setIsLoading(false); // Stop spinner in case of error
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);

    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  // Reload function to refetch the transaction without refreshing the page
  const handleReload = () => {
    console.log('Reloading transaction with id:', transaction.id);
    setIsLoading(true); // Show the loading spinner again
    fetchTransactionData(transaction.id);
  };

  if (isLoading) {
    return (
      <Flex direction="column" alignItems="center" justifyContent="center" height="100vh">
        <Card padding="4" boxShadow="lg" borderRadius="md">
          <Flex direction="column" alignItems="center" justifyContent="center">
            <Spinner size="xl" />
            <p>Transaction ID: {transaction.id}</p> {/* Show transaction ID while loading */}
            {showMessage1 && <p>Building transaction...</p>}
            {showMessage2 && <p>Applying UTXO selection method blackjack...</p>}
            <Button mt={4} onClick={handleReload}>
              Reload
            </Button>
            {errorMessage && <p style={{ color: 'red' }}>{errorMessage}</p>}
          </Flex>
        </Card>
      </Flex>
    );
  }

  return (
    <Flex direction="column" alignItems="center" justifyContent="center" height="100vh">
      <Card padding="4" boxShadow="lg" borderRadius="md" width="100%" maxWidth="600px">
        <Stack>
          <ProjectInfoCard transaction={transaction} />

          <Divider />
          <RequestMethodCard transaction={transaction} />
          <Divider />
          <Tabs>
            <TabList defaultIndex={1}>
              <Tab>Info</Tab>
              <Tab>Coin Control</Tab>
              <Tab>Raw</Tab>
            </TabList>

            <TabPanels>
              <TabPanel>
                <RequestDetailsCard transaction={transaction} />
              </TabPanel>

              <TabPanel>
                <CoinControl transaction={transaction} />
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
