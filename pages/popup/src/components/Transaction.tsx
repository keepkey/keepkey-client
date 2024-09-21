import React, { useEffect, useState } from 'react';
import EvmTransaction from './evm';
// import { Box, Button, Card, Flex, Heading, Text } from '@chakra-ui/react';
// import { approvalStorage, requestStorage } from '@extension/storage/dist/lib';

const Transaction = ({ event, reloadEvents }: { event: any; reloadEvents: () => void }) => {
  const [transactionType, setTransactionType] = useState<string | null>(null);

  // const handleResponse = async (decision: 'accept' | 'reject') => {
  //   try {
  //     if (decision === 'reject') {
  //       // Delete event
  //       await requestStorage.removeEventById(event.id);
  //     } else {
  //       // Move event to approval storage
  //       const updatedEvent = { ...event, status: 'approval' };
  //       await requestStorage.removeEventById(event.id);
  //       await approvalStorage.addEvent(updatedEvent);
  //       console.log('Moved event to approval storage:', updatedEvent);
  //     }
  //     chrome.runtime.sendMessage({ action: 'eth_sign_response', response: { decision, eventId: event.id } });
  //     reloadEvents();
  //   } catch (error) {
  //     console.error('Error handling response:', error);
  //   }
  // };

  useEffect(() => {
    console.log('event', event);

    if (event && event?.networkId) {
      if (event.networkId.includes('eip155')) {
        setTransactionType('evm');
      } else if (event.networkId.includes('utxo')) {
        setTransactionType('utxo');
      } else {
        setTransactionType('unknown');
      }
    }
  }, [event]);

  const renderTransaction = () => {
    switch (transactionType) {
      case 'evm':
        return <EvmTransaction transaction={event} reloadEvents={reloadEvents} />;
      case 'utxo':
        return <div>TODO UTXO</div>;
      default:
        return <div>Unknown Transaction Type</div>;
    }
  };

  return (
    <div>
      {renderTransaction()}

      {/*<Box mb={4}>*/}
      {/*  <Heading as="h4" size="sm">*/}
      {/*    Data*/}
      {/*  </Heading>*/}
      {/*  <pre>{JSON.stringify(event, null, 2)}</pre>*/}
      {/*</Box>*/}
      {/*<Box mb={4}>*/}
      {/*  <Text>Blockchain(s): Ethereum</Text>*/}
      {/*</Box>*/}
      {/*<Box mb={4}>*/}
      {/*  <Text>Relay Protocol: irn</Text>*/}
      {/*</Box>*/}
      {/*<Box mb={4}>*/}
      {/*  <Text>Methods: eth_sendTransaction</Text>*/}
      {/*</Box>*/}
      {/*<Flex>*/}
      {/*  <Button colorScheme="green" onClick={() => handleResponse('accept')} mr={2}>*/}
      {/*    Approve*/}
      {/*  </Button>*/}
      {/*  <Button colorScheme="red" onClick={() => handleResponse('reject')}>*/}
      {/*    Reject*/}
      {/*  </Button>*/}
      {/*</Flex>*/}
    </div>
  );
};

export default Transaction;
