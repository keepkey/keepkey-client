import { Box, Divider, Link, Text, Flex, Button } from '@chakra-ui/react';
import { WarningIcon } from '@chakra-ui/icons';

import RequestModalContainer from './RequestModalContainer';

interface IProps {
  metadata: {
    icons: string[];
    name: string;
    url: string;
  };
  onApprove: () => void;
  onReject: () => void;
}

export default function ThreatPrompt({ metadata, onApprove, onReject }: IProps) {
  const { url } = metadata;

  return (
    <RequestModalContainer title="">
      <Box textAlign="center" p={5}>
        <Flex justify="center" mb={4}>
          <WarningIcon boxSize={14} color="red.500" />
        </Flex>
        <Text fontSize="2xl" fontWeight="bold" mb={4}>
          Website flagged
        </Text>
        <Link href={url} data-testid="session-info-card-url" isExternal color="blue.500">
          {url}
        </Link>
        <Divider my={4} />
        <Text mb={4}>
          This website you`re trying to connect is flagged as malicious by multiple security providers. Approving may
          lead to loss of funds.
        </Text>
        <Button colorScheme="red" mb={4} onClick={onApprove}>
          Proceed anyway
        </Button>
        <Button variant="outline" onClick={onReject}>
          Close
        </Button>
      </Box>
    </RequestModalContainer>
  );
}
