import {
  Avatar,
  Box,
  Button,
  Flex,
  Text,
  Badge,
  Spinner,
  VStack,
  HStack,
  useToast,
  IconButton,
  Image,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
} from '@chakra-ui/react';
import { CopyIcon, CheckIcon, ChevronDownIcon } from '@chakra-ui/icons';
import React, { useEffect, useState, useRef } from 'react';
import QRCode from 'qrcode';

interface ReceiveProps {
  onClose: () => void;
  balances?: any[];
}

export function Receive({ onClose, balances = [] }: ReceiveProps) {
  const [walletType, setWalletType] = useState('');
  const [selectedAddress, setSelectedAddress] = useState('');
  const [pubkeys, setPubkeys] = useState<any[]>([]);
  const [assetContext, setAssetContext] = useState<any>(null);
  const [pubkeyContext, setPubkeyContext] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [hasCopied, setHasCopied] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const toast = useToast();

  // Fetch asset context, pubkeys, and current pubkey context from the backend (extension)
  useEffect(() => {
    const fetchAssetContextAndPubkeys = () => {
      setLoading(true);

      // Fetch asset context and pubkeys
      chrome.runtime.sendMessage({ type: 'GET_ASSET_CONTEXT' }, response => {
        if (chrome.runtime.lastError) {
          console.error('Error fetching asset context:', chrome.runtime.lastError.message);
          setLoading(false);
          return;
        }
        if (response && response.assets) {
          setAssetContext(response.assets);
          setPubkeys(response.assets.pubkeys || []);
        }
        setLoading(false);
      });

      // Fetch current pubkey context to default to the selected account
      chrome.runtime.sendMessage({ type: 'GET_PUBKEY_CONTEXT' }, response => {
        if (chrome.runtime.lastError) {
          console.error('Error fetching pubkey context:', chrome.runtime.lastError.message);
          return;
        }
        if (response && response.pubkeyContext) {
          setPubkeyContext(response.pubkeyContext);
          const address = response.pubkeyContext.address || response.pubkeyContext.master;
          setSelectedAddress(address);
        }
      });
    };

    fetchAssetContextAndPubkeys();
  }, []);

  // Generate QR code with logo overlay
  useEffect(() => {
    if (selectedAddress && assetContext?.icon) {
      generateQrCodeWithLogo(selectedAddress, assetContext.icon);
    } else if (selectedAddress) {
      generateQrCode(selectedAddress);
    }
  }, [selectedAddress, assetContext?.icon]);

  // Listen for pubkey context updates from other components (like header)
  useEffect(() => {
    const messageListener = (message: any) => {
      if (message.type === 'PUBKEY_CONTEXT_UPDATED' && message.pubkeyContext) {
        setPubkeyContext(message.pubkeyContext);
        const address = message.pubkeyContext.address || message.pubkeyContext.master;
        setSelectedAddress(address);
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);
    return () => chrome.runtime.onMessage.removeListener(messageListener);
  }, []);

  const handleAddressSelect = (address: string) => {
    // Find the pubkey object that matches this address
    const selectedPubkey = pubkeys.find(pk => (pk.address || pk.master) === address);
    if (selectedPubkey) {
      // Update global pubkey context
      chrome.runtime.sendMessage({ type: 'SET_PUBKEY_CONTEXT', pubkey: selectedPubkey }, response => {
        if (response?.success) {
          setPubkeyContext(response.pubkeyContext);
          setSelectedAddress(address);
          toast({
            title: 'Account switched',
            description: `Now using ${getAddressType(selectedPubkey, pubkeys.indexOf(selectedPubkey))}`,
            status: 'success',
            duration: 2000,
            isClosable: true,
          });
        } else if (response?.error) {
          console.error('Error setting pubkey context:', response.error);
          toast({
            title: 'Error switching account',
            description: response.error,
            status: 'error',
            duration: 3000,
            isClosable: true,
          });
        }
      });
    }
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
        setTimeout(() => setHasCopied(false), 2000);
      });
    }
  };

  // Generate QR code without logo
  const generateQrCode = (text: string) => {
    QRCode.toDataURL(
      text,
      {
        width: 200,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      },
      (err, url) => {
        if (err) {
          console.error('Error generating QR code:', err);
          return;
        }
        setQrCodeDataUrl(url);
      },
    );
  };

  // Generate QR code with logo in center
  const generateQrCodeWithLogo = async (text: string, logoUrl: string) => {
    try {
      // First generate the QR code
      const qrDataUrl = await QRCode.toDataURL(text, {
        width: 200,
        margin: 2,
        errorCorrectionLevel: 'H', // High error correction to allow logo overlay
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      });

      // Create canvas to overlay logo
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setQrCodeDataUrl(qrDataUrl);
        return;
      }

      const qrImage = new window.Image();
      qrImage.onload = () => {
        canvas.width = qrImage.width;
        canvas.height = qrImage.height;

        // Draw QR code
        ctx.drawImage(qrImage, 0, 0);

        // Load and draw logo
        const logo = new window.Image();
        logo.crossOrigin = 'anonymous';
        logo.onload = () => {
          const logoSize = qrImage.width * 0.25; // Logo is 25% of QR code
          const logoX = (qrImage.width - logoSize) / 2;
          const logoY = (qrImage.height - logoSize) / 2;

          // Draw white background circle for logo
          ctx.beginPath();
          ctx.arc(qrImage.width / 2, qrImage.height / 2, logoSize / 2 + 4, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();

          // Draw logo
          ctx.save();
          ctx.beginPath();
          ctx.arc(qrImage.width / 2, qrImage.height / 2, logoSize / 2, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(logo, logoX, logoY, logoSize, logoSize);
          ctx.restore();

          setQrCodeDataUrl(canvas.toDataURL());
        };
        logo.onerror = () => {
          // If logo fails to load, just use QR code without logo
          setQrCodeDataUrl(qrDataUrl);
        };
        logo.src = logoUrl;
      };
      qrImage.src = qrDataUrl;
    } catch (err) {
      console.error('Error generating QR code with logo:', err);
      generateQrCode(text);
    }
  };

  // Format address with ellipsis
  const formatAddress = (address: string) => {
    if (!address) return '';
    if (address.length <= 16) return address;
    return `${address.slice(0, 8)}...${address.slice(-8)}`;
  };

  // Get address type label - show Account 0, 1, 2 etc.
  const getAddressType = (pubkey: any, index: number) => {
    // Try to extract account number from note if available
    if (pubkey.note) {
      const match = pubkey.note.match(/account\s*(\d+)/i);
      if (match) {
        return `Account ${match[1]}`;
      }
    }
    // Try to get from addressNList (last element is usually the account index)
    if (pubkey.addressNList && pubkey.addressNList.length > 0) {
      const lastIndex = pubkey.addressNList[pubkey.addressNList.length - 1];
      return `Account ${lastIndex}`;
    }
    // Fallback to index in list
    return `Account ${index}`;
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

  // Handle token selection from dropdown
  const handleTokenSelect = (token: any) => {
    setLoading(true);
    chrome.runtime.sendMessage({ type: 'SET_ASSET_CONTEXT', asset: token }, () => {
      if (chrome.runtime.lastError) {
        console.error('Error setting asset context:', chrome.runtime.lastError.message);
        setLoading(false);
        return;
      }
      // Re-fetch the asset context
      chrome.runtime.sendMessage({ type: 'GET_ASSET_CONTEXT' }, response => {
        if (chrome.runtime.lastError) {
          console.error('Error fetching asset context:', chrome.runtime.lastError.message);
          setLoading(false);
          return;
        }
        if (response && response.assets) {
          setAssetContext(response.assets);
          setPubkeys(response.assets.pubkeys || []);
        }
        setLoading(false);
      });

      // Re-fetch pubkey context (setAssetContext automatically updates pubkeyContext in Pioneer SDK)
      chrome.runtime.sendMessage({ type: 'GET_PUBKEY_CONTEXT' }, response => {
        if (chrome.runtime.lastError) {
          console.error('Error fetching pubkey context:', chrome.runtime.lastError.message);
          return;
        }
        if (response && response.pubkeyContext) {
          setPubkeyContext(response.pubkeyContext);
          const address = response.pubkeyContext.address || response.pubkeyContext.master;
          setSelectedAddress(address);
        }
      });
    });
  };

  return (
    <VStack spacing={4} align="center" p={4} h="full">
      {/* Token Selector - at the very top, deduplicated by symbol */}
      {balances.length > 0 &&
        (() => {
          // Deduplicate tokens by symbol to avoid showing same chain multiple times
          const uniqueTokens = balances.reduce((acc: any[], token) => {
            if (!acc.find(t => t.symbol === token.symbol)) {
              acc.push(token);
            }
            return acc;
          }, []);

          return (
            <Box w="full">
              <Menu>
                <MenuButton
                  as={Button}
                  rightIcon={<ChevronDownIcon />}
                  w="full"
                  bg="whiteAlpha.100"
                  _hover={{ bg: 'whiteAlpha.200' }}
                  _active={{ bg: 'whiteAlpha.200' }}
                  borderRadius="xl"
                  py={6}>
                  <HStack spacing={3} justify="center">
                    <Avatar size="sm" src={assetContext?.icon} />
                    <Text fontWeight="semibold">{assetContext?.name}</Text>
                    <Badge colorScheme="gray" fontSize="xs">
                      {assetContext?.symbol}
                    </Badge>
                  </HStack>
                </MenuButton>
                <MenuList bg="gray.800" borderColor="whiteAlpha.200" maxH="300px" overflowY="auto">
                  {uniqueTokens.map((token, index) => (
                    <MenuItem
                      key={index}
                      onClick={() => handleTokenSelect(token)}
                      bg={assetContext?.symbol === token.symbol ? 'whiteAlpha.200' : 'transparent'}
                      _hover={{ bg: 'whiteAlpha.100' }}>
                      <HStack spacing={3}>
                        <Avatar size="sm" src={token.icon} />
                        <VStack align="start" spacing={0}>
                          <Text fontWeight="medium">{token.name}</Text>
                          <Text fontSize="xs" color="whiteAlpha.600">
                            {token.symbol}
                          </Text>
                        </VStack>
                      </HStack>
                    </MenuItem>
                  ))}
                </MenuList>
              </Menu>
            </Box>
          );
        })()}

      {/* QR Code with Logo */}
      <Box bg="white" p={4} borderRadius="xl" boxShadow="lg">
        {qrCodeDataUrl ? (
          <Image src={qrCodeDataUrl} alt="QR Code" boxSize="200px" />
        ) : (
          <Flex align="center" justify="center" boxSize="200px">
            <Spinner />
          </Flex>
        )}
      </Box>

      {/* Combined Address Display with Selector and Copy */}
      <Box
        w="full"
        bg="rgba(255, 255, 255, 0.05)"
        border="1px solid"
        borderColor="whiteAlpha.200"
        borderRadius="xl"
        p={4}>
        <Flex align="center" justify="space-between">
          {/* Address with optional dropdown */}
          <Menu>
            <MenuButton
              as={Box}
              flex={1}
              cursor={pubkeys.length > 1 ? 'pointer' : 'default'}
              _hover={pubkeys.length > 1 ? { opacity: 0.8 } : {}}>
              <Flex align="center">
                <Box flex={1} overflow="hidden">
                  <Text fontSize="xs" color="whiteAlpha.500" mb={1}>
                    {getAddressType(
                      pubkeys.find(p => (p.address || p.master) === selectedAddress) || pubkeys[0],
                      pubkeys.findIndex(p => (p.address || p.master) === selectedAddress),
                    )}
                  </Text>
                  <Text fontFamily="mono" fontSize="sm" color="white" wordBreak="break-all">
                    {selectedAddress}
                  </Text>
                </Box>
                {pubkeys.length > 1 && <ChevronDownIcon color="whiteAlpha.600" boxSize={5} ml={2} />}
              </Flex>
            </MenuButton>
            {pubkeys.length > 1 && (
              <MenuList bg="gray.800" borderColor="whiteAlpha.200">
                {pubkeys.map((pubkey, index) => {
                  const addr = pubkey.address || pubkey.master;
                  return (
                    <MenuItem
                      key={index}
                      onClick={() => handleAddressSelect(addr)}
                      bg={selectedAddress === addr ? 'whiteAlpha.200' : 'transparent'}
                      _hover={{ bg: 'whiteAlpha.100' }}>
                      <VStack align="start" spacing={0}>
                        <Text fontSize="xs" color="whiteAlpha.600">
                          {getAddressType(pubkey, index)}
                        </Text>
                        <Text fontFamily="mono" fontSize="sm">
                          {formatAddress(addr)}
                        </Text>
                      </VStack>
                    </MenuItem>
                  );
                })}
              </MenuList>
            )}
          </Menu>

          {/* Copy button */}
          <IconButton
            aria-label="Copy address"
            icon={hasCopied ? <CheckIcon /> : <CopyIcon />}
            variant="ghost"
            colorScheme={hasCopied ? 'green' : 'gray'}
            size="lg"
            onClick={copyToClipboard}
            ml={2}
          />
        </Flex>
      </Box>

      {/* Warning */}
      <Text fontSize="xs" color="whiteAlpha.500" textAlign="center">
        Only send {assetContext?.symbol} to this address. Sending other assets may result in permanent loss.
      </Text>
    </VStack>
  );
}

export default Receive;
