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
import RequestMethodCard from './RequestMethodCard';
import ProjectInfoCard from './ProjectInfoCard';

export function EvmTransaction({ transaction, reloadEvents, handleResponse }: any) {
  return (
    <Stack>
      <ProjectInfoCard transaction={transaction} />

      <Divider />
      <RequestMethodCard transaction={transaction} />
      <Divider />
      <Tabs>
        <TabList>
          <Tab>Review</Tab>
          <Tab>Fees</Tab>
          <Tab>Raw</Tab>
        </TabList>

        <TabPanels>
          {/* Review Tab */}
          <TabPanel>
            <RequestDetailsCard transaction={transaction} />
          </TabPanel>

          {/* Fees Tab */}
          <TabPanel>
            {transaction.type !== 'personal_sign' && (
              <>
                <RequestFeeCard data={transaction} />
              </>
            )}
          </TabPanel>

          {/* Raw Data Tab */}
          <TabPanel>
            <RequestDataCard transaction={transaction} />
          </TabPanel>
        </TabPanels>
      </Tabs>

      <Divider />

      <Flex>
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
