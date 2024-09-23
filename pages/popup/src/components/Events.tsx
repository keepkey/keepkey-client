import React, { useEffect, useState, useCallback } from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { requestStorage } from '@extension/storage';
import Transaction from './Transaction';

const EventsViewer = () => {
  const [events, setEvents] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Function to calculate the age of the event in minutes
  const getEventAgeInMinutes = (timestamp: string) => {
    const eventTime = new Date(timestamp).getTime();
    const currentTime = Date.now();
    const ageInMinutes = (currentTime - eventTime) / 60000; // Convert milliseconds to minutes
    return ageInMinutes;
  };

  // Optimized event fetching to prevent endless loops
  const fetchEvents = useCallback(async () => {
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
    setEvents(validEvents);

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
    }
  };

  const previousEvent = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const clearRequestEvents = async () => {
    await requestStorage.clearEvents();
    fetchEvents();
    setCurrentIndex(0);
  };

  return (
    <Box>
      {/* Show event count at the top */}
      <Text fontSize="lg" fontWeight="bold">
        Event Count: {events.length}
      </Text>
      {events.length > 0 ? (
        <Box>
          {/* Show the age of the current event */}
          <Text fontSize="md" fontWeight="medium">
            chain: {events[currentIndex].chain}
            <br />
            Event Age: {Math.floor(getEventAgeInMinutes(events[currentIndex].timestamp))} minutes
          </Text>
          <Transaction event={events[currentIndex]} reloadEvents={fetchEvents} />
        </Box>
      ) : (
        <div>No events</div>
      )}

      {/* Only one navigation */}
      <Flex mt={4} justify="space-between">
        <Button onClick={previousEvent} disabled={currentIndex === 0}>
          Previous
        </Button>
        <Button onClick={nextEvent} disabled={currentIndex === events.length - 1}>
          Next
        </Button>
      </Flex>
    </Box>
  );
};

export default EventsViewer;
