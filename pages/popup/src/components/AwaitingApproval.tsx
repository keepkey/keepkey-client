import React from 'react';
import { Flex, Card, CardBody, Image, Heading, Button, CloseButton } from '@chakra-ui/react';
import holdAndReleaseIcon from '../assets/svg/hold-and-release.svg';

const AwaitingApproval = ({ onCancel }: { onCancel: () => void; onClose: () => void }) => {
  return (
    <Flex justify="center" align="center" height="100vh">
      <Card width="400px" boxShadow="lg" borderRadius="lg" overflow="hidden" position="relative">
        {/* Close button in the top-right corner */}
        <CloseButton position="absolute" top="8px" right="8px" onClick={onCancel} />

        <CardBody>
          <Flex direction="column" align="center">
            <Heading as="h2" size="md" mb={4} textAlign="center">
              Device Signing Request
            </Heading>
            <Image src={holdAndReleaseIcon} alt="KeepKey - Approve on device" boxSize="150px" mb={4} />
            <Heading as="h3" size="md" mb={4} textAlign="center">
              Please approve the transaction on your KeepKey
            </Heading>
            <br />
            or....
            <br />
            <br />
            <Button colorScheme="yellow" onClick={onCancel}>
              Abort Signing
            </Button>
          </Flex>
        </CardBody>
      </Card>
    </Flex>
  );
};

export default AwaitingApproval;
