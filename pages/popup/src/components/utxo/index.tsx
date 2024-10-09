import {
  Button,
  Card,
  Flex,
  Spinner,
  Stack,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Divider,
  Text,
  Icon,
} from '@chakra-ui/react';
import { WarningIcon } from '@chakra-ui/icons';
import React, { useEffect, useState } from 'react';
import { requestStorage } from '@extension/storage';

import RequestDetailsCard from './RequestDetailsCard';
import RequestDataCard from './RequestDataCard';
//@ts-ignore
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

  useEffect(() => {
    const handleMessage = (message: any) => {
      console.log('Message received:', message);
      if (message.action === 'utxo_build_tx') {
        setTimeout(async () => {
          await fetchTransactionData(transaction.id);
        }, 1000);
      } else if (message.action === 'utxo_build_tx_error') {
        setErrorMessage('Not enough funds');
        setIsLoading(false);
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);

    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, [transaction.id]);

  const fetchTransactionData = async (id: string) => {
    try {
      const data = await requestStorage.getEventById(id);

      if (data.utxos) {
        setTransaction(data);
        setIsLoading(false);
      }
    } catch (error: any) {
      setErrorMessage('Error loading transaction: ' + error.message);
      setIsLoading(false);
    }
  };

  const handleReload = () => {
    setIsLoading(true);
    fetchTransactionData(transaction.id);
    openSidebar();
    triggerTransactionContextUpdate(transaction.id);
  };

  if (errorMessage) {
    return (
      <Flex direction="column" alignItems="center" justifyContent="center" height="100vh">
        <Card padding="6" boxShadow="lg" borderRadius="md">
          <Flex direction="column" alignItems="center" justifyContent="center">
            <Icon as={WarningIcon} w={8} h={8} color="yellow.400" />
            <Text fontSize="xl" fontWeight="bold" mt={4}>
              {errorMessage}
            </Text>
            <Button mt={4} onClick={handleReload}>
              Exit
            </Button>
          </Flex>
        </Card>
      </Flex>
    );
  }

  if (isLoading) {
    return (
      <Flex direction="column" alignItems="center" justifyContent="center" height="100vh">
        <Card padding="4" boxShadow="lg" borderRadius="md">
          <Flex direction="column" alignItems="center">
            <Spinner size="xl" />
            <p>Transaction ID: {transaction.id}</p>
            <Button mt={4} onClick={handleReload}>
              View in Sidebar
            </Button>
          </Flex>
        </Card>
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
