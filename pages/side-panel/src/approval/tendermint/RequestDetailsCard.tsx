import { useState, useEffect } from 'react';
import { Box, Divider, Flex, Table, Tbody, Tr, Td, Badge, Avatar, Thead, Th } from '@chakra-ui/react';

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

  // Extract necessary transaction details
  const signDoc = transaction?.unsignedTx?.signDoc || {};
  const { fee, memo, msgs, account_number, chain_id, sequence } = signDoc;
  const message = msgs?.[0]?.value || {}; // Assuming single message for simplicity

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
            <Thead>
              <Tr>
                <Th>Parameter</Th>
                <Th>Value</Th>
              </Tr>
            </Thead>
            <Tbody>
              <Tr>
                <Td>
                  <Badge>Account Number:</Badge>
                </Td>
                <Td>{account_number || 'N/A'}</Td>
              </Tr>
              <Tr>
                <Td>
                  <Badge>Chain ID:</Badge>
                </Td>
                <Td>{chain_id || 'N/A'}</Td>
              </Tr>
              {/*<Tr>*/}
              {/*  <Td>*/}
              {/*    <Badge>Gas:</Badge>*/}
              {/*  </Td>*/}
              {/*  <Td>{fee?.gas || 'N/A'}</Td>*/}
              {/*</Tr>*/}
              {/*<Tr>*/}
              {/*  <Td>*/}
              {/*    <Badge>Fee Amount:</Badge>*/}
              {/*  </Td>*/}
              {/*  <Td>*/}
              {/*    {fee?.amount?.map((amt, index) => (*/}
              {/*      <span key={index}>*/}
              {/*        {amt.amount} {amt.denom}*/}
              {/*      </span>*/}
              {/*    )) || 'N/A'}*/}
              {/*  </Td>*/}
              {/*</Tr>*/}
              <Tr>
                <Td>
                  <Badge>Sequence:</Badge>
                </Td>
                <Td>{sequence || 'N/A'}</Td>
              </Tr>
              <Tr>
                <Td>
                  <Badge>From Address:</Badge>
                </Td>
                <Td>{message.from_address || 'N/A'}</Td>
              </Tr>
              <Tr>
                <Td>
                  <Badge>To Address:</Badge>
                </Td>
                <Td>{message.to_address || 'N/A'}</Td>
              </Tr>
              <Tr>
                <Td>
                  <Badge>Amount:</Badge>
                </Td>
                <Td>
                  {message.amount?.map((amt, index) => (
                    <span key={index}>
                      {(amt.amount / 100000000).toLocaleString('en', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 6,
                      })}{' '}
                      {amt.denom}
                    </span>
                  )) || 'N/A'}
                </Td>
              </Tr>
              <Tr>
                <Td>
                  <Badge>Memo:</Badge>
                </Td>
                <Td>{memo || 'None'}</Td>
              </Tr>
            </Tbody>
          </Table>
        </Box>
        <Divider my={2} />
      </Flex>
    </div>
  );
}
