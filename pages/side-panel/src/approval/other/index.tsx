import {
  Button,
  Card,
  Box,
  Flex,
  Stack,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Divider,
  Text,
} from '@chakra-ui/react';
import React, { useEffect, useMemo, useState } from 'react';
import { requestStorage } from '@extension/storage';
import { buildHiveApprovalView } from '@extension/shared';
import { HiveChecks, HiveDetails, HiveRequestSummary, hiveBlockReasonFor } from '../hive/HiveApproval';
import RequestMethodCard from './RequestMethodCard';
import ProjectInfoCard from './ProjectInfoCard';
import RequestDetailsCard from './RequestDetailsCard';
import RequestDataCard from './RequestDataCard';
import ClearSignReportCard from '../ClearSignReportCard';

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
      // Only update if we got valid data — don't overwrite with null
      if (data) {
        setTransaction(data);
      }
    } catch (error: any) {
      console.error('Error fetching transaction from storage:', error);
      setErrorMessage('Error loading transaction: ' + error.message);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (transaction?.id) {
      fetchTransactionData(transaction.id);
    }
  }, [transaction?.id]);

  // Hive gets a per-method view (never "Unknown Method") and device checks
  // that can block Approve before the KeepKey would refuse the request.
  const isHive = transaction?.chain === 'hive' || String(transaction?.networkId ?? '').startsWith('hive:');
  const hiveView = useMemo(() => (isHive ? buildHiveApprovalView(transaction) : null), [isHive, transaction]);
  const vaultBlocked = transaction?.clearSignReport?.protectionLevel === 'P0';
  const blockReason = vaultBlocked ? 'Vault blocked this transaction' : hiveBlockReasonFor(hiveView, 'keepkey');
  const approve = () => handleResponse('accept');

  const handleReload = () => {
    console.log('Reloading transaction with id:', transaction.id);
    fetchTransactionData(transaction.id);
    triggerTransactionContextUpdate(transaction.id);
  };

  return (
    <Flex direction="column" alignItems="center">
      <Card padding="4" boxShadow="lg" borderRadius="md" width="100%" maxWidth="600px">
        <Stack>
          <ProjectInfoCard transaction={transaction} />
          <Divider />
          <ClearSignReportCard report={transaction?.clearSignReport} error={transaction?.clearSignReportError} />
          {hiveView ? (
            <>
              <HiveRequestSummary view={hiveView} />
              <HiveChecks view={hiveView} />
            </>
          ) : (
            <RequestMethodCard transaction={transaction} />
          )}
          <Divider />

          {/* Basic first: Raw opens to a collapsed data section, so defaulting
              to it let a user approve without ever seeing the rendered details. */}
          <Tabs defaultIndex={0}>
            <TabList>
              <Tab>Basic</Tab>
              {/*<Tab>Fees</Tab>*/}
              <Tab>Raw</Tab>
            </TabList>

            <TabPanels>
              <TabPanel>
                {hiveView ? (
                  <HiveDetails view={hiveView} />
                ) : (
                  <RequestDetailsCard transaction={transaction}></RequestDetailsCard>
                )}
              </TabPanel>
              {/*<TabPanel></TabPanel>*/}
              <TabPanel>
                <RequestDataCard transaction={transaction}></RequestDataCard>
              </TabPanel>
            </TabPanels>
          </Tabs>
          <Divider />
          {blockReason && (
            <Text fontSize="12px" color="red.300" textAlign="center" data-approve-blocked>
              {blockReason}
            </Text>
          )}
          <Flex justifyContent="center" alignItems="center">
            <Button variant="solid" onClick={() => approve()} mr={2} isDisabled={!!blockReason} title={blockReason}>
              Approve
            </Button>
            <Button variant="keycapSecondary" onClick={() => handleResponse('reject')}>
              Reject
            </Button>
          </Flex>
        </Stack>
      </Card>
    </Flex>
  );
}

export default OtherTransaction;
