import {
  Avatar,
  Button,
  Card,
  CardHeader,
  Flex,
  Spinner,
  Stack,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  VStack,
  Divider,
} from '@chakra-ui/react';
import React, { useEffect, useState } from 'react';
import RequestModal from './RequestModal';
import RequestFeeCard from './RequestFeeCard';
import RequestDataCard from './RequestDataCard';
import RequestDetailsCard from './RequestDetailsCard';
import RequestMethodCard from './RequestMethodCard';
import ProjectInfoCard from './ProjectInfoCard';
import { approvalStorage, requestStorage } from '@extension/storage/dist/lib';

let SAMPLE_DATA = [];

export function EvmTransaction({ transaction, reloadEvents }: any) {
  const [isPairing, setIsPairing] = useState(false);
  const [isApproved, setIsApproved] = useState(false);
  const [feeData, setFeeData] = useState({});
  const [isLoadingApprove, setIsLoadingApprove] = useState(false);
  const [isLoadingReject, setIsLoadingReject] = useState(false);
  const [requestSession, setRequestSession] = useState<any>({});
  const [chainId, setChainId] = useState<string | null>(null);
  const [request, setRequest] = useState<any>({});

  const handleResponse = async (decision: 'accept' | 'reject') => {
    try {
      if (decision === 'reject') {
        // Delete event
        await requestStorage.removeEventById(transaction.id);
      } else {
        // Move event to approval storage
        const updatedEvent = { ...transaction, status: 'approval' };
        await requestStorage.removeEventById(transaction.id);
        await approvalStorage.addEvent(updatedEvent);
        console.log('Moved event to approval storage:', updatedEvent);
      }
      chrome.runtime.sendMessage({ action: 'eth_sign_response', response: { decision, eventId: transaction.id } });
      reloadEvents();
    } catch (error) {
      console.error('Error handling response:', error);
    }
  };

  const updateFeeData = (feeData: any, isEIP1559: boolean) => {
    console.log('updateFeeData: ', feeData);
    setFeeData(feeData);
    console.log('transaction: ', transaction);
    if (!isEIP1559) {
      transaction.gasPrice = feeData.gasPrice;
      transaction.maxFeePerGas = null;
      transaction.maxPriorityFeePerGas = null;
    } else {
      transaction.gasPrice = null;
      transaction.maxFeePerGas = feeData.maxFeePerGas;
      transaction.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
    }
  };

  return (
    <Stack>
      <ProjectInfoCard transaction={transaction} />

      <Divider />
      <RequestMethodCard transaction={transaction} />
      <Divider />
      {/* Conditionally render the fee section */}
      {transaction.type !== 'personal_sign' && (
        <>
          <RequestFeeCard data={transaction} updateFeeData={updateFeeData} chainId={chainId} />
          <Divider />
          <RequestDetailsCard chains={[chainId ?? '']} protocol={''} />
        </>
      )}

      <RequestDataCard transaction={transaction} />
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
