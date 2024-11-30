import { useState, useEffect } from 'react';
import { Box, Divider, Flex, Table, Tbody, Tr, Td, Badge, Avatar } from '@chakra-ui/react';

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

  return (
    <div>
      <Flex direction="column" mb={4}>
        {/* Display the Avatar for the asset */}
        {assetContext && (
          <Flex justify="center" mb={4}>
            <Avatar size="md" src={assetContext?.assets?.icon} alt="Asset Icon" />
          </Flex>
        )}
        <Box mb={2}>
          <Table variant="simple" size="sm">
            <Tbody>
              <Tr>
                <Td>
                  <Badge>To:</Badge>
                </Td>
                {/*<Td>{transaction?.request?.recipient || 'N/A'}</Td>*/}
              </Tr>
              <Tr>
                <Td>
                  <Badge>Amount:</Badge>
                </Td>
                {/*<Td>{transaction?.request?.amount.amount || 'N/A'}</Td>*/}
              </Tr>
              <Tr>
                <Td>
                  <Badge>Memo:</Badge>
                </Td>
                {/*<Td>{transaction?.unsignedTx.memo || 'none'}</Td>*/}
              </Tr>
            </Tbody>
          </Table>
        </Box>
        <Divider my={2} />
      </Flex>
    </div>
  );
}
