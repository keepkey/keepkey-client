import { useState, useEffect } from 'react';
import { Box, Divider, Flex, Table, Tbody, Tr, Td, Badge, Switch, Text, HStack } from '@chakra-ui/react';
import React, { Fragment } from 'react';

// Function to request asset context from background script
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

export default function RequestDetailsCard({ transaction }: any) {
  const [price, setPrice] = useState<number | null>(null);
  const [isNative, setIsNative] = useState(true); // Toggle for hex/native
  const [usdValue, setUsdValue] = useState<string>('');

  useEffect(() => {
    // Request the asset context from the background script
    requestAssetContext()
      .then((assetContext: any) => {
        console.log('assetContext: ', assetContext);
        setPrice(assetContext?.assets?.priceUsd); // Assume priceUsd is the key for USD price
      })
      .catch(err => console.error(err));
  }, []);

  // Function to format ETH to USD value
  const formatUsd = (ethValue: string, price: number) => {
    const usd = parseFloat(ethValue) * price;
    return usd.toFixed(2); // Format to 2 decimals
  };

  const toggleHexNative = () => {
    setIsNative(!isNative);
  };

  const ethValue = transaction.request.value; // Assume this is in hex
  const nativeValue = parseFloat(parseInt(ethValue, 16).toString()) / 1e18; // Convert from wei to ETH

  return (
    <Fragment>
      <Flex direction="column" mb={4}>
        <Box mb={2}>
          <Table variant="simple" size="sm">
            <Tbody>
              <Tr>
                <Td>
                  <Badge>from:</Badge>
                </Td>
                <Td>{transaction?.request?.from}</Td>
              </Tr>
              <Tr>
                <Td>
                  <Badge>to:</Badge>
                </Td>
                <Td>{transaction?.request?.to}</Td>
              </Tr>
              <Tr>
                <Td>
                  <Badge>value:</Badge>
                </Td>
                <Td>
                  {isNative ? `${nativeValue} ETH` : `${transaction?.request?.value} (Hex)`}

                  {price && isNative && (
                    <Text fontSize="sm" color="gray.500">
                      ≈ ${formatUsd(nativeValue.toString(), price)} USD
                    </Text>
                  )}
                </Td>
              </Tr>
              <Tr>
                <Td>
                  <Badge>data:</Badge>
                </Td>
                <Td>{transaction?.request?.data}</Td>
              </Tr>
            </Tbody>
          </Table>
          <HStack mt={4}>
            <Text>Show as Hex</Text>
            <Switch onChange={toggleHexNative} isChecked={!isNative} />
          </HStack>
        </Box>
        <Divider my={2} />
      </Flex>
    </Fragment>
  );
}
