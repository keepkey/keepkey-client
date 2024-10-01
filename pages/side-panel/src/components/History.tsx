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
  Spinner,
  Badge,
  SimpleGrid,
  Image,
  IconButton,
  Checkbox,
  Select,
  useToast,
} from '@chakra-ui/react';
import { DeleteIcon } from '@chakra-ui/icons';
import { formatDistanceToNow, format } from 'date-fns'; // Library for formatting time
import { requestStorage } from '@extension/storage/dist/lib';

interface HistoryProps {
  transactionContext: any;
}

const History: React.FC<HistoryProps> = ({ transactionContext }) => {
  const [events, setEvents] = useState<any[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [assets, setAssets] = useState<any[]>([]);
  const [hideFailed, setHideFailed] = useState(false);
  const [selectedNetwork, setSelectedNetwork] = useState('');
  const [showUnix, setShowUnix] = useState(false); // Toggle for human-readable/Unix timestamps
  const itemsPerPage = 10;
  const toast = useToast();

  useEffect(() => {
    requestStorage.getEvents().then((data: any) => {
      const sortedEvents = data.sort((a: any, b: any) => new Date(b.timestamp) - new Date(a.timestamp));
      setEvents(sortedEvents);
    });
    fetchAssets();
  }, [transactionContext]);

  const fetchAssets = async () => {
    const response = await fetch('/api/GET_ASSETS'); // Replace with actual endpoint
    const data = await response.json();
    setAssets(data);
  };

  const getAssetIcon = (networkId: string) => {
    const asset = assets.find((a: any) => a.networkId === networkId);
    return asset ? asset.iconUrl : null;
  };

  const getStatusColor = (event: any) => {
    if (!event.txid) return 'red.500'; // Missing txid, mark red
    if (event.blockHeight) return 'green.500'; // Confirmed, mark green
    return 'gray.500'; // Default status color
  };

  const handleDelete = async (id: string) => {
    await requestStorage.removeEventById(id);
    setEvents(events.filter((event: any) => event.id !== id));
    toast({
      title: 'Transaction deleted.',
      status: 'success',
      duration: 2000,
      isClosable: true,
    });
  };

  const toggleTimestamp = () => setShowUnix(!showUnix);

  const totalPages = Math.ceil(events.length / itemsPerPage);
  const filteredEvents = events
    .filter((event: any) => !hideFailed || event.txid) // Hide failed transactions if checkbox is checked
    .filter((event: any) => !selectedNetwork || event.networkId === selectedNetwork);
  const currentItems = filteredEvents.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <Box>
      {/* Total Transactions and Network Selection */}
      <Flex justifyContent="space-between" alignItems="center" mb={4}>
        <Text fontSize="xs">Total Transactions: {filteredEvents.length}</Text>

        {/* Network Selection Dropdown */}
        <Select
          placeholder="Select network"
          size="sm"
          width="200px"
          value={selectedNetwork}
          onChange={e => setSelectedNetwork(e.target.value)}>
          {assets.map((asset: any) => (
            <option key={asset.networkId} value={asset.networkId}>
              {asset.networkId}
            </option>
          ))}
        </Select>
      </Flex>

      {/* Hide Failed Checkbox */}
      <Checkbox isChecked={hideFailed} onChange={e => setHideFailed(e.target.checked)} mb={4}>
        Hide Failed
      </Checkbox>

      {currentItems.length > 0 ? (
        <Accordion allowMultiple>
          {currentItems.map((event: any) => (
            <AccordionItem
              key={event.id}
              borderRadius="md"
              mb={4}
              border="1px solid"
              borderColor={getStatusColor(event)}>
              <AccordionButton _expanded={{ bg: getStatusColor(event), color: 'white' }} borderRadius="md" p={4}>
                <Flex justifyContent="space-between" flex="1">
                  {/* Status Badge */}
                  <Badge colorScheme={event.blockHeight ? 'green' : 'yellow'}>
                    {event.blockHeight ? 'Confirmed' : 'Pending'}
                  </Badge>
                  <Text>
                    {showUnix ? format(new Date(event.timestamp), 't') : formatDistanceToNow(new Date(event.timestamp))}{' '}
                    ago
                  </Text>
                  {event.txid && event.status === 'error' && (
                    <Spinner thickness="4px" speed="0.65s" emptyColor="gray.200" color="blue.500" size="lg" />
                  )}
                  <AccordionIcon />
                </Flex>
              </AccordionButton>
              <AccordionPanel pb={4}>
                <SimpleGrid columns={1} spacing={4}>
                  <Flex alignItems="center">
                    <strong>Network:</strong>{' '}
                    {getAssetIcon(event.networkId) && (
                      <Image src={getAssetIcon(event.networkId)} alt="network icon" boxSize="20px" ml={2} />
                    )}
                    <Text ml={2}>{event.networkId}</Text>
                  </Flex>
                  {event.txid && (
                    <Text>
                      <strong>Txid:</strong>{' '}
                      <a href={`https://etherscan.io/tx/${event.txid}`} target="_blank" rel="noopener noreferrer">
                        {event.txid}
                      </a>
                    </Text>
                  )}
                  <Text>
                    <strong>Status:</strong>{' '}
                    {event.blockHeight ? (
                      <Badge colorScheme="green">Confirmed</Badge>
                    ) : (
                      <Badge colorScheme="yellow">Pending</Badge>
                    )}
                  </Text>
                  <Text>
                    <strong>Site URL:</strong> {event.siteUrl}
                  </Text>
                </SimpleGrid>

                {/* Timestamp Toggle */}
                <Flex mt={4} alignItems="center">
                  <Text fontSize="sm">Show Unix Timestamp</Text>
                  <Checkbox isChecked={showUnix} onChange={toggleTimestamp} ml={2} size="sm" />
                </Flex>

                {/* Action Buttons */}
                <Flex mt={4} justifyContent="space-around">
                  <Button colorScheme="blue" onClick={() => console.log('Open transaction')} size="sm">
                    Open
                  </Button>
                  <Button colorScheme="green" onClick={() => console.log('Broadcast transaction')} size="sm">
                    Broadcast
                  </Button>
                  <Button colorScheme="teal" onClick={() => window.open(event.siteUrl, '_blank')} size="sm">
                    External
                  </Button>
                </Flex>

                {/* Delete Button */}
                <IconButton
                  aria-label="Delete transaction"
                  icon={<DeleteIcon />}
                  colorScheme="red"
                  size="sm"
                  mt={4}
                  onClick={() => handleDelete(event.id)}
                />
              </AccordionPanel>
            </AccordionItem>
          ))}
        </Accordion>
      ) : (
        <Text>No history available.</Text>
      )}

      {/* Pagination */}
      <Flex justifyContent="space-between" mt={4} alignItems="center">
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
    </Box>
  );
};

export default History;
