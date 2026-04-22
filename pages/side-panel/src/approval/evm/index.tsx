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
import RequestFeeCard from './RequestFeeCard';
import RequestDataCard from './RequestDataCard';
import RequestDetailsCard from './RequestDetailsCard';
import ContractDetailsCard from './ContractDetailsCard';
import RequestMethodCard from './RequestMethodCard';
import ProjectInfoCard from './ProjectInfoCard';

export function EvmTransaction({ transaction, reloadEvents, handleResponse }: any) {
  return (
    <Stack>
      <ProjectInfoCard transaction={transaction} />

      <Divider />
      <RequestMethodCard transaction={transaction} />
      <Divider />
      <Tabs defaultIndex={0}>
        <TabList>
          {/*<Tab>Insight</Tab>*/}
          <Tab>Details</Tab>
          <Tab>Fees</Tab>
          <Tab>Raw</Tab>
        </TabList>

        <TabPanels>
          {/* Contract Tab */}
          {/*<TabPanel>*/}
          {/*  <ContractDetailsCard transaction={transaction} />*/}
          {/*</TabPanel>*/}

          {/* Review Tab */}
          <TabPanel>
            <RequestDetailsCard transaction={transaction} />
          </TabPanel>

          {/* Fees Tab — skip for methods that don't produce an on-chain tx */}
          <TabPanel>
            {transaction.type !== 'personal_sign' &&
              transaction.type !== 'eth_sign' &&
              transaction.type !== 'wallet_addEthereumChain' && (
                <>
                  <RequestFeeCard transaction={transaction} />
                </>
              )}
            {transaction.type === 'wallet_addEthereumChain' && (
              <Flex justify="center" p={6}>
                <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, textAlign: 'center' }}>
                  No transaction fees — this flow only stores the RPC configuration locally.
                </div>
              </Flex>
            )}
          </TabPanel>

          {/* Raw Data Tab */}
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
  );
}

export default EvmTransaction;
