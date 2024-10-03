import React, { useEffect, useState } from 'react';
import {
  Box,
  Text,
  Icon,
  Button,
  Card,
  CardBody,
  Divider,
  IconButton,
  Tooltip,
  useClipboard,
  Flex,
} from '@chakra-ui/react';
import { CheckCircleIcon, CopyIcon } from '@chakra-ui/icons';
import Confetti from 'react-confetti';

const TxidPage = ({ txHash, explorerUrl }: { txHash: string; explorerUrl: string }) => {
  const [showConfetti, setShowConfetti] = useState(true);
  const { hasCopied, onCopy } = useClipboard(txHash); // Chakra hook for clipboard functionality

  // Stop the confetti after 5 seconds
  useEffect(() => {
    const confettiTimer = setTimeout(() => {
      setShowConfetti(false);
    }, 5000);

    return () => clearTimeout(confettiTimer);
  }, []);

  return (
    <Flex
      align="center"
      justify="center"
      minHeight="100vh"
      backgroundColor="gray.900" // You can set this to the background color you prefer
    >
      <Card
        border="1px solid white"
        borderRadius="md"
        p={8}
        textAlign="center"
        backgroundColor="gray.900"
        color="white">
        <CardBody>
          {/* Conditionally show confetti for 5 seconds */}
          {showConfetti && <Confetti />}

          {/* Success message with a green checkmark */}
          <Icon as={CheckCircleIcon} boxSize={16} color="green.400" mb={4} />

          <Text fontSize="2xl" fontWeight="bold" mb={4}>
            Success! Your transaction is complete.
          </Text>

          <Divider my={4} />

          {/* Display the transaction hash in a large format */}
          <Text fontSize="lg" fontWeight="medium" mb={2}>
            Transaction Hash:
          </Text>

          <Box display="flex" alignItems="center" justifyContent="center" mb={6}>
            <Text fontSize="xl" fontWeight="bold" wordBreak="break-all" mr={2}>
              {txHash}
            </Text>

            {/* Copy to clipboard button */}
            <Tooltip label={hasCopied ? 'Copied!' : 'Copy to clipboard'} closeOnClick={false} hasArrow>
              <IconButton
                aria-label="Copy to clipboard"
                icon={<CopyIcon />}
                onClick={onCopy}
                size="sm"
                colorScheme={hasCopied ? 'green' : 'gray'}
              />
            </Tooltip>
          </Box>

          {/* Button to view the transaction on the explorer */}
          <Button as="a" href={explorerUrl} target="_blank" rel="noopener noreferrer" colorScheme="teal" size="lg">
            View on Explorer
          </Button>
        </CardBody>
      </Card>
    </Flex>
  );
};

export default TxidPage;
