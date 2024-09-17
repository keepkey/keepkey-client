import React, { useEffect, useState } from 'react';
import { Box, Button, Flex } from '@chakra-ui/react';
import {
  requestStorage,
  approvalStorage,
  completedStorage,
  assetContextStorage,
} from '@chrome-extension-boilerplate/storage';
import Transaction from './Transaction';
import { Classic } from '@coinmasters/pioneer-lib';

const EventsViewer = ({ usePioneer }: any) => {
  const { state } = usePioneer();
  const { app, assetContext, context } = state;
  const [events, setEvents] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentProvider, setCurrentProvider] = useState<any>(null);

  const fetchEvents = async () => {
    const storedEvents = await requestStorage.getEvents();
    console.log('storedEvents: ', storedEvents);
    setEvents(storedEvents || []);
  };

  const fetchProvider = () => {
    chrome.runtime.sendMessage({ type: 'GET_PROVIDER' }, async response => {
      if (response && response.provider) {
        console.log('response: ', response);
        console.log('response: ', response.caip);
        const storedContext = await assetContextStorage.get();
        console.log('**** storedContext: ', storedContext);
        if (!storedContext || storedContext.provider !== response.provider) {
          // await assetContextStorage.updateContext('provider', response.provider);
          if (app) app.setAssetContext(response);
          setCurrentProvider(response.provider);
        }
      }
    });
  };

  const fetchAssetContext = async () => {
    console.log('************ TESTING ************');
    try {
      const context = await assetContextStorage.get();
      console.log('**** storedContext: ', context);
      if (app) {
        if (context) {
          app.setAssetContext(context);
        } else {
          app.setAssetContext({ caip: 'eip155:1/slip44:60' });
        }
      } else {
        console.error('Unable to set asset context. App is not defined.');
      }
      setCurrentProvider(context?.provider);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchEvents();
    fetchAssetContext();
  }, []);

  useEffect(() => {
    if (app) {
      fetchEvents();
      fetchProvider();
      fetchAssetContext();
    }
  }, [app]);

  useEffect(() => {
    if (app && currentProvider === null) {
      fetchProvider();
    }
  }, [app, currentProvider]);

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
        <Classic usePioneer={usePioneer}></Classic>
      )}
    </Box>
  );
};

export default EventsViewer;
