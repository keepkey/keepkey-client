import { Badge, Box, Divider, Flex, HStack, Switch, Table, Tbody, Td, Text, Textarea, Tr } from '@chakra-ui/react';
import React, { useState, useEffect } from 'react';

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

export default function LegacyTx({ transaction }: any) {
  const [isNative, setIsNative] = useState(true);
  const [asset, setAsset] = useState<any>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [valueUsd, setValueUsd] = useState<string | null>(null);

  // Fetch asset context on mount
  useEffect(() => {
    requestAssetContext()
      .then((response: any) => {
        console.log('Full response:', response);
        const retrievedAsset = response?.assets || {};
        setAsset(retrievedAsset);

        if (retrievedAsset?.priceUsd) {
          const parsedPrice = parseFloat(retrievedAsset.priceUsd);
          setPrice(parsedPrice);
        }
      })
      .catch(err => {
        console.error('Error fetching asset context:', err);
      });
  }, []);

  const toggleHexNative = () => setIsNative(prev => !prev);

  // Calculate native value from the hex value in the transaction
  const ethValueHex = transaction?.unsignedTx?.value || '0x0';
  const nativeValue = parseFloat(parseInt(ethValueHex, 16).toString()) / 1e18;

  // Whenever price or nativeValue changes, recalculate the USD value
  useEffect(() => {
    if (price !== null && !isNaN(nativeValue)) {
      const usd = (price * nativeValue).toFixed(2);
      setValueUsd(usd);
      console.log('Price updated:', price, 'Native Value:', nativeValue, 'USD:', usd);
    }
  }, [price, nativeValue]);

  return (
    <Flex direction="column" mb={4}>
      <Box mb={2}>
        <Table variant="simple" size="sm">
          <Tbody>
            <Tr>
              <Td>
                <Badge>chainid:</Badge>
              </Td>
              <Td>{transaction?.unsignedTx?.chainId}</Td>
            </Tr>
            <Tr>
              <Td>
                <Badge>recipient:</Badge>
              </Td>
              <Td>{transaction?.unsignedTx?.to}</Td>
            </Tr>
            <Tr>
              <Td>
                <Badge>value:</Badge>
              </Td>
              <Td>
                {isNative ? `${nativeValue} ETH` : `${ethValueHex} (Hex)`}

                {/* If price and isNative are set, display equivalent USD */}
                <Text fontSize="sm">≈ ${valueUsd} USD</Text>
              </Td>
            </Tr>
            <Tr>
              <Td>
                <Badge>data:</Badge>
              </Td>
              <Td>
                <Textarea
                  value={transaction?.unsignedTx?.data || 'No data provided'}
                  isReadOnly
                  size="sm"
                  resize="vertical"
                  minHeight="100px"
                  cursor="default"
                  _focus={{ boxShadow: 'none' }}
                />
              </Td>
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
  );
}
