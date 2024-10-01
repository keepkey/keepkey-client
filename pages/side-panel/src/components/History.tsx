import React, { useEffect, useState } from 'react';
import {
  Box,
  Text,
  Flex,
  Accordion,
  AccordionItem,
  AccordionButton,
  AccordionPanel,
  AccordionIcon,
  Button,
  useColorModeValue,
  Badge,
  SimpleGrid,
} from '@chakra-ui/react';
import { requestStorage } from '@extension/storage/dist/lib';

interface HistoryProps {
  transactionContext: any;
}

const History: React.FC<HistoryProps> = ({ transactionContext }) => {
  const [events, setEvents] = useState<any[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    requestStorage.getEvents().then((data: any) => {
      const sortedEvents = data.sort((a: any, b: any) => new Date(b.timestamp) - new Date(a.timestamp)); // Sort by timestamp
      setEvents(sortedEvents);
    });
  }, [transactionContext]);

  const totalPages = Math.ceil(events.length / itemsPerPage);

  // Helper to get the color based on the blockchain
  const getChainColor = (chain: string) => {
    switch (chain.toLowerCase()) {
      case 'ethereum':
        return 'blue.500';
      case 'bitcoin':
        return 'orange.500';
      default:
        return 'gray.500';
    }
  };

  const currentItems = events.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <Box>
      <Text fontSize="2xl" fontWeight="bold" mb={4}>
        Transaction History
      </Text>

      {currentItems.length > 0 ? (
        <Accordion allowMultiple>
          {currentItems.map((event: any) => (
            <AccordionItem key={event.id} borderRadius="md" mb={4} border="1px solid" borderColor="gray.200">
              <AccordionButton _expanded={{ bg: getChainColor(event.chain), color: 'white' }} borderRadius="md" p={4}>
                <Flex justifyContent="space-between" flex="1">
                  <Text>{new Date(event.timestamp).toLocaleString()}</Text>
                  <Text>{event.type}</Text>
                  <AccordionIcon />
                </Flex>
              </AccordionButton>
              <AccordionPanel pb={4}>
                <SimpleGrid columns={2} spacing={4}>
                  <Text>
                    <strong>Chain:</strong> {event.chain}
                  </Text>
                  <Text>
                    <strong>Platform:</strong> {event.platform}
                  </Text>
                  <Text>
                    <strong>Network ID:</strong> {event.networkId}
                  </Text>
                  <Text>
                    <strong>Status:</strong> <Badge colorScheme={getChainColor(event.chain)}>{event.status}</Badge>
                  </Text>
                  <Text>
                    <strong>From:</strong> {event.request?.from}
                  </Text>
                  <Text>
                    <strong>Gas:</strong> {event.request?.gas}
                  </Text>
                  <Text>
                    <strong>Site URL:</strong> {event.siteUrl}
                  </Text>
                  <Text>
                    <strong>Script Source:</strong> {event.scriptSource}
                  </Text>
                </SimpleGrid>
              </AccordionPanel>
            </AccordionItem>
          ))}
        </Accordion>
      ) : (
        <Text>No history available.</Text>
      )}

      {/* Pagination and total count */}
      <Flex justifyContent="space-between" mt={4} alignItems="center">
        <Text>Total Transactions: {events.length}</Text>
        <Flex>
          <Button onClick={() => setCurrentPage(currentPage - 1)} isDisabled={currentPage === 1} mr={2}>
            Previous
          </Button>
          <Text>
            {currentPage} / {totalPages}
          </Text>
          <Button onClick={() => setCurrentPage(currentPage + 1)} isDisabled={currentPage === totalPages} ml={2}>
            Next
          </Button>
        </Flex>
      </Flex>
    </Box>
  );
};

export default History;
