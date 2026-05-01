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
  Link,
} from '@chakra-ui/react';
import { CheckCircleIcon, CopyIcon, ExternalLinkIcon } from '@chakra-ui/icons';
import Confetti from 'react-confetti';

const TxidPage = ({ txHash, explorerUrl, onClose }: { txHash: string; explorerUrl?: string; onClose?: () => void }) => {
  const [showConfetti, setShowConfetti] = useState(true);
  const { hasCopied, onCopy } = useClipboard(txHash);

  useEffect(() => {
    const confettiTimer = setTimeout(() => {
      setShowConfetti(false);
    }, 5000);
    return () => clearTimeout(confettiTimer);
  }, []);

  const handleExplorerClick = () => {
    if (explorerUrl) {
      window.open(explorerUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const handleClose = () => {
    onClose?.();
  };

  const truncatedHash = txHash.length > 20 ? `${txHash.slice(0, 10)}...${txHash.slice(-10)}` : txHash;

  return (
    <Flex align="center" justify="center" minHeight="100vh" backgroundColor="gray.900">
      <Card
        border="1px solid white"
        borderRadius="md"
        p={6}
        textAlign="center"
        backgroundColor="gray.900"
        color="white"
        maxW="380px"
        w="100%">
        <CardBody>
          {showConfetti && <Confetti />}

          <Icon as={CheckCircleIcon} boxSize={12} color="green.400" mb={3} />

          <Text fontSize="xl" fontWeight="bold" mb={3}>
            Transaction Complete
          </Text>

          <Divider my={3} />

          <Text fontSize="sm" color="whiteAlpha.700" mb={2}>
            Transaction Hash
          </Text>

          <Flex alignItems="center" justifyContent="center" mb={4} gap={2}>
            {explorerUrl ? (
              <Link
                href={explorerUrl}
                isExternal
                fontFamily="mono"
                fontSize="sm"
                fontWeight="bold"
                color="blue.300"
                _hover={{ color: 'blue.200', textDecoration: 'underline' }}
                wordBreak="break-all">
                {truncatedHash}
                <ExternalLinkIcon mx={1} boxSize={3} />
              </Link>
            ) : (
              <Text fontFamily="mono" fontSize="sm" fontWeight="bold" wordBreak="break-all">
                {truncatedHash}
              </Text>
            )}

            <Tooltip label={hasCopied ? 'Copied!' : 'Copy full hash'} closeOnClick={false} hasArrow>
              <IconButton
                aria-label="Copy to clipboard"
                icon={<CopyIcon />}
                onClick={onCopy}
                size="xs"
                colorScheme={hasCopied ? 'green' : 'gray'}
                variant="ghost"
              />
            </Tooltip>
          </Flex>

          <Flex direction="column" gap={2}>
            {explorerUrl && (
              <Button onClick={handleExplorerClick} colorScheme="teal" size="md" w="100%">
                View on Explorer
              </Button>
            )}

            <Button onClick={handleClose} colorScheme="gray" size="md" variant="outline" w="100%">
              Close
            </Button>
          </Flex>
        </CardBody>
      </Card>
    </Flex>
  );
};

export default TxidPage;
