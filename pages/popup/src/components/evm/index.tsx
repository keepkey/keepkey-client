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

let SAMPLE_DATA = [];

export function EvmTransaction({ transaction, reloadEvents, handleResponse }: any) {
  const [isPairing, setIsPairing] = useState(false);
  const [isApproved, setIsApproved] = useState(false);
  const [feeData, setFeeData] = useState({});
  const [isLoadingApprove, setIsLoadingApprove] = useState(false);
  const [isLoadingReject, setIsLoadingReject] = useState(false);
  const [requestSession, setRequestSession] = useState<any>({});
  const [chainId, setChainId] = useState<string | null>(null);
  const [request, setRequest] = useState<any>({});

  return (
    <Stack>
      <ProjectInfoCard transaction={transaction} />

      <Divider />
      <RequestMethodCard transaction={transaction} />
      <Divider />
      {/* Conditionally render the fee section */}
      {transaction.type !== 'personal_sign' && (
        <>
          <RequestFeeCard data={transaction} chainId={chainId} />
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
