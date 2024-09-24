import {
  Box,
  Heading,
  Text,
  Avatar,
  Flex,
  Alert,
  AlertIcon,
  Spinner,
  Card,
  CardHeader,
  CardBody,
  Button,
  Collapse,
} from '@chakra-ui/react';
import { CheckIcon, WarningIcon } from '@chakra-ui/icons';
import { useState } from 'react';

interface TransactionRequest {
  from: string;
  to: string;
  data: string;
}

interface Transaction {
  request: TransactionRequest;
}

interface ContractDetailsCardProps {
  transaction: Transaction;
}

// Fixing the requestSmartInsight to pass correct transaction details
const requestSmartInsight = (transaction: Transaction) => {
  return new Promise((resolve, reject) => {
    //TODO handle 712 data
    chrome.runtime.sendMessage(
      { tx: transaction.request, source: transaction?.request?.from, type: 'GET_TX_INSIGHT' },
      response => {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError);
        }
        resolve(response);
      },
    );
  });
};

export default function ContractDetailsCard({ transaction }: ContractDetailsCardProps) {
  const [apiResponse, setApiResponse] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleGetInsight = async () => {
    try {
      if (!transaction) {
        throw new Error('Transaction data is missing.');
      }

      setIsLoading(true);
      setApiResponse(null);

      const response: any = await requestSmartInsight(transaction);

      if (!response) {
        setApiResponse(null);
      } else {
        setApiResponse(response);
      }
    } catch (error: any) {
      console.error('Error fetching API response:', error);

      let errorMessage = 'Failed to fetch API response.';
      if (error.message) {
        errorMessage = error.message;
      }

      setApiResponse({ error: errorMessage });
    } finally {
      setIsLoading(false);
    }
  };

  // Determine recommended action
  const recommendedAction = apiResponse?.pioneer?.recommendation?.toUpperCase() || 'UNKNOWN';

  // Function to render the summary properly
  const renderSummary = (summary: string) => {
    return (
      <Box width="100%" mb={4}>
        <Heading as="h6" size="md" mb={2}>
          Summary
        </Heading>
        <Text>{summary}</Text>
      </Box>
    );
  };

  return (
    <Card mt={4} shadow="md" borderWidth="1px">
      <CardHeader>
        <Flex alignItems="center">
          <Avatar src={'https://pioneers.dev/coins/pioneerMan.png'} size="md" mr={4} />
          <Heading as="h5" size="lg">
            Pioneer Summary:
          </Heading>
        </Flex>
      </CardHeader>
      <CardBody>
        {!apiResponse && !isLoading && (
          <Button colorScheme="blue" onClick={handleGetInsight}>
            Get Smart Insight
          </Button>
        )}
        {isLoading ? (
          <Flex justifyContent="center" alignItems="center" height="200px">
            <Spinner size="lg" />
          </Flex>
        ) : apiResponse?.error ? (
          <Alert status="error" borderRadius="md" mt={4}>
            <AlertIcon />
            {apiResponse.error}
          </Alert>
        ) : apiResponse ? (
          <>
            {/* Recommended Action Box */}
            {recommendedAction === 'ALLOW' ? (
              <Box bg="green.100" p={4} borderRadius="md" mb={4} width="100%">
                <Flex alignItems="center">
                  <CheckIcon color="green.500" boxSize={6} mr={2} />
                  <Text fontSize="lg" fontWeight="bold" color="green.800">
                    ALLOW
                  </Text>
                </Flex>
              </Box>
            ) : recommendedAction === 'REJECT' ? (
              <Box bg="red.100" p={4} borderRadius="md" mb={4} width="100%">
                <Flex alignItems="center">
                  <WarningIcon color="red.500" boxSize={6} mr={2} />
                  <Text fontSize="lg" fontWeight="bold" color="red.800">
                    REJECT
                  </Text>
                </Flex>
              </Box>
            ) : (
              <Alert status="warning" mb={4} borderRadius="md">
                <AlertIcon />
                Warning: Potential issues detected.
              </Alert>
            )}

            {/* Summary */}
            {apiResponse?.pioneer?.summary && renderSummary(apiResponse.pioneer.summary)}

            {/* Advanced Section */}
            <Button variant="link" onClick={() => setShowAdvanced(!showAdvanced)} mb={2}>
              {showAdvanced ? 'Hide Advanced' : 'Show Advanced'}
            </Button>
            <Collapse in={showAdvanced} animateOpacity>
              <Box mt={4} p={4} borderRadius="md">
                <Heading as="h6" size="sm" mb={2}>
                  Raw API Response
                </Heading>
                <pre style={{ whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}>
                  {JSON.stringify(apiResponse, null, 2)}
                </pre>
              </Box>
            </Collapse>
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}
