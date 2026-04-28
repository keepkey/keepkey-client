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
import React, { useEffect, useState } from 'react';
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
  // UTXO pubkeys carry an xpub in `.pubkey` and an empty `.address`. We
  // derive a real receive address per account and key them by `note`
  // (which is unique per path config) so the dropdown can render real
  // addresses and the switch handler can look up by pubkey identity
  // instead of address string.
  const [addressByNote, setAddressByNote] = useState<Record<string, string>>({});
  const toast = useToast();

  const isUtxoNetwork = (networkId?: string) => !!networkId?.startsWith('bip122:');

  const addressForPubkey = (pk: any): string => {
    if (!pk) return '';
    if (pk.note && addressByNote[pk.note]) return addressByNote[pk.note];
    return pk.address || pk.master || '';
  };

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
        const ctxAsset = response?.assets;
        if (ctxAsset) {
          setAssetContext(ctxAsset);
          setPubkeys(ctxAsset.pubkeys || []);
        }
        setLoading(false);

        // UTXO chains have no plain .address on the pubkey (the batch
        // endpoint returns { pubkey: xpub, address: '' }). Derive a real
        // receive address per account so the dropdown can show actual
        // addresses and the switch handler has something to look up.
        if (isUtxoNetwork(ctxAsset?.networkId) && ctxAsset?.networkId) {
          const allPks = (ctxAsset.pubkeys || []) as any[];
          allPks.forEach((pk, idx) => {
            if (!pk?.note) return;
            chrome.runtime.sendMessage(
              {
                type: 'GET_UTXO_ADDRESS',
                networkId: ctxAsset.networkId,
                scriptType: pk.scriptType,
                note: pk.note,
              },
              utxoResp => {
                if (!utxoResp?.address) return;
                setAddressByNote(prev => ({ ...prev, [pk.note]: utxoResp.address }));
                if (idx === 0) setSelectedAddress(utxoResp.address);
              },
            );
          });
        }
      });

      // Non-UTXO: pick the scoped pubkey's address directly
      chrome.runtime.sendMessage({ type: 'GET_PUBKEY_CONTEXT' }, response => {
        if (chrome.runtime.lastError) {
          console.error('Error fetching pubkey context:', chrome.runtime.lastError.message);
          return;
        }
        const pc = response?.pubkeyContext;
        if (pc) {
          setPubkeyContext(pc);
          // .address is the populated field for account-based chains.
          // .master was the legacy xpub field; .pubkey is the new field
          // name (UTXO). We intentionally skip UTXO values here — the
          // utxoGetAddress branch above handles those.
          const isUtxo = pc.type === 'xpub' || pc.type === 'zpub' || !pc.address;
          if (!isUtxo && pc.address) {
            setSelectedAddress(pc.address);
          }
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

  const handleAccountSelect = (pubkey: any, index: number) => {
    if (!pubkey) return;
    chrome.runtime.sendMessage({ type: 'SET_PUBKEY_CONTEXT', pubkey }, response => {
      if (response?.success) {
        setPubkeyContext(response.pubkeyContext);
        const resolved = addressForPubkey(pubkey);
        if (resolved) {
          setSelectedAddress(resolved);
        } else if (isUtxoNetwork(assetContext?.networkId) && assetContext?.networkId && pubkey.note) {
          // Address wasn't pre-derived (e.g. batch derive still in flight) —
          // fetch it on demand. Cache so a later render picks it up too.
          chrome.runtime.sendMessage(
            {
              type: 'GET_UTXO_ADDRESS',
              networkId: assetContext.networkId,
              scriptType: pubkey.scriptType,
              note: pubkey.note,
            },
            utxoResp => {
              if (utxoResp?.address) {
                setAddressByNote(prev => ({ ...prev, [pubkey.note]: utxoResp.address }));
                setSelectedAddress(utxoResp.address);
              }
            },
          );
        }
        toast({
          title: 'Account switched',
          description: `Now using ${getAddressType(pubkey, index)}`,
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

  const SCRIPT_TYPE_LABELS: Record<string, string> = {
    p2pkh: 'Legacy',
    'p2sh-p2wpkh': 'Segwit',
    p2wpkh: 'Native Segwit',
    p2tr: 'Taproot',
  };

  // Build a label like "Account 0 · Native Segwit" so multiple pubkeys for
  // the same account (BTC has up to 3 — legacy / segwit / native segwit)
  // don't all read as bare "Account 0".
  const getAddressType = (pubkey: any, index: number) => {
    if (!pubkey) return `Account ${index}`;

    let accountNum: number | string | null = null;
    if (pubkey.note) {
      const match = pubkey.note.match(/account\s*(\d+)/i);
      if (match) accountNum = match[1];
    }
    if (accountNum === null && Array.isArray(pubkey.addressNList) && pubkey.addressNList.length >= 3) {
      // 3rd segment is the account index, hardened (≥ 0x80000000) for UTXO.
      const seg = pubkey.addressNList[2];
      accountNum = typeof seg === 'number' ? (seg >= 0x80000000 ? seg - 0x80000000 : seg) : null;
    }
    if (accountNum === null) accountNum = index;

    const stLabel = pubkey.scriptType ? SCRIPT_TYPE_LABELS[pubkey.scriptType.toLowerCase()] : null;
    return stLabel ? `Account ${accountNum} · ${stLabel}` : `Account ${accountNum}`;
  };

  if (loading) {
    return (
      <Flex align="center" justify="center" minHeight="200px">
        <Spinner size="lg" color="kk.accent" />
      </Flex>
    );
  }

  if (!assetContext) {
    return (
      <Flex align="center" justify="center" minHeight="200px">
        <Text color="kk.faint">No asset context available</Text>
      </Flex>
    );
  }

  // Handle token selection from dropdown. Same accountIndex-preserve
  // rule as Tokens.tsx — without it the receive QR can silently revert
  // to account 0 after a token switch inside the drawer.
  const handleTokenSelect = (token: any) => {
    setLoading(true);
    const merged = { ...token, accountIndex: token.accountIndex ?? assetContext?.accountIndex };
    chrome.runtime.sendMessage({ type: 'SET_ASSET_CONTEXT', asset: merged }, () => {
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
    <VStack spacing={4} align="center" justify="center" p={4} h="full">
      {/* Token Selector — dedup by CAIP so tokens that share a ticker but
          live on different chains (or different contracts within the same
          chain) don't collapse. Deduping by `symbol` alone let e.g. bridged
          vs native USDC collapse into one entry and could land a user on a
          QR for the wrong asset. CAIP is the canonical unique ID; if it's
          absent we fall back to `${networkId}|${contract}|${symbol}` so
          incomplete entries still get distinct keys. */}
      {balances.length > 0 &&
        (() => {
          const keyFor = (t: any): string =>
            t.caip || `${t.networkId || ''}|${t.contractAddress || ''}|${t.symbol || ''}`;
          const seen = new Set<string>();
          const uniqueTokens = balances.reduce((acc: any[], token) => {
            const k = keyFor(token);
            if (!seen.has(k)) {
              seen.add(k);
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
                  bg="kk.surface"
                  color="kk.text"
                  border="1px solid"
                  borderColor="kk.line"
                  _hover={{ bg: 'kk.surfaceHi' }}
                  _active={{ bg: 'kk.surfaceHi' }}
                  borderRadius="12px"
                  py={5}
                  fontWeight={500}>
                  <HStack spacing={3} justify="center">
                    <Avatar size="sm" src={assetContext?.icon} />
                    <Text fontWeight={600}>{assetContext?.name}</Text>
                    <Badge
                      bg="whiteAlpha.100"
                      color="kk.faint"
                      fontSize="10px"
                      borderRadius="full"
                      px={2}
                      textTransform="uppercase"
                      letterSpacing="0.04em">
                      {assetContext?.symbol}
                    </Badge>
                  </HStack>
                </MenuButton>
                <MenuList bg="kk.surfaceHi" borderColor="kk.lineHi" maxH="300px" overflowY="auto">
                  {uniqueTokens.map((token, index) => (
                    <MenuItem
                      key={index}
                      onClick={() => handleTokenSelect(token)}
                      bg={assetContext?.symbol === token.symbol ? 'whiteAlpha.100' : 'transparent'}
                      _hover={{ bg: 'whiteAlpha.100' }}>
                      <HStack spacing={3}>
                        <Avatar size="sm" src={token.icon} />
                        <VStack align="start" spacing={0}>
                          <Text fontWeight={500} color="kk.text">
                            {token.name}
                          </Text>
                          <Text fontSize="xs" color="kk.faint">
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
      <Box w="full" bg="kk.surface" border="1px solid" borderColor="kk.line" borderRadius="12px" p={4}>
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
                  <Text className="kk-eyebrow" mb={1}>
                    {getAddressType(
                      pubkeys.find(p => addressForPubkey(p) === selectedAddress) || pubkeys[0],
                      pubkeys.findIndex(p => addressForPubkey(p) === selectedAddress),
                    )}
                  </Text>
                  <Text className="mono" fontSize="sm" color="kk.text" wordBreak="break-all">
                    {selectedAddress}
                  </Text>
                </Box>
                {pubkeys.length > 1 && <ChevronDownIcon color="kk.dim" boxSize={5} ml={2} />}
              </Flex>
            </MenuButton>
            {pubkeys.length > 1 && (
              <MenuList bg="kk.surfaceHi" borderColor="kk.lineHi">
                {pubkeys.map((pubkey, index) => {
                  const addr = addressForPubkey(pubkey);
                  return (
                    <MenuItem
                      key={pubkey.note || index}
                      onClick={() => handleAccountSelect(pubkey, index)}
                      bg={selectedAddress && selectedAddress === addr ? 'whiteAlpha.100' : 'transparent'}
                      _hover={{ bg: 'whiteAlpha.100' }}>
                      <VStack align="start" spacing={0}>
                        <Text fontSize="xs" color="kk.faint">
                          {getAddressType(pubkey, index)}
                        </Text>
                        <Text className="mono" fontSize="sm" color="kk.text">
                          {addr ? formatAddress(addr) : '…'}
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
            color={hasCopied ? 'kk.good' : 'kk.dim'}
            size="lg"
            onClick={copyToClipboard}
            ml={2}
          />
        </Flex>
      </Box>

      {/* Warning */}
      <Text fontSize="xs" color="kk.faint" textAlign="center">
        Only send {assetContext?.symbol} to this address. Sending other assets may result in permanent loss.
      </Text>
    </VStack>
  );
}

export default Receive;
