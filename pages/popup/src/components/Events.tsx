import React, { useEffect, useState, useCallback } from 'react';
import { Box, Button, Flex, Text, Spinner } from '@chakra-ui/react';
import { requestStorage } from '@extension/storage';
import Transaction from './Transaction';

const EventsViewer = () => {
  const [events, setEvents] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState<boolean>(true);

  // Function to calculate the age of the event in minutes
  const getEventAgeInMinutes = (timestamp: string) => {
    const eventTime = new Date(timestamp).getTime();
    const currentTime = Date.now();
    const ageInMinutes = (currentTime - eventTime) / 60000; // Convert milliseconds to minutes
    return ageInMinutes;
  };

  // Optimized event fetching to prevent endless loops
  const fetchEvents = useCallback(async () => {
    setLoading(true); // Show spinner while fetching events
    const storedEvents = await requestStorage.getEvents();
    const validEvents = [];

    for (const event of storedEvents) {
      const ageInMinutes = getEventAgeInMinutes(event.timestamp);
      if (ageInMinutes <= 10) {
        validEvents.push(event); // Keep events that are within 10 minutes
      } else {
        await requestStorage.removeEventById(event.id); // Remove events older than 10 minutes
      }
    }

    // Set the valid events and reverse them to show latest first
    setEvents(validEvents.reverse());
    setLoading(false); // Stop spinner after events are loaded

    // If no events are found, close the window
    if (validEvents.length === 0) {
      window.close();
    }
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const nextEvent = () => {
    if (currentIndex < events.length - 1) {
      setCurrentIndex(currentIndex + 1);
      resetTransactionState();
    }
  };

  const previousEvent = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      resetTransactionState();
    }
  };

  const clearRequestEvents = async () => {
    await requestStorage.clearEvents();
    fetchEvents();
    setCurrentIndex(0);
  };

  // Reset transaction state when switching between events
  const resetTransactionState = () => {
    // Here you can reset any transaction-related state
    setLoading(false);
  };

  return (
    <Box>
      {/* Show spinner if events are being fetched */}
      {loading && <Spinner />}

      {/* Show event count at the top */}
      <Text fontSize="lg" fontWeight="bold">
        Event Count: {events.length}
      </Text>

      {/* Only show event details if events are loaded */}
      {events.length > 0 && !loading ? (
        <Box>
          {/* Show the age of the current event */}
          <Text fontSize="md" fontWeight="medium">
            Chain: {events[currentIndex].chain}
            <br />
            Event Age: {Math.floor(getEventAgeInMinutes(events[currentIndex].timestamp))} minutes
          </Text>

          {/* Pass the current event to the Transaction component */}
          <Transaction event={events[currentIndex]} reloadEvents={fetchEvents} />
        </Box>
      ) : (
        <div>No events</div>
      )}

      {/* Navigation buttons */}
      <Flex mt={4} justify="space-between">
        <Button onClick={previousEvent} disabled={currentIndex === 0}>
          Previous
        </Button>
        <Button onClick={nextEvent} disabled={currentIndex === events.length - 1}>
          Next
        </Button>
        <Button onClick={clearRequestEvents}>Clear Events</Button>
      </Flex>
    </Box>
  );
};

export default EventsViewer;
