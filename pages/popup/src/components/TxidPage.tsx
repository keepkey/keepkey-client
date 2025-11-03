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

const TxidPage = ({ txHash, explorerUrl }: { txHash: string; explorerUrl?: string }) => {
  const [showConfetti, setShowConfetti] = useState(true);
  const { hasCopied, onCopy } = useClipboard(txHash); // Chakra hook for clipboard functionality

  // Stop the confetti after 5 seconds
  useEffect(() => {
    const confettiTimer = setTimeout(() => {
      setShowConfetti(false);
    }, 5000);

    return () => clearTimeout(confettiTimer);
  }, []);

  // Function to handle the View on Explorer and close popup
  const handleExplorerClick = () => {
    if (explorerUrl) {
      window.open(explorerUrl, '_blank', 'noopener,noreferrer'); // Open the explorer URL
      window.close(); // Close the popup
    }
  };

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

          {/* Button to view the transaction on the explorer and close the popup */}
          {explorerUrl && (
            <Button onClick={handleExplorerClick} colorScheme="teal" size="lg" mb={2}>
              View on Explorer
            </Button>
          )}

          {/* Close button - always available */}
          <Button onClick={() => window.close()} colorScheme="gray" size="lg" variant="outline">
            Close
          </Button>
        </CardBody>
      </Card>
    </Flex>
  );
};

export default TxidPage;
