import { useState, useEffect } from 'react';
import { Box, Divider, Flex, VStack, HStack, Text, Badge, Avatar, StackDivider } from '@chakra-ui/react';

export default function RequestDetailsCard({ transaction }: any) {
  const [isNative, setIsNative] = useState(true); // Toggle for hex/native
  const [assetContext, setAssetContext] = useState<any>(null);

  // Function to get asset context
  const requestAssetContext = () => {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'GET_ASSET_CONTEXT' }, response => {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError);
        }
        resolve(response);
      });
    });
  };

  // Fetch the asset context on component mount
  useEffect(() => {
    const fetchAssetContext = async () => {
      try {
        const context: any = await requestAssetContext();
        setAssetContext(context);
      } catch (error) {
        console.error('Failed to get asset context:', error);
      }
    };

    fetchAssetContext();
  }, []);

  // Safely handle cases where transaction might be undefined
  const inputs = transaction?.unsignedTx?.inputs || [];
  const outputs = transaction?.unsignedTx?.outputs || [];
  const memo = transaction?.unsignedTx?.memo || 'none';

  // Calculate totals
  const totalInput = inputs.reduce((sum: number, input: any) => sum + Number(input.amount), 0);
  const totalOutput = outputs.reduce((sum: number, output: any) => sum + Number(output.amount), 0);
  const fee = totalInput - totalOutput;

  return (
    <VStack spacing={4} align="stretch" width="100%" maxW="300px" mx="auto" p={4} borderRadius="lg" boxShadow="md">
      {/* Asset Icon */}
      {assetContext && (
        <Flex justify="center">
          <Avatar size="lg" src={assetContext?.assets?.icon} alt="Asset Icon" />
        </Flex>
      )}

      {/* Memo */}
      <Box textAlign="center">
        <Badge colorScheme="blue" variant="outline" fontSize="0.8em" mb={1}>
          Memo
        </Badge>
        <Text fontSize="sm" fontWeight="medium" wordBreak="break-word">
          {memo}
        </Text>
      </Box>

      <Divider />

      {/* Inputs Section */}
      {inputs.length > 0 && (
        <VStack spacing={3} align="stretch">
          <Text fontSize="sm" fontWeight="bold">
            Inputs {inputs.length}
          </Text>
          <VStack spacing={2} align="stretch" divider={<StackDivider borderColor="gray.200" />}>
            {inputs.map((input: any, index: number) => (
              <Box key={index}>
                <VStack align="stretch" spacing={1}>
                  <HStack justify="space-between">
                    <Badge colorScheme="teal">TXID</Badge>
                    <Text fontSize="xs" wordBreak="break-all">
                      {input.txid}
                    </Text>
                  </HStack>
                {/*  <HStack justify="space-between">*/}
                {/*    <Badge colorScheme="green">Amount</Badge>*/}
                {/*    <Text fontSize="sm" fontWeight="medium">*/}
                {/*      {Number(input.amount)}*/}
                {/*    </Text>*/}
                {/*  </HStack>*/}
                </VStack>
              </Box>
            ))}
          </VStack>
        </VStack>
      )}

      {/* Outputs Section */}
      {outputs.length > 0 && (
        <VStack spacing={3} align="stretch">
          <Text fontSize="sm" fontWeight="bold">
            Outputs
          </Text>
          <VStack spacing={2} align="stretch" divider={<StackDivider borderColor="gray.200" />}>
            {outputs.map((output: any, index: number) => (
              <Box key={index}>
                <VStack align="stretch" spacing={1}>
                  <HStack justify="space-between">
                    <Badge colorScheme={output.isChange ? 'purple' : 'orange'}>
                      {output.isChange ? 'Change to' : 'To'}
                    </Badge>
                    <Text fontSize="xs" wordBreak="break-all">
                      {output.address || 'N/A'}
                    </Text>
                  </HStack>
                  <HStack justify="space-between">
                    <Badge colorScheme="green">Amount</Badge>
                    <Text fontSize="sm" fontWeight="medium">
                      {output.amount / 100000000}
                    </Text>
                  </HStack>
                </VStack>
              </Box>
            ))}
          </VStack>
        </VStack>
      )}

      <Divider />

      {/* Totals Section */}
      <VStack spacing={2} align="stretch">
        <HStack justify="space-between">
          <Text fontSize="sm" fontWeight="semibold">
            Total Input
          </Text>
          <Text fontSize="sm" fontWeight="medium">
            {totalInput / 100000000}
          </Text>
        </HStack>
        <HStack justify="space-between">
          <Text fontSize="sm" fontWeight="semibold">
            Total Output
          </Text>
          <Text fontSize="sm" fontWeight="medium">
            {totalOutput / 100000000}
          </Text>
        </HStack>
        <HStack justify="space-between">
          <Text fontSize="sm" fontWeight="semibold">
            Fee (Difference)
          </Text>
          <Text fontSize="sm" fontWeight="medium">
            {fee / 100000000}
          </Text>
        </HStack>
      </VStack>
    </VStack>
  );
}
