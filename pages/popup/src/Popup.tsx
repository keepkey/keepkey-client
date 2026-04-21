import { withErrorBoundary, withSuspense } from '@extension/shared';
import { Button, Flex, Spinner, Text } from '@chakra-ui/react';
import EventsViewer from './components/Events';

const Popup = () => {
  return (
    <div>
      <EventsViewer />
    </div>
  );
};

const LoadingFallback = (
  <Flex direction="column" align="center" justify="center" minH="200px" gap={3}>
    <Spinner />
    <Text fontSize="sm" opacity={0.7}>
      Loading...
    </Text>
  </Flex>
);

const ErrorFallback = (
  <Flex direction="column" align="center" justify="center" minH="200px" gap={3} p={4}>
    <Text fontWeight="bold">Something went wrong</Text>
    <Text fontSize="sm" opacity={0.7} textAlign="center">
      The approval window hit an unexpected error. You can close this window and retry the request in your dapp.
    </Text>
    <Button size="sm" onClick={() => window.close()} mt={2}>
      Close
    </Button>
  </Flex>
);

export default withErrorBoundary(withSuspense(Popup, LoadingFallback), ErrorFallback);
