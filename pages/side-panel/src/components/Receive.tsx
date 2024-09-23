import {
  Avatar,
  Box,
  Button,
  Flex,
  Text,
  Badge,
  Table,
  Tbody,
  Tr,
  Td,
  Select,
  Spinner,
  VStack,
  HStack,
  useToast,
} from '@chakra-ui/react';
import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode'; // Import the QRCode library

export function Receive({ onClose }: { onClose: () => void }) {
  const [walletType, setWalletType] = useState('');
  const [selectedAddress, setSelectedAddress] = useState('');
  const [pubkeys, setPubkeys] = useState<any[]>([]);
  const [assetContext, setAssetContext] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [hasCopied, setHasCopied] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null); // State for QR code image
  const toast = useToast();

  // Fetch asset context and pubkeys from the backend (extension)
  useEffect(() => {
    const fetchAssetContextAndPubkeys = () => {
      setLoading(true);

      chrome.runtime.sendMessage({ type: 'GET_ASSET_CONTEXT' }, response => {
        if (chrome.runtime.lastError) {
          console.error('Error fetching asset context:', chrome.runtime.lastError.message);
          setLoading(false);
          return;
        }
        if (response && response.assets) {
          setAssetContext(response.assets);
          setPubkeys(response.assets.pubkeys || []);
          if (response.assets.pubkeys && response.assets.pubkeys.length > 0) {
            const initialAddress = response.assets.pubkeys[0].address || response.assets.pubkeys[0].master;
            setSelectedAddress(initialAddress);
            generateQrCode(initialAddress); // Generate QR code for the initial address
          }
        }
        setLoading(false);
      });
    };

    fetchAssetContextAndPubkeys();
  }, []);

  const handleAddressChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const address = event.target.value;
    setSelectedAddress(address);
    generateQrCode(address); // Generate QR code for the selected address
  };

  // Copy to clipboard function
  const copyToClipboard = () => {
    if (selectedAddress) {
      navigator.clipboard.writeText(selectedAddress).then(() => {
        setHasCopied(true);
        toast({
          title: 'Address copied!',
          status: 'success',
          duration: 2000,
          isClosable: true,
        });
        setTimeout(() => setHasCopied(false), 2000); // Reset the copied status after 2 seconds
      });
    }
  };

  // Generate QR code using the QRCode library
  const generateQrCode = (text: string) => {
    QRCode.toDataURL(text, { width: 150, margin: 2 }, (err, url) => {
      if (err) {
        console.error('Error generating QR code:', err);
        return;
      }
      setQrCodeDataUrl(url);
    });
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
    <VStack spacing={6} align="center">
      {/* Avatar and Title */}
      <Avatar size="xl" src={assetContext?.icon} />
      <Text fontSize="xl" fontWeight="bold" textAlign="center">
        Receive {assetContext?.name}
      </Text>

      {/* Chain and Address Selector */}
      <Table variant="simple">
        <Tbody>
          <Tr>
            <Td>
              <Text fontWeight="bold">Chain</Text>
            </Td>
            <Td>
              <Badge>{assetContext?.chain}</Badge>
            </Td>
          </Tr>
          <Tr>
            <Td>
              <Text fontWeight="bold">Address</Text>
            </Td>
            <Td>
              <Select value={selectedAddress} onChange={handleAddressChange}>
                {pubkeys.map((pubkey, index) => (
                  <option key={index} value={pubkey.address || pubkey.master}>
                    {pubkey.address || pubkey.master}
                  </option>
                ))}
              </Select>
            </Td>
          </Tr>
        </Tbody>
      </Table>

      {/* Address Display Box */}
      {selectedAddress && (
        <>
          <Box p={4} borderRadius="md" border="1px solid" borderColor="gray.300" width="full" textAlign="center">
            <Text wordBreak="break-all" fontSize="sm">
              {selectedAddress}
            </Text>
          </Box>

          {/* QR Code */}
          <Box mt={4}>
            {qrCodeDataUrl ? <img src={qrCodeDataUrl} alt="QR Code" style={{ margin: 'auto' }} /> : <Spinner />}
          </Box>

          {/* Copy Button */}
          <HStack spacing={4} mt={4}>
            <Button colorScheme="blue" onClick={copyToClipboard}>
              {hasCopied ? 'Copied' : 'Copy Address'}
            </Button>
          </HStack>
        </>
      )}
    </VStack>
  );
}

export default Receive;
