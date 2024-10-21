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
  Collapse,
  Tooltip,
} from '@chakra-ui/react';
import { DeleteIcon, InfoOutlineIcon } from '@chakra-ui/icons';
import { formatDistanceToNow, format } from 'date-fns';
import { requestStorage } from '@extension/storage';
import { motion, AnimatePresence } from 'framer-motion';

interface HistoryProps {
  transactionContext: any;
}

const MotionBox = motion(Box);

const History: React.FC<HistoryProps> = ({ transactionContext }) => {
  const [events, setEvents] = useState<any[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [assets, setAssets] = useState<any[]>([]);
  const [hideFailed, setHideFailed] = useState(false);
  const [selectedNetwork, setSelectedNetwork] = useState('');
  const [showUnix, setShowUnix] = useState(false);
  const [expandedRawJson, setExpandedRawJson] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const itemsPerPage = 10;
  const toast = useToast();

  // Function to load events from storage
  const loadEvents = async () => {
    try {
      console.log('Fetching events from requestStorage...');
      const data = await requestStorage.getEvents();
      if (!data || data.length === 0) {
        console.error('No events found in storage.');
        setIsLoading(false);
        return;
      }
      console.log('Events fetched:', data);
      const sortedEvents = data.sort(
        (a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
      setEvents(sortedEvents);
      setIsLoading(false);
    } catch (error) {
      console.error('Error fetching events:', error);
      setIsLoading(false); // Ensure loading is finished even if there's an error
    }
  };

  // Add a log when adding events to verify that the event is actually saved
  const addEventToStorage = async (event: any) => {
    console.log('Adding event to requestStorage:', event);
    const result = await requestStorage.addEvent(event);
    console.log('Event added result:', result);
    loadEvents(); // Re-load events after adding a new one
  };

  // UseEffect to initially load events and subscribe to updates
  useEffect(() => {
    loadEvents();

    // Subscribe to storage changes
    const unsubscribe = requestStorage.subscribe(() => {
      console.log('Storage updated, reloading events...');
      loadEvents();
    });

    fetchAssets();

    return () => {
      unsubscribe();
    };
  }, [transactionContext]);

  const fetchAssets = async () => {
    try {
      const response = await fetch('/api/GET_ASSETS'); // Replace with actual endpoint
      const data = await response.json();
      setAssets(data);
    } catch (error) {
      console.error('Error fetching assets:', error);
    }
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
    console.log(`Deleting event with id: ${id}`);
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

  const toggleRawJson = (id: string) => {
    setExpandedRawJson(prevId => (prevId === id ? null : id));
  };

  return (
    <Box>
      {/* Total Transactions and Network Selection */}
      <Flex justifyContent="space-between" alignItems="center" mb={4}>
        <Text fontSize="md" fontWeight="bold">
          Total Transactions: {filteredEvents.length}
        </Text>

        {/* Network Selection Dropdown */}
        {/*<Select*/}
        {/*    placeholder="Select network"*/}
        {/*    size="sm"*/}
        {/*    width="200px"*/}
        {/*    value={selectedNetwork}*/}
        {/*    onChange={e => setSelectedNetwork(e.target.value)}*/}
        {/*>*/}
        {/*  {assets.map((asset: any) => (*/}
        {/*      <option key={asset.networkId} value={asset.networkId}>*/}
        {/*        {asset.networkId}*/}
        {/*      </option>*/}
        {/*  ))}*/}
        {/*</Select>*/}
      </Flex>

      <Flex justifyContent="space-between" alignItems="center" mb={4}>
        {/* Hide Failed Checkbox */}
        <Checkbox isChecked={hideFailed} onChange={e => setHideFailed(e.target.checked)} mb={4}>
          Hide Failed
        </Checkbox>

        {/* Timestamp Toggle */}
        <Flex alignItems="center">
          <Text fontSize="sm">Show Unix Timestamp</Text>
          <Checkbox isChecked={showUnix} onChange={toggleTimestamp} ml={2} size="sm" />
        </Flex>
      </Flex>

      {isLoading ? (
        <Flex justifyContent="center" mt={10}>
          <Spinner size="xl" />
        </Flex>
      ) : currentItems.length > 0 ? (
        <Accordion allowMultiple>
          <AnimatePresence>
            {currentItems.map((event: any) => (
              <MotionBox
                key={event.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.2 }}
                mb={4}>
                <AccordionItem borderRadius="md" border="1px solid" borderColor={getStatusColor(event)} boxShadow="md">
                  <AccordionButton _expanded={{ bg: getStatusColor(event), color: 'white' }} borderRadius="md" p={4}>
                    <Flex justifyContent="space-between" flex="1" alignItems="center">
                      {/* Status Badge */}
                      <Badge colorScheme={event.blockHeight ? 'green' : 'yellow'}>
                        {event.blockHeight ? 'Confirmed' : 'Pending'}
                      </Badge>

                      {/* Timestamp */}
                      <Text fontSize="sm">
                        {showUnix
                          ? format(new Date(event.timestamp), 't')
                          : formatDistanceToNow(new Date(event.timestamp))}{' '}
                        ago
                      </Text>

                      {/* Spinner for pending transactions */}
                      {!event.blockHeight && (
                        <Spinner thickness="2px" speed="0.65s" emptyColor="gray.200" color="blue.500" size="sm" />
                      )}

                      <AccordionIcon />
                    </Flex>
                  </AccordionButton>
                  <AccordionPanel pb={4}>
                    <SimpleGrid columns={1} spacing={4}>
                      <Flex alignItems="center">
                        <strong>Network:</strong>
                        {getAssetIcon(event.networkId) && (
                          <Image src={getAssetIcon(event.networkId)} alt="network icon" boxSize="20px" ml={2} />
                        )}
                        <Text ml={2}>{event.networkId}</Text>
                      </Flex>
                      {event.txid && typeof event.txid === 'object' && event.txid.txid ? (
                        <Text>
                          <strong>Txid:</strong>{' '}
                          <a
                            href={`https://etherscan.io/tx/${event.txid.txid}`}
                            target="_blank"
                            rel="noopener noreferrer">
                            {event.txid.txid}
                          </a>
                        </Text>
                      ) : (
                        <Text>
                          <strong>Txid:</strong> {event.txid}
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
                      <Tooltip label="View Raw JSON" aria-label="View Raw JSON">
                        <IconButton
                          icon={<InfoOutlineIcon />}
                          aria-label="View Raw JSON"
                          onClick={() => toggleRawJson(event.id)}
                          size="sm"
                        />
                      </Tooltip>
                    </Flex>

                    {/* Raw JSON Data */}
                    <Collapse in={expandedRawJson === event.id} animateOpacity>
                      <Box
                        mt={4}
                        p={4}
                        bg="black"
                        borderRadius="md"
                        overflow="auto"
                        maxHeight="200px"
                        whiteSpace="pre-wrap"
                        fontSize="sm">
                        <pre>{JSON.stringify(event, null, 2)}</pre>
                      </Box>
                    </Collapse>

                    {/* Delete Button */}
                    <Flex mt={4} justifyContent="flex-end">
                      <IconButton
                        aria-label="Delete transaction"
                        icon={<DeleteIcon />}
                        colorScheme="red"
                        size="sm"
                        onClick={() => handleDelete(event.id)}
                      />
                    </Flex>
                  </AccordionPanel>
                </AccordionItem>
              </MotionBox>
            ))}
          </AnimatePresence>
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
          Page {currentPage} / {totalPages}
        </Text>
        <Button onClick={() => setCurrentPage(currentPage + 1)} isDisabled={currentPage === totalPages} ml={2}>
          Next
        </Button>
      </Flex>
    </Box>
  );
};

export default History;
