import { Box, Divider, Flex, Text } from '@chakra-ui/react';
import { Fragment } from 'react';

/**
 * Types
 */
interface IProps {
  chains: string[];
  protocol: string;
}

/**
 * Component
 */
export default function RequestDetailsCard({ chains, protocol }: IProps) {
  return (
    <Fragment>
      <Flex direction="column" mb={4}>
        <Box mb={2}>
          <Text as="h5" fontSize="lg">
            Blockchain(s)
          </Text>
          <Text color="gray.400" data-testid="request-details-chain">
            {chains.join(', ')}
          </Text>
        </Box>
        <Divider my={2} />
        <Box>
          <Text as="h5" fontSize="lg">
            Relay Protocol
          </Text>
          <Text color="gray.400" data-testid="request-details-realy-protocol">
            {protocol}
          </Text>
        </Box>
      </Flex>
    </Fragment>
  );
}
