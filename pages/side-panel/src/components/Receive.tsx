import {
  Avatar,
  Box,
  Button,
  Flex,
  Text,
  Badge,
  useClipboard,
  Table,
  Tbody,
  Tr,
  Td,
  Select,
  Spinner,
} from '@chakra-ui/react';
// import QRCode from "qrcode.react";
import React, { useEffect, useState } from 'react';

export function Receive({ onClose }: any) {
  const [walletType, setWalletType] = useState('');
  const [selectedAddress, setSelectedAddress] = useState('');
  const [pubkeys, setPubkeys] = useState<any[]>([]);
  const [assetContext, setAssetContext] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const { hasCopied, onCopy } = useClipboard(selectedAddress);

  // Fetch asset context and pubkeys from the backend (extension)
  useEffect(() => {
    const fetchAssetContextAndPubkeys = () => {
      setLoading(true);

      // Fetch asset context
      chrome.runtime.sendMessage({ type: 'GET_ASSET_CONTEXT' }, response => {
        if (chrome.runtime.lastError) {
          console.error('Error fetching asset context:', chrome.runtime.lastError.message);
          setLoading(false);
          return;
        }
        if (response && response.assetContext) {
          setAssetContext(response.assetContext);
        }
      });

      // Fetch pubkeys
      chrome.runtime.sendMessage({ type: 'GET_PUBKEYS' }, response => {
        if (chrome.runtime.lastError) {
          console.error('Error fetching pubkeys:', chrome.runtime.lastError.message);
          setLoading(false);
          return;
        }
        if (response && response.pubkeys) {
          setPubkeys(response.pubkeys);
          // Automatically select the first address on load
          if (response.pubkeys.length > 0) {
            setSelectedAddress(response.pubkeys[0].address || response.pubkeys[0].master);
          }
        }
        setLoading(false);
      });
    };

    fetchAssetContextAndPubkeys();
  }, []);

  const handleAddressChange = (event: any) => {
    setSelectedAddress(event.target.value);
  };

  if (loading) {
    return (
      <Flex align="center" justify="center" minHeight="200px">
        <Spinner size="lg" />
      </Flex>
    );
  }

  if (!assetContext) {
    return (
      <Flex align="center" justify="center" minHeight="200px">
        <Text>No asset context available</Text>
      </Flex>
    );
  }

  return (
    <Box border="1px" borderColor="white" p={4}>
      <Flex align="center" justify="center" mb={4}>
        <Avatar size="xl" src={assetContext?.icon} />
      </Flex>

      <Text fontSize="xl" fontWeight="bold" textAlign="center">
        Receive {assetContext?.name}
      </Text>

      <Table variant="simple" mt={4}>
        <Tbody>
          <Tr>
            <Td>Chain</Td>
            <Td>
              <Badge>{assetContext?.chain}</Badge>
            </Td>
          </Tr>
          <Tr>
            <Td>CAIP</Td>
            <Td>{assetContext?.caip}</Td>
          </Tr>
          <Tr>
            <Td>Address</Td>
            <Td>
              <Select value={selectedAddress} onChange={handleAddressChange}>
                {pubkeys.map((pubkey: any, index: any) => (
                  <option key={index} value={pubkey.address || pubkey.master}>
                    {pubkey.address || pubkey.master}
                  </option>
                ))}
              </Select>
            </Td>
          </Tr>
        </Tbody>
      </Table>

      {selectedAddress && <Flex align="center" justify="center" my={4}></Flex>}

      <Flex align="center" justify="center" my={4}>
        <Button onClick={onCopy} mx={2}>
          {hasCopied ? 'Copied' : 'Copy Address'}
        </Button>
      </Flex>
    </Box>
  );
}

export default Receive;
