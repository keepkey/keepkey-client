import {
  Badge,
  Box,
  Divider,
  Flex,
  HStack,
  Link,
  Switch,
  Table,
  Tbody,
  Td,
  Text,
  Textarea,
  Tr,
} from '@chakra-ui/react';
import { ExternalLinkIcon } from '@chakra-ui/icons';
import React, { useState, useEffect } from 'react';
import { getExplorerAddressUrl } from '@extension/shared/lib/utils/explorerUrls';

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
  let nativeValue = 0;
  try {
    nativeValue = parseFloat(parseInt(ethValueHex, 16).toString()) / 1e18;
  } catch (e) {
    console.error('Error parsing value:', e);
    nativeValue = 0;
  }

  // Whenever price or nativeValue changes, recalculate the USD value
  useEffect(() => {
    if (price !== null && !isNaN(nativeValue) && nativeValue > 0) {
      const usd = (price * nativeValue).toFixed(2);
      setValueUsd(usd);
      console.log('Price updated:', price, 'Native Value:', nativeValue, 'USD:', usd);
    }
  }, [price, nativeValue]);

  return (
    <Flex direction="column" mb={4}>
      <Box mb={2} maxW="100%" overflowX="auto">
        <Table variant="simple" size="sm" wordBreak="break-word">
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
              <Td wordBreak="break-all" fontSize="sm">
                {(() => {
                  const to = transaction?.unsignedTx?.to;
                  const chainId = transaction?.unsignedTx?.chainId;
                  const networkId = chainId ? `eip155:${chainId}` : null;
                  const explorerUrl = networkId && to ? getExplorerAddressUrl(networkId, to) : null;
                  if (explorerUrl) {
                    return (
                      <Link href={explorerUrl} isExternal color="blue.300" _hover={{ color: 'blue.200' }}>
                        {to} <ExternalLinkIcon mx={1} boxSize={3} />
                      </Link>
                    );
                  }
                  return to;
                })()}
              </Td>
            </Tr>
            <Tr>
              <Td>
                <Badge>value:</Badge>
              </Td>
              <Td>
                {isNative ? `${nativeValue} ETH` : `${ethValueHex} (Hex)`}

                {/* If price and isNative are set, display equivalent USD */}
                {valueUsd && <Text fontSize="sm">≈ ${valueUsd} USD</Text>}
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
                  maxHeight="200px"
                  cursor="default"
                  wordBreak="break-all"
                  whiteSpace="pre-wrap"
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
