import React, { useEffect, useState } from 'react';
import { Box, Button, Flex } from '@chakra-ui/react';
import { requestStorage, approvalStorage, completedStorage, assetContextStorage } from '@extension/storage';
import Transaction from './Transaction';

const EventsViewer = () => {
  const [events, setEvents] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentProvider, setCurrentProvider] = useState<any>(null);

  const fetchEvents = async () => {
    const storedEvents = await requestStorage.getEvents();
    console.log('storedEvents: ', storedEvents);
    setEvents(storedEvents || []);
  };

  useEffect(() => {
    fetchEvents();
    // fetchAssetContext();
  }, []);

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

  const clearApprovalEvents = async () => {
    await approvalStorage.clearEvents();
  };

  const clearCompletedEvents = async () => {
    await completedStorage.clearEvents();
  };

  return (
    <Box>
      {events.length > 0 ? (
        <Transaction event={events[currentIndex]} reloadEvents={fetchEvents} />
      ) : (
        <div>No events</div>
      )}
    </Box>
  );
};

export default EventsViewer;
