import React from 'react';
import { Box, Button, Card, Flex, Heading, Text } from '@chakra-ui/react';
import { requestStorage, approvalStorage } from '@chrome-extension-boilerplate/storage';

const Transaction = ({ event, reloadEvents }: { event: any; reloadEvents: () => void }) => {
  const { gas, value, from, to, data } = event;

  const handleResponse = async (decision: 'accept' | 'reject') => {
    try {
      if (decision === 'reject') {
        // Delete event
        await requestStorage.removeEventById(event.id);
      } else {
        // Move event to approval storage
        const updatedEvent = { ...event, status: 'approval' };
        await requestStorage.removeEventById(event.id);
        await approvalStorage.addEvent(updatedEvent);
        console.log('Moved event to approval storage:', updatedEvent);
      }
      chrome.runtime.sendMessage({ action: 'eth_sign_response', response: { decision, eventId: event.id } });
      reloadEvents();
    } catch (error) {
      console.error('Error handling response:', error);
    }
  };

  return (
    <Card borderRadius="md" p={4} mb={4}>
      <Box mb={4}>
        <Heading as="h4" size="sm">
          Data
        </Heading>
        <pre>{JSON.stringify(event, null, 2)}</pre>
      </Box>
      <Box mb={4}>
        <Text>Blockchain(s): Ethereum</Text>
      </Box>
      <Box mb={4}>
        <Text>Relay Protocol: irn</Text>
      </Box>
      <Box mb={4}>
        <Text>Methods: eth_sendTransaction</Text>
      </Box>
      <Flex>
        <Button colorScheme="green" onClick={() => handleResponse('accept')} mr={2}>
          Approve
        </Button>
        <Button colorScheme="red" onClick={() => handleResponse('reject')}>
          Reject
        </Button>
      </Flex>
    </Card>
  );
};

export default Transaction;
