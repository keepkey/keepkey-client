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
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Badge,
  VStack,
  HStack,
} from '@chakra-ui/react';
import { CheckIcon } from '@chakra-ui/icons';
import { useState, useEffect } from 'react';
import axios from 'axios';

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

export default function ContractDetailsCard({ transaction }: ContractDetailsCardProps) {
  const [apiResponse, setApiResponse] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  // const harpieLogoUrl =
  //   'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTWg0ouWVCbQHXGmOxH2pMnL9B0S8DA9pnapogVb3JxicS1sni0pwLWQO0M5UO4hiVjr9c&usqp=CAU';
  //
  // useEffect(() => {
  //   const fetchApiResponse = async () => {
  //     try {
  //       if (!transaction) {
  //         throw new Error('Transaction data is missing.');
  //       }
  //
  //       // Ensure transaction.request is used as per your requirement
  //       const tx = { ...transaction.request };
  //       tx.from = '0x141D9959cAe3853b035000490C03991eB70Fc4aC';
  //       console.log('tx: ', tx);
  //
  //       const response = await axios.post(
  //         'http://127.0.0.1:9001/api/v1/checkTx',
  //         { tx },
  //         {
  //           headers: {
  //             'Content-Type': 'application/json',
  //             Authorization: `Bearer keepkey-client-v1`,
  //           },
  //           validateStatus: status => status < 500, // Resolve only if the status code is less than 500
  //         },
  //       );
  //
  //       console.log('response: ', response);
  //
  //       if (response.status === 204) {
  //         // No Content
  //         setApiResponse(null);
  //       } else {
  //         const data = response.data;
  //         console.log('data: ', data);
  //         setApiResponse(data);
  //       }
  //     } catch (error: any) {
  //       console.error('Error fetching API response:', error);
  //
  //       let errorMessage = 'Failed to fetch API response.';
  //       if (error.response) {
  //         errorMessage = `API error: ${error.response.status} ${error.response.statusText}`;
  //       } else if (error.request) {
  //         errorMessage = 'No response received from the server.';
  //       } else if (error.message) {
  //         errorMessage = error.message;
  //       }
  //
  //       setApiResponse({ error: errorMessage });
  //     } finally {
  //       setIsLoading(false);
  //     }
  //   };
  //   fetchApiResponse();
  // }, [transaction]);

  // Determine if there are any alert flags
  const flags = apiResponse?.addressDetails?.tags || {};
  const hasAlerts = Object.keys(flags).length > 0 && Object.values(flags).some(value => value === true);

  // Determine recommended action
  const recommendedAction = apiResponse?.recommendedAction || 'UNKNOWN';

  // Recursive function to render nested objects safely
  const renderResponseFields = (obj: any) => {
    if (typeof obj !== 'object' || obj === null) {
      return null;
    }

    return (
      <VStack align="start" spacing={2} width="100%">
        {Object.entries(obj).map(([key, value]) => {
          const isObject = typeof value === 'object' && value !== null;
          const displayValue = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);

          return (
            <Box key={key} width="100%">
              {isObject ? (
                <Box>
                  <Heading as="h6" size="sm" mb={1}>
                    {key.charAt(0).toUpperCase() + key.slice(1)}
                  </Heading>
                  {renderResponseFields(value)}
                </Box>
              ) : (
                <HStack justify="space-between" width="100%">
                  <Text fontWeight="medium" textTransform="capitalize">
                    {key}:
                  </Text>
                  <Text>{displayValue}</Text>
                </HStack>
              )}
            </Box>
          );
        })}
      </VStack>
    );
  };

  // Function to render the summary properly
  const renderSummary = (summary: string) => {
    return (
      <Box width="100%">
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
          <Avatar src={harpieLogoUrl} size="md" mr={4} />
          <Heading as="h5" size="lg">
            Harpie Analysis
          </Heading>
        </Flex>
      </CardHeader>
      <CardBody>
        {isLoading ? (
          <Flex justifyContent="center" alignItems="center" height="200px">
            <Spinner size="lg" />
          </Flex>
        ) : apiResponse?.error ? (
          <Alert status="error" borderRadius="md">
            <AlertIcon />
            {apiResponse.error}
          </Alert>
        ) : (
          <>
            {/* Recommended Action Box or Warning Alert */}
            {recommendedAction === 'ALLOW' ? (
              <Box bg="green.500" p={4} borderRadius="md" mb={4} width="100%">
                <Flex alignItems="center">
                  <CheckIcon color="green.500" boxSize={6} mr={2} />
                  <Text fontSize="lg" fontWeight="bold">
                    ALLOW
                  </Text>
                </Flex>
              </Box>
            ) : hasAlerts ? (
              <Alert status="warning" mb={4} borderRadius="md">
                <AlertIcon />
                Warning: Potential issues detected.
              </Alert>
            ) : null}

            {apiResponse ? (
              <VStack align="start" spacing={4}>
                {/* Summary Section */}
                {apiResponse.summary && typeof apiResponse.summary === 'string' && (
                  <Card width="100%" shadow="sm" borderWidth="1px">
                    <CardBody>{renderSummary(apiResponse.summary)}</CardBody>
                  </Card>
                )}

                {/*/!* Address Details Section *!/*/}
                {/*{apiResponse.addressDetails && (*/}
                {/*    <Card width="100%" shadow="sm" borderWidth="1px">*/}
                {/*        <CardHeader>*/}
                {/*            <Heading as="h6" size="md">*/}
                {/*                Address Details*/}
                {/*            </Heading>*/}
                {/*        </CardHeader>*/}
                {/*        <CardBody>*/}
                {/*            {renderResponseFields(apiResponse.addressDetails)}*/}
                {/*        </CardBody>*/}
                {/*    </Card>*/}
                {/*)}*/}

                {/* Tags Section */}
                {apiResponse.addressDetails?.tags && (
                  <Card width="100%" shadow="sm" borderWidth="1px">
                    <CardHeader>
                      <Heading as="h6" size="md">
                        Tags
                      </Heading>
                    </CardHeader>
                    <CardBody>
                      <Table variant="simple">
                        <Thead>
                          <Tr>
                            <Th>Tag</Th>
                            <Th>Status</Th>
                          </Tr>
                        </Thead>
                        <Tbody>
                          {Object.entries(apiResponse.addressDetails.tags).map(([tag, status]) => (
                            <Tr key={tag}>
                              <Td textTransform="capitalize">{tag}</Td>
                              <Td>
                                {status ? <Badge colorScheme="red">Yes</Badge> : <Badge colorScheme="green">No</Badge>}
                              </Td>
                            </Tr>
                          ))}
                        </Tbody>
                      </Table>
                    </CardBody>
                  </Card>
                )}
              </VStack>
            ) : (
              <Text>No data available.</Text>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
