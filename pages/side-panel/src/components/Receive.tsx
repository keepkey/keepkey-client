import { Box, Button, Flex, Text, Badge, Spinner, VStack, useToast, IconButton, Image } from '@chakra-ui/react';
import { CopyIcon, CheckIcon, ChevronDownIcon } from '@chakra-ui/icons';
import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import BottomSheet from './v2/BottomSheet';
import { getChainDisplayName } from './chainDisplay';
import { AssetIcon } from './AssetIcon';

interface ReceiveProps {
  onClose: () => void;
  balances?: any[];
}

export function Receive({ onClose, balances = [] }: ReceiveProps) {
  const [walletType, setWalletType] = useState('');
  const [selectedAddress, setSelectedAddress] = useState('');
  const [pubkeys, setPubkeys] = useState<any[]>([]);
  const [isAssetSheetOpen, setIsAssetSheetOpen] = useState(false);
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
          allPks.forEach(pk => {
            if (!pk?.note) return;
            chrome.runtime.sendMessage(
              {
                type: 'GET_UTXO_ADDRESS',
                networkId: ctxAsset.networkId,
                // Raw pubkeys use snake_case `script_type` (matches the
                // path config in chainConfig.ts and the SDK request shape
                // in wallet.ts). Reading `scriptType` here was always
                // undefined → derivation defaulted to p2pkh, so segwit
                // and native-segwit accounts were rendered as legacy
                // addresses.
                scriptType: pk.script_type,
                note: pk.note,
              },
              utxoResp => {
                if (!utxoResp?.address) return;
                setAddressByNote(prev => ({ ...prev, [pk.note]: utxoResp.address }));
                // Don't set selectedAddress here — a separate effect
                // picks the address that matches the current pubkey
                // context (header selection), so we avoid pinning to
                // ctxAsset.pubkeys[0] which is the first configured
                // path, not the user's chosen account.
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

  // Pick the UTXO receive address that matches the current pubkey context
  // (header account selection). Without this, the page would default to
  // the first configured path on the network — e.g. legacy BTC even when
  // the header has Native Segwit selected — because SET_ASSET_CONTEXT
  // replaces ctxAsset.pubkeys with all network pubkeys and the first one
  // is whichever happens to be earliest in chainConfig.
  useEffect(() => {
    if (!isUtxoNetwork(assetContext?.networkId)) return;
    const preferredNote = pubkeyContext?.note ?? pubkeys[0]?.note;
    if (!preferredNote) return;
    const addr = addressByNote[preferredNote];
    if (addr && addr !== selectedAddress) setSelectedAddress(addr);
    // Intentionally omit `selectedAddress` from deps — including it would
    // re-fire on every set and cause redundant work; we only want to
    // react to changes in the inputs that determine the address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubkeyContext, addressByNote, assetContext?.networkId, pubkeys]);

  // Listen for pubkey context updates from other components (like header)
  useEffect(() => {
    const messageListener = (message: any) => {
      if (message.type === 'PUBKEY_CONTEXT_UPDATED' && message.pubkeyContext) {
        setPubkeyContext(message.pubkeyContext);
        // For UTXO chains, the address resolver effect picks the right
        // entry from addressByNote. Setting it directly here would
        // briefly stomp the QR with an empty string (UTXO pubkeys have
        // no .address) before the effect runs.
        const pc = message.pubkeyContext;
        const isUtxo = pc.type === 'xpub' || pc.type === 'zpub' || !pc.address;
        if (!isUtxo) setSelectedAddress(pc.address || pc.master);
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
              scriptType: pubkey.script_type,
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

    const rawScriptType = pubkey.script_type || pubkey.scriptType;
    const stLabel = rawScriptType ? SCRIPT_TYPE_LABELS[rawScriptType.toLowerCase()] : null;
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
    // Top-aligned, not vertically centred: `justify="center"` on a full-height
    // column pushed the selector into the middle of the panel with a ~600px
    // void above it.
    <VStack spacing={4} align="stretch" p={4} h="full" overflowY="auto">
      {/* Asset selector — a bottom sheet, not a Menu. The popover opened over
          the QR it was meant to describe (KEEPKEY_STYLE.md §0). */}
      {balances.length > 0 &&
        (() => {
          // Dedup by CAIP so tokens that share a ticker but live on different
          // chains (or different contracts within the same chain) don't
          // collapse. Deduping by `symbol` alone let e.g. bridged vs native
          // USDC collapse into one entry and could land a user on a QR for the
          // wrong asset.
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
              <Flex
                as="button"
                onClick={() => setIsAssetSheetOpen(true)}
                w="full"
                alignItems="center"
                gap={3}
                py={3}
                px={1}
                borderBottom="1px solid"
                borderColor="kk.lineHi"
                background="transparent"
                cursor="pointer"
                textAlign="left"
                _hover={{ bg: 'kk.bg2' }}>
                <AssetIcon src={assetContext?.icon} symbol={assetContext?.symbol} size={28} />
                <Box flex={1} minW={0}>
                  <Text fontSize="14px" fontWeight={500} color="kk.text" isTruncated>
                    {assetContext?.name}
                  </Text>
                  <Text fontSize="11px" color="kk.faint" className="mono" mt="2px" isTruncated>
                    {assetContext?.symbol}
                    {assetContext?.networkId ? ` · ${getChainDisplayName(assetContext.networkId)}` : ''}
                  </Text>
                </Box>
                <ChevronDownIcon color="kk.faint" />
              </Flex>

              <BottomSheet isOpen={isAssetSheetOpen} title="Receive on" onClose={() => setIsAssetSheetOpen(false)}>
                {uniqueTokens.map(token => {
                  const chainName = getChainDisplayName(token.networkId);
                  const isSelected = keyFor(token) === keyFor(assetContext || {});
                  return (
                    <Flex
                      key={keyFor(token)}
                      alignItems="center"
                      gap={3}
                      width="100%"
                      px={2}
                      py={3}
                      borderRadius="10px"
                      cursor="pointer"
                      _hover={{ bg: 'kk.surfaceHi' }}
                      onClick={() => {
                        handleTokenSelect(token);
                        setIsAssetSheetOpen(false);
                      }}>
                      <AssetIcon src={token.icon} symbol={token.symbol} size={28} />
                      <Box flex={1} minW={0}>
                        <Text fontSize="14px" fontWeight={500} color={isSelected ? 'kk.accent' : 'kk.text'} isTruncated>
                          {token.name}
                        </Text>
                        {/* Chain qualifier is what makes these rows distinct:
                            native ETH on Ethereum / Arbitrum / Optimism / Base
                            shares a name, ticker and logo (§5). */}
                        <Text fontSize="11px" color="kk.faint" className="mono" mt="2px" isTruncated>
                          {token.symbol}
                          {chainName && chainName !== 'Unknown' ? ` · ${chainName}` : ''}
                        </Text>
                      </Box>
                      {isSelected && <CheckIcon boxSize={3} color="kk.accent" />}
                    </Flex>
                  );
                })}
              </BottomSheet>
            </Box>
          );
        })()}

      {/* QR Code with Logo — centred; the column stretches its other rows */}
      <Box bg="white" p={4} borderRadius="xl" boxShadow="lg" alignSelf="center">
        {qrCodeDataUrl ? (
          <Image src={qrCodeDataUrl} alt="QR Code" boxSize="200px" />
        ) : (
          <Flex align="center" justify="center" boxSize="200px">
            <Spinner />
          </Flex>
        )}
      </Box>

      {/* Address type — a segmented row, not a dropdown (design: Receive).
          One UTXO account has up to three script types; laying them out flat
          shows which are available and which is active without a tap, and
          removes the third popover on this screen. BTC ships seven paths
          across four accounts, which a row can't hold — past three they
          stack as a list with each address. */}
      {pubkeys.length > 1 && pubkeys.length <= 3 && (
        <Box
          w="full"
          display="grid"
          gridTemplateColumns={`repeat(${Math.min(pubkeys.length, 3)},1fr)`}
          borderTop="1px solid"
          borderColor="kk.line">
          {pubkeys.map((pubkey, index) => {
            const addr = addressForPubkey(pubkey);
            const isActive = !!selectedAddress && selectedAddress === addr;
            return (
              <Box
                as="button"
                key={pubkey.note || index}
                onClick={() => handleAccountSelect(pubkey, index)}
                height="40px"
                border={0}
                borderTop="1px solid"
                borderColor={isActive ? 'kk.accent' : 'transparent'}
                mt="-1px"
                background="transparent"
                color={isActive ? 'kk.text' : 'kk.faint'}
                fontSize="12px"
                fontWeight={500}
                textAlign="left"
                cursor="pointer"
                transition="color .15s ease, border-color .15s ease">
                {getAddressType(pubkey, index)}
              </Box>
            );
          })}
        </Box>
      )}
      {pubkeys.length > 3 && (
        <Box w="full" borderTop="1px solid" borderColor="kk.line">
          {pubkeys.map((pubkey, index) => {
            const addr = addressForPubkey(pubkey);
            const isActive = !!selectedAddress && selectedAddress === addr;
            return (
              <Box
                as="button"
                key={pubkey.note || index}
                onClick={() => handleAccountSelect(pubkey, index)}
                display="block"
                w="full"
                py={2}
                px={1}
                border={0}
                borderBottom="1px solid"
                borderColor="kk.line"
                background={isActive ? 'kk.surface' : 'transparent'}
                textAlign="left"
                cursor="pointer"
                _hover={{ bg: 'kk.surfaceHi' }}>
                <Text fontSize="12px" fontWeight={500} color={isActive ? 'kk.text' : 'kk.faint'}>
                  {getAddressType(pubkey, index)}
                </Text>
                <Text className="mono" fontSize="12px" color={isActive ? 'kk.text' : 'kk.dim'}>
                  {addr ? formatAddress(addr) : '…'}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}

      {/* Address */}
      <Box w="full">
        <Flex
          align="center"
          justify="space-between"
          gap={2}
          py={3}
          borderTop="1px solid"
          borderBottom="1px solid"
          borderColor="kk.line">
          <Box flex={1} minW={0}>
            <Text className="kk-eyebrow" mb={2}>
              {getAddressType(
                pubkeys.find(p => addressForPubkey(p) === selectedAddress) || pubkeys[0],
                pubkeys.findIndex(p => addressForPubkey(p) === selectedAddress),
              )}
            </Text>
            <Text className="mono" fontSize="12.5px" color="kk.text" wordBreak="break-all" lineHeight={1.5}>
              {selectedAddress}
            </Text>
          </Box>

          {/* Copy button */}
          <IconButton
            aria-label="Copy address"
            icon={hasCopied ? <CheckIcon /> : <CopyIcon />}
            variant="ghost"
            color={hasCopied ? 'kk.good' : 'kk.faint'}
            size="sm"
            onClick={copyToClipboard}
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
