import { Button, Card, Box, Flex, Stack, Tabs, TabList, TabPanels, Tab, TabPanel, Divider } from '@chakra-ui/react';
import React, { useEffect, useState } from 'react';
import { requestStorage } from '@extension/storage';
import RequestMethodCard from './RequestMethodCard';
import ProjectInfoCard from './ProjectInfoCard';
import RequestDetailsCard from './RequestDetailsCard';
import RequestDataCard from './RequestDataCard';

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

export function OtherTransaction({ transaction: initialTransaction, handleResponse }: any) {
  const [transaction, setTransaction] = useState(initialTransaction);
  const [isLoading, setIsLoading] = useState(false);
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
      setTransaction(data);
    } catch (error: any) {
      console.error('Error fetching transaction from storage:', error);
      setErrorMessage('Error loading transaction: ' + error.message);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTransactionData(transaction.id);
  }, [transaction.id]);

  const handleReload = () => {
    console.log('Reloading transaction with id:', transaction.id);
    fetchTransactionData(transaction.id);
    openSidebar();
    triggerTransactionContextUpdate(transaction.id);
  };

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
              {/*<Tab>Fees</Tab>*/}
              <Tab>Raw</Tab>
            </TabList>

            <TabPanels>
              <TabPanel>
                <RequestDetailsCard transaction={transaction}></RequestDetailsCard>
              </TabPanel>
              {/*<TabPanel></TabPanel>*/}
              <TabPanel>
                <RequestDataCard transaction={transaction}></RequestDataCard>
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

export default OtherTransaction;
