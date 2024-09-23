import { Avatar, Box, Button, Flex, Text, Badge, Table, Tbody, Tr, Td, Select, Spinner } from '@chakra-ui/react';
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
    <div>
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
            <Td>Address</Td>
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

      {selectedAddress && (
        <>
          <Box my={4} textAlign="center">
            <Text wordBreak="break-all" fontSize="sm">
              {selectedAddress}
            </Text>
            <Box mt={2}>{qrCodeDataUrl ? <img src={qrCodeDataUrl} alt="QR Code" /> : <Spinner />}</Box>
          </Box>

          <Flex align="center" justify="center" my={4}>
            <Button onClick={copyToClipboard} mx={2}>
              {hasCopied ? 'Copied' : 'Copy Address'}
            </Button>
          </Flex>
        </>
      )}
    </div>
  );
}

export default Receive;
