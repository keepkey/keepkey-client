import { useEffect, useState, useCallback, useRef } from 'react';
import { Box, Spinner, Flex, Text } from '@chakra-ui/react';
import { requestStorage } from '@extension/storage';
import Transaction from './Transaction';

// Events older than this are treated as abandoned and dropped on load.
const MAX_EVENT_AGE_MINUTES = 10;
// How long to show the empty state before auto-closing the popup. Long enough
// for the post-sign "signature_complete" → cleanup → Transaction.tsx window.close()
// to settle, short enough that a stuck/no-event popup doesn't linger.
const EMPTY_STATE_AUTO_CLOSE_MS = 3000;

const EventsViewer = () => {
  const [events, setEvents] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchEvents = useCallback(async () => {
    try {
      const storedEvents = (await requestStorage.getEvents()) || [];
      const now = Date.now();
      const valid: any[] = [];

      for (const event of storedEvents) {
        const ageMs = now - new Date(event.timestamp).getTime();
        if (ageMs <= MAX_EVENT_AGE_MINUTES * 60_000) {
          valid.push(event);
        } else {
          // Fire-and-forget; don't block the fetch on cleanup.
          void requestStorage.removeEventById(event.id);
        }
      }

      setEvents(valid.reverse());
      setFetchError(null);
    } catch (e: any) {
      console.error('EventsViewer: fetchEvents failed', e);
      setFetchError(e?.message || 'Failed to load pending requests');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
    // Live-refresh when events are added/removed by the background.
    const unsubscribe = requestStorage.subscribe?.(() => {
      fetchEvents();
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [fetchEvents]);

  // Auto-close the popup whenever there's nothing the user can act on —
  // empty state (dapp cancelled, cleanup ran, no pending request) OR a fetch
  // failure (storage corruption/null). Both UIs tell the user the window
  // will close itself, so the timer needs to cover both.
  useEffect(() => {
    if (loading) return;
    const shouldAutoClose = fetchError !== null || events.length === 0;
    if (!shouldAutoClose) return;
    autoCloseTimerRef.current = setTimeout(() => {
      console.log('EventsViewer: dead-end state timeout, closing popup');
      window.close();
    }, EMPTY_STATE_AUTO_CLOSE_MS);
    return () => {
      if (autoCloseTimerRef.current) {
        clearTimeout(autoCloseTimerRef.current);
        autoCloseTimerRef.current = null;
      }
    };
  }, [events.length, loading, fetchError]);

  // Clamp currentIndex inline so a mid-render shrink of the events list never
  // hands `undefined` to <Transaction />. Doing this in a useEffect leaves a
  // one-render gap where events[currentIndex] is undefined and crashes the
  // child before the effect can snap the index back.
  const safeIndex = events.length > 0 ? Math.min(currentIndex, events.length - 1) : 0;

  return (
    <Box maxW="100vw" overflowX="hidden" p={4}>
      {loading && (
        <Flex direction="column" align="center" justify="center" minH="200px" gap={3}>
          <Spinner />
          <Text fontSize="sm" opacity={0.7}>
            Loading pending requests...
          </Text>
        </Flex>
      )}

      {!loading && fetchError && (
        <Flex direction="column" align="center" justify="center" minH="200px" gap={3} p={4}>
          <Text fontWeight="bold">Couldn't load pending requests</Text>
          <Text fontSize="sm" opacity={0.7}>
            {fetchError}
          </Text>
          <Text fontSize="xs" opacity={0.5} mt={2}>
            This window will close automatically.
          </Text>
        </Flex>
      )}

      {!loading && !fetchError && events.length > 0 && (
        <Transaction event={events[safeIndex]} reloadEvents={fetchEvents} />
      )}

      {!loading && !fetchError && events.length === 0 && (
        <Flex direction="column" align="center" justify="center" minH="200px" gap={3}>
          <Text fontWeight="bold">No pending requests</Text>
          <Text fontSize="sm" opacity={0.7}>
            Nothing to approve right now.
          </Text>
          <Text fontSize="xs" opacity={0.5} mt={2}>
            This window will close automatically.
          </Text>
        </Flex>
      )}
    </Box>
  );
};

export default EventsViewer;
