import React from 'react';
import { Flex, Card, CardBody, Heading, Button, CloseButton } from '@chakra-ui/react';
import { SpinningDevice } from '../components/SpinningDevice';

const AwaitingApproval = ({ onCancel }: { onCancel: () => void }) => {
  return (
    <Flex justify="center" align="center" height="100vh">
      <Card
        width="400px"
        bg="kk.surface"
        borderColor="kk.line"
        borderWidth="1px"
        boxShadow="lg"
        borderRadius="lg"
        overflow="hidden"
        position="relative">
        {/* Close button in the top-right corner */}
        <CloseButton position="absolute" top="8px" right="8px" onClick={onCancel} />

        <CardBody>
          <Flex direction="column" align="center">
            <Heading as="h2" size="md" mb={4} textAlign="center">
              Device Signing Request
            </Heading>
            <SpinningDevice scale={0.46} durationSeconds={9} label="APPROVE" style={{ marginBottom: 16 }} />
            <Heading as="h3" size="md" mb={4} textAlign="center">
              Please approve the transaction on your KeepKey
            </Heading>
            <br />
            or....
            <br />
            <br />
            <Button variant="ghost" onClick={onCancel}>
              Abort Signing
            </Button>
          </Flex>
        </CardBody>
      </Card>
    </Flex>
  );
};

export default AwaitingApproval;
