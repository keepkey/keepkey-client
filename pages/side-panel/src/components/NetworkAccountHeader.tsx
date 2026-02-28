import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Flex,
  Text,
  Box,
  IconButton,
  Avatar,
  Tooltip,
  Icon,
  Collapse,
  useToast,
  Button,
  Input,
  FormControl,
  FormLabel,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  ModalFooter,
  useDisclosure,
  Badge,
} from '@chakra-ui/react';
import {
  SettingsIcon,
  CheckCircleIcon,
  WarningIcon,
  RepeatIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ChevronLeftIcon,
  CopyIcon,
  CheckIcon,
  AddIcon,
  SmallCloseIcon,
} from '@chakra-ui/icons';
import { NetworkIdToChain, COIN_MAP_LONG, ChainToNetworkId, networkIdToIcon, caipToIcon } from '@extension/shared';

const stateNames: Record<number, string> = {
  0: 'unknown',
  1: 'disconnected',
  2: 'connected',
  3: 'busy',
  4: 'errored',
  5: 'paired',
};

// All known EVM chains — these share the same address from the ETH wildcard pubkey
const KNOWN_EVM_CHAINS: Record<string, { name: string; symbol: string }> = {
  'eip155:1': { name: 'Ethereum', symbol: 'ETH' },
  'eip155:42161': { name: 'Arbitrum', symbol: 'ARB' },
  'eip155:43114': { name: 'Avalanche', symbol: 'AVAX' },
  'eip155:56': { name: 'BNB Smart Chain', symbol: 'BSC' },
  'eip155:8453': { name: 'Base', symbol: 'BASE' },
  'eip155:10': { name: 'Optimism', symbol: 'OP' },
  'eip155:137': { name: 'Polygon', symbol: 'MATIC' },
  'eip155:324': { name: 'zkSync Era', symbol: 'ZKSYNC' },
};

// Static map: networkId → display name (non-EVM chains)
const NETWORK_DISPLAY_NAMES: Record<string, string> = {
  'bip122:000000000019d6689c085ae165831e93': 'Bitcoin',
  'bip122:000000000000000000651ef99cb9fcbe': 'Bitcoin Cash',
  'bip122:00000000001a91e3dace36e2be3bf030': 'Dogecoin',
  'bip122:000007d91d1254d60e2dd1ae58038307': 'Dash',
  'bip122:12a765e31ffd4059bada1e25190f6e98': 'Litecoin',
  'cosmos:cosmoshub-4': 'Cosmos',
  'cosmos:thorchain-mainnet-v1': 'THORChain',
  'cosmos:mayachain-mainnet-v1': 'Maya',
  'cosmos:osmosis-1': 'Osmosis',
  'ripple:4109c6f2045fc7eff4cde8f9905d19c2': 'Ripple',
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': 'Solana',
  // DO NOT add binance:bnb-beacon-chain — deprecated/broken chain
};

// Bitcoin script_type suffixes
const BTC_SCRIPT_LABELS: Record<string, string> = {
  p2pkh: 'Bitcoin Legacy',
  'p2sh-p2wpkh': 'Bitcoin SegWit',
  p2wpkh: 'Bitcoin Native SegWit',
};

const BTC_NETWORK_ID = 'bip122:000000000019d6689c085ae165831e93';

type ChainFamily = 'evm' | 'utxo' | 'cosmos' | 'other';

const CHAIN_FAMILY_LABELS: Record<ChainFamily, string> = {
  evm: 'EVM Networks',
  utxo: 'UTXO Chains',
  cosmos: 'Cosmos Ecosystem',
  other: 'Other',
};

function getChainFamily(networkId: string): ChainFamily {
  if (networkId.startsWith('eip155:')) return 'evm';
  if (networkId.startsWith('bip122:')) return 'utxo';
  if (networkId.startsWith('cosmos:')) return 'cosmos';
  return 'other';
}

interface NetworkRow {
  key: string;
  networkId: string;
  name: string;
  icon: string;
  address: string;
  pubkey: any;
  accountIndex?: number; // For ETH accounts
}

interface NetworkAccountHeaderProps {
  keepkeyState: number | null;
  isRefreshing: boolean;
  onSettingsOpen: () => void;
  onRefresh: () => void;
  onSelectNetwork?: (asset: any) => void;
}

function formatAddress(address: string): string {
  if (!address) return '';
  if (address.length <= 16) return address;
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function getIconUrl(chainSymbol: string, networkId?: string): string {
  // Use the canonical CAIP-based icon URL (matches vault v11 convention)
  if (networkId) return networkIdToIcon(networkId);
  const nid = (ChainToNetworkId as Record<string, string>)[chainSymbol];
  if (nid) return networkIdToIcon(nid);
  return `https://api.keepkey.info/coins/${btoa(chainSymbol.toLowerCase())}.png`;
}

interface CustomEvmNetwork {
  networkId: string;
  chainId: number;
  name: string;
  rpc: string;
  symbol: string;
  explorerUrl?: string;
}

function buildNetworkRows(pubkeys: any[], customEvmNetworks: CustomEvmNetwork[]): NetworkRow[] {
  const rows: NetworkRow[] = [];
  const seen = new Set<string>();

  // Collect EVM wildcard pubkeys (these are the base ETH accounts)
  const evmWildcardPubkeys: any[] = [];

  for (const pk of pubkeys) {
    const networks: string[] = pk.networks || [];
    const address = pk.address || pk.master || '';
    const hasEvmWildcard = networks.includes('eip155:*');

    if (hasEvmWildcard) {
      evmWildcardPubkeys.push(pk);
    }

    for (const networkId of networks) {
      // Skip EVM wildcard — we expand it below
      if (networkId === 'eip155:*') continue;

      // Skip EVM networks that come from the wildcard — we'll add them explicitly
      if (hasEvmWildcard && networkId.startsWith('eip155:') && networkId !== 'eip155:1') continue;

      const chainSymbol = NetworkIdToChain[networkId];

      // Bitcoin: create separate rows per script_type
      if (networkId === BTC_NETWORK_ID && pk.script_type) {
        const rowKey = `${networkId}:${pk.script_type}`;
        if (seen.has(rowKey)) continue;
        seen.add(rowKey);

        const name = BTC_SCRIPT_LABELS[pk.script_type] || NETWORK_DISPLAY_NAMES[networkId] || networkId;
        rows.push({
          key: rowKey,
          networkId,
          name,
          icon: getIconUrl('BTC', networkId),
          address,
          pubkey: pk,
        });
      } else if (networkId.startsWith('eip155:')) {
        // ETH account — figure out account index from note
        const accountIndex = parseAccountIndex(pk.note);
        const rowKey = `${networkId}:account${accountIndex}`;
        if (seen.has(rowKey)) continue;
        seen.add(rowKey);

        const evmInfo = KNOWN_EVM_CHAINS[networkId];
        const name = evmInfo?.name || NETWORK_DISPLAY_NAMES[networkId] || networkId;

        rows.push({
          key: rowKey,
          networkId,
          name: accountIndex > 0 ? `${name} (Account ${accountIndex})` : name,
          icon: getIconUrl(evmInfo?.symbol || chainSymbol || 'ETH', networkId),
          address,
          pubkey: pk,
          accountIndex,
        });
      } else {
        if (seen.has(networkId)) continue;
        seen.add(networkId);

        const name = NETWORK_DISPLAY_NAMES[networkId] || chainSymbol || networkId;
        rows.push({
          key: networkId,
          networkId,
          name,
          icon: getIconUrl(chainSymbol || '', networkId),
          address,
          pubkey: pk,
        });
      }
    }
  }

  // Expand EVM wildcard: for the primary ETH pubkey (account 0), create rows for all known EVM chains
  if (evmWildcardPubkeys.length > 0) {
    const primaryPk = evmWildcardPubkeys[0];
    const address = primaryPk.address || primaryPk.master || '';

    for (const [networkId, info] of Object.entries(KNOWN_EVM_CHAINS)) {
      if (networkId === 'eip155:1') continue; // Already added from the explicit network entry
      const rowKey = `${networkId}:account0`;
      if (seen.has(rowKey)) continue;
      seen.add(rowKey);

      rows.push({
        key: rowKey,
        networkId,
        name: info.name,
        icon: getIconUrl(info.symbol, networkId),
        address,
        pubkey: primaryPk,
        accountIndex: 0,
      });
    }

    // Also expand custom EVM networks
    for (const custom of customEvmNetworks) {
      const rowKey = `${custom.networkId}:account0`;
      if (seen.has(rowKey)) continue;
      seen.add(rowKey);

      rows.push({
        key: rowKey,
        networkId: custom.networkId,
        name: custom.name,
        icon: getIconUrl(custom.symbol, custom.networkId),
        address,
        pubkey: primaryPk,
        accountIndex: 0,
      });
    }
  }

  return rows;
}

function parseAccountIndex(note?: string): number {
  if (!note) return 0;
  const match = note.match(/account\s*(\d+)/i);
  return match ? parseInt(match[1], 10) : 0;
}

const NetworkAccountHeader: React.FC<NetworkAccountHeaderProps> = ({
  keepkeyState,
  isRefreshing,
  onSettingsOpen,
  onRefresh,
  onSelectNetwork,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [networkRows, setNetworkRows] = useState<NetworkRow[]>([]);
  const [selectedRow, setSelectedRow] = useState<NetworkRow | null>(null);
  const [activeFamily, setActiveFamily] = useState<ChainFamily | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [ethAccounts, setEthAccounts] = useState<number[]>([0]);
  const [customEvmNetworks, setCustomEvmNetworks] = useState<CustomEvmNetwork[]>([]);
  const [isAddingAccount, setIsAddingAccount] = useState(false);
  const toast = useToast();

  // Add Network modal
  const { isOpen: isNetworkModalOpen, onOpen: onNetworkModalOpen, onClose: onNetworkModalClose } = useDisclosure();
  const [newNetwork, setNewNetwork] = useState({ chainId: '', name: '', rpc: '', symbol: '', explorerUrl: '' });

  // Group rows by chain family
  const groupedRows = useMemo(() => {
    const groups: Partial<Record<ChainFamily, NetworkRow[]>> = {};
    for (const row of networkRows) {
      const family = getChainFamily(row.networkId);
      if (!groups[family]) groups[family] = [];
      groups[family]!.push(row);
    }
    return groups;
  }, [networkRows]);

  // Filter rows when a family is active
  const filteredRows = useMemo(() => {
    if (!activeFamily) return null;
    return networkRows.filter(r => getChainFamily(r.networkId) === activeFamily);
  }, [networkRows, activeFamily]);

  const fetchPubkeys = useCallback(() => {
    if (keepkeyState !== 5) return;

    // Fetch ETH accounts, custom networks, and pubkeys in parallel
    chrome.runtime.sendMessage({ type: 'GET_ETH_ACCOUNTS' }, accResponse => {
      const accounts = accResponse?.accounts || [0];
      setEthAccounts(accounts);

      chrome.runtime.sendMessage({ type: 'GET_CUSTOM_EVM_NETWORKS' }, netResponse => {
        const customNets = netResponse?.networks || [];
        setCustomEvmNetworks(customNets);

        chrome.runtime.sendMessage({ type: 'GET_APP_PUBKEYS' }, response => {
          if (response?.balances) {
            const pubkeys = response.balances;
            const rows = buildNetworkRows(pubkeys, customNets);
            setNetworkRows(rows);

            // Restore selection from stored asset context
            chrome.runtime.sendMessage({ type: 'GET_ASSET_CONTEXT' }, ctxResponse => {
              const stored = ctxResponse?.assets;
              if (stored?.networkId) {
                const match = rows.find(r => r.networkId === stored.networkId);
                if (match) {
                  setSelectedRow(match);
                  setActiveFamily(getChainFamily(match.networkId));
                }
              }
            });
          }
        });
      });
    });
  }, [keepkeyState]);

  useEffect(() => {
    fetchPubkeys();
  }, [fetchPubkeys]);

  // Listen for state changes and external asset context updates
  useEffect(() => {
    const listener = (message: any) => {
      if (message.type === 'KEEPKEY_STATE_CHANGED' && message.state === 5) {
        fetchPubkeys();
      }
      if (message.type === 'ASSET_CONTEXT_UPDATED' && message.assetContext?.networkId) {
        const nid = message.assetContext.networkId;
        const match = networkRows.find(r => r.networkId === nid);
        if (match) {
          setSelectedRow(match);
          setActiveFamily(getChainFamily(match.networkId));
        } else {
          // Chain was added externally (e.g. via dApp wallet_addEthereumChain) — refresh rows
          fetchPubkeys();
        }
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [fetchPubkeys, networkRows]);

  const handleCopy = (address: string, rowKey: string) => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopiedKey(rowKey);
    toast({ title: 'Address copied!', status: 'success', duration: 1500 });
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleRowClick = (row: NetworkRow) => {
    const chainSymbol = NetworkIdToChain[row.networkId];
    const asset = {
      networkId: row.networkId,
      caip: row.networkId,
      name: row.name,
      symbol: chainSymbol || row.name,
      icon: row.icon,
      address: row.address,
      pubkeys: row.pubkey ? [row.pubkey] : [],
    };
    chrome.runtime.sendMessage({ type: 'SET_ASSET_CONTEXT', asset });
    setSelectedRow(row);
    setActiveFamily(getChainFamily(row.networkId));
    setIsExpanded(false);
    if (onSelectNetwork) {
      onSelectNetwork(asset);
    }
  };

  const handleBackToAll = () => {
    setActiveFamily(null);
  };

  const handleAddEthAccount = () => {
    const nextIndex = Math.max(...ethAccounts) + 1;
    setIsAddingAccount(true);
    chrome.runtime.sendMessage({ type: 'ADD_ETH_ACCOUNT', accountIndex: nextIndex }, response => {
      setIsAddingAccount(false);
      if (response?.success) {
        setEthAccounts(response.accounts);
        toast({ title: `Account ${nextIndex} added`, status: 'success', duration: 2000 });
        // Refresh to show new account rows
        fetchPubkeys();
      } else {
        toast({ title: 'Failed to add account', description: response?.error, status: 'error', duration: 3000 });
      }
    });
  };

  const handleRemoveEthAccount = (index: number) => {
    if (index === 0) return;
    chrome.runtime.sendMessage({ type: 'REMOVE_ETH_ACCOUNT', accountIndex: index }, response => {
      if (response?.success) {
        setEthAccounts(response.accounts);
        toast({ title: `Account ${index} removed`, status: 'info', duration: 2000 });
        fetchPubkeys();
      }
    });
  };

  const handleAddNetwork = () => {
    const chainId = parseInt(newNetwork.chainId, 10);
    if (!chainId || !newNetwork.name || !newNetwork.rpc || !newNetwork.symbol) {
      toast({ title: 'Fill all required fields', status: 'warning', duration: 2000 });
      return;
    }
    const network: CustomEvmNetwork = {
      networkId: `eip155:${chainId}`,
      chainId,
      name: newNetwork.name,
      rpc: newNetwork.rpc,
      symbol: newNetwork.symbol.toUpperCase(),
      explorerUrl: newNetwork.explorerUrl || undefined,
    };
    chrome.runtime.sendMessage({ type: 'ADD_CUSTOM_EVM_NETWORK', network }, response => {
      if (response?.success) {
        setCustomEvmNetworks(response.networks);
        toast({ title: `${network.name} added`, status: 'success', duration: 2000 });
        onNetworkModalClose();
        setNewNetwork({ chainId: '', name: '', rpc: '', symbol: '', explorerUrl: '' });
        fetchPubkeys();
      } else {
        toast({ title: 'Failed to add network', description: response?.error, status: 'error', duration: 3000 });
      }
    });
  };

  const handleRemoveNetwork = (networkId: string) => {
    chrome.runtime.sendMessage({ type: 'REMOVE_CUSTOM_EVM_NETWORK', networkId }, response => {
      if (response?.success) {
        setCustomEvmNetworks(response.networks);
        toast({ title: 'Network removed', status: 'info', duration: 2000 });
        fetchPubkeys();
      }
    });
  };

  const isPaired = keepkeyState === 5;

  const renderRowItem = (row: NetworkRow) => {
    const isCustomNetwork = customEvmNetworks.some(n => n.networkId === row.networkId);
    return (
      <Flex
        key={row.key}
        alignItems="center"
        px={3}
        py={2}
        cursor="pointer"
        bg={selectedRow?.key === row.key ? 'whiteAlpha.150' : 'transparent'}
        _hover={{ bg: 'whiteAlpha.100' }}
        transition="background 0.1s"
        onClick={() => handleRowClick(row)}
        borderBottom="1px solid"
        borderColor="whiteAlpha.50">
        <Avatar size="xs" src={row.icon} name={row.name} mr={2} />
        <Box flex={1} minW={0}>
          <Flex alignItems="center" gap={1}>
            <Text fontSize="xs" color="whiteAlpha.600" lineHeight="1.2" isTruncated>
              {row.name}
            </Text>
            {isCustomNetwork && (
              <Badge fontSize="0.5rem" colorScheme="purple" variant="subtle" px={1}>
                Custom
              </Badge>
            )}
          </Flex>
          <Text fontSize="xs" fontFamily="mono" color="white" lineHeight="1.2" isTruncated>
            {formatAddress(row.address)}
          </Text>
        </Box>
        {isCustomNetwork && (
          <IconButton
            icon={<SmallCloseIcon />}
            aria-label="Remove network"
            size="xs"
            variant="ghost"
            colorScheme="red"
            onClick={e => {
              e.stopPropagation();
              handleRemoveNetwork(row.networkId);
            }}
            ml={1}
          />
        )}
        <IconButton
          icon={copiedKey === row.key ? <CheckIcon /> : <CopyIcon />}
          aria-label="Copy address"
          size="xs"
          variant="ghost"
          colorScheme={copiedKey === row.key ? 'green' : 'gray'}
          onClick={e => {
            e.stopPropagation();
            handleCopy(row.address, row.key);
          }}
          ml={1}
        />
      </Flex>
    );
  };

  const renderEthAccountsSection = () => (
    <Flex
      alignItems="center"
      justifyContent="space-between"
      px={3}
      py={1.5}
      bg="whiteAlpha.50"
      borderBottom="1px solid"
      borderColor="whiteAlpha.100">
      <Flex alignItems="center" gap={1} flexWrap="wrap">
        <Text fontSize="xs" color="whiteAlpha.500" fontWeight="bold" textTransform="uppercase" letterSpacing="wider">
          ETH Accounts:
        </Text>
        {ethAccounts.map(idx => (
          <Flex key={idx} alignItems="center">
            <Badge
              fontSize="0.6rem"
              colorScheme="blue"
              variant={idx === (selectedRow?.accountIndex ?? -1) ? 'solid' : 'subtle'}
              cursor="default"
              px={1}>
              #{idx}
            </Badge>
            {idx > 0 && (
              <IconButton
                icon={<SmallCloseIcon />}
                aria-label={`Remove account ${idx}`}
                size="xs"
                variant="ghost"
                colorScheme="red"
                minW="14px"
                h="14px"
                onClick={e => {
                  e.stopPropagation();
                  handleRemoveEthAccount(idx);
                }}
              />
            )}
          </Flex>
        ))}
      </Flex>
      <Button
        size="xs"
        variant="ghost"
        colorScheme="blue"
        leftIcon={<AddIcon boxSize={2} />}
        fontSize="xs"
        isLoading={isAddingAccount}
        onClick={e => {
          e.stopPropagation();
          handleAddEthAccount();
        }}>
        Add
      </Button>
    </Flex>
  );

  return (
    <Box mb={2}>
      {/* Header bar */}
      <Flex alignItems="center" justifyContent="space-between" gap={2}>
        {/* Left: Settings */}
        <IconButton icon={<SettingsIcon />} aria-label="Settings" variant="ghost" size="sm" onClick={onSettingsOpen} />

        {/* Center: Account selector */}
        {isPaired && networkRows.length > 0 ? (
          <Flex
            flex={1}
            alignItems="center"
            justifyContent="center"
            cursor="pointer"
            onClick={() => setIsExpanded(prev => !prev)}
            px={2}
            py={1}
            borderRadius="md"
            bg="whiteAlpha.100"
            _hover={{ bg: 'whiteAlpha.200' }}
            transition="background 0.15s">
            <Avatar
              size="xs"
              src={selectedRow ? selectedRow.icon : 'https://api.keepkey.info/coins/keepkey.png'}
              mr={2}
            />
            <Box minW={0} flex={1} textAlign="center">
              <Text fontSize="sm" fontWeight="semibold" color="white" isTruncated>
                {selectedRow ? selectedRow.name : 'All Networks'}
              </Text>
              {selectedRow && selectedRow.address && (
                <Text fontSize="xs" fontFamily="mono" color="whiteAlpha.600" isTruncated>
                  {formatAddress(selectedRow.address)}
                </Text>
              )}
            </Box>
            <Icon as={isExpanded ? ChevronUpIcon : ChevronDownIcon} boxSize={4} ml={1} color="whiteAlpha.700" />
          </Flex>
        ) : (
          <Flex flex={1} alignItems="center" justifyContent="center">
            <Avatar size="xs" src="https://api.keepkey.info/coins/keepkey.png" mr={2} />
            <Text fontSize="sm" fontWeight="semibold" color="white">
              KeepKey
            </Text>
          </Flex>
        )}

        {/* Right: Status + Refresh */}
        <Flex alignItems="center" gap={1}>
          <Tooltip label={keepkeyState !== null ? stateNames[keepkeyState] : 'unknown'} placement="bottom" hasArrow>
            <span>
              {isPaired ? (
                <Icon as={CheckCircleIcon} color="green.400" boxSize={4} />
              ) : (
                <Icon as={WarningIcon} color="yellow.400" boxSize={4} />
              )}
            </span>
          </Tooltip>
          <IconButton
            icon={<RepeatIcon />}
            aria-label="Refresh"
            variant="ghost"
            size="sm"
            isLoading={isRefreshing}
            onClick={onRefresh}
          />
        </Flex>
      </Flex>

      {/* Collapsible network list */}
      {isPaired && (
        <Collapse in={isExpanded} animateOpacity>
          <Box
            mt={2}
            borderRadius="md"
            border="1px solid"
            borderColor="whiteAlpha.200"
            bg="gray.800"
            maxH="400px"
            overflowY="auto"
            sx={{
              '&::-webkit-scrollbar': { width: '4px' },
              '&::-webkit-scrollbar-thumb': { bg: 'whiteAlpha.300', borderRadius: '2px' },
            }}>
            {/* Filtered view: show back button + filtered rows */}
            {activeFamily && filteredRows ? (
              <>
                <Flex
                  alignItems="center"
                  px={3}
                  py={2}
                  cursor="pointer"
                  _hover={{ bg: 'whiteAlpha.100' }}
                  onClick={handleBackToAll}
                  borderBottom="1px solid"
                  borderColor="whiteAlpha.100">
                  <Icon as={ChevronLeftIcon} boxSize={4} color="whiteAlpha.600" mr={1} />
                  <Text fontSize="xs" color="whiteAlpha.600" fontWeight="medium">
                    All Networks
                  </Text>
                </Flex>
                {/* Show ETH accounts bar when viewing EVM family */}
                {activeFamily === 'evm' && renderEthAccountsSection()}
                {filteredRows.map(renderRowItem)}
              </>
            ) : (
              /* Grouped view: show sections by chain family */
              (['evm', 'utxo', 'cosmos', 'other'] as ChainFamily[]).map(family => {
                const rows = groupedRows[family];
                if (!rows || rows.length === 0) return null;
                return (
                  <Box key={family}>
                    <Text
                      fontSize="xs"
                      fontWeight="bold"
                      color="whiteAlpha.500"
                      px={3}
                      pt={2}
                      pb={1}
                      textTransform="uppercase"
                      letterSpacing="wider">
                      {CHAIN_FAMILY_LABELS[family]}
                    </Text>
                    {/* Show ETH accounts bar in EVM section */}
                    {family === 'evm' && renderEthAccountsSection()}
                    {rows.map(renderRowItem)}
                  </Box>
                );
              })
            )}

            {networkRows.length === 0 && (
              <Text fontSize="xs" color="whiteAlpha.400" p={3} textAlign="center">
                No networks available
              </Text>
            )}

            {/* Add Network button */}
            <Flex
              alignItems="center"
              justifyContent="center"
              px={3}
              py={2}
              cursor="pointer"
              _hover={{ bg: 'whiteAlpha.100' }}
              onClick={e => {
                e.stopPropagation();
                onNetworkModalOpen();
              }}
              borderTop="1px solid"
              borderColor="whiteAlpha.100">
              <Icon as={AddIcon} boxSize={3} color="blue.300" mr={2} />
              <Text fontSize="xs" color="blue.300" fontWeight="medium">
                Add Network
              </Text>
            </Flex>
          </Box>
        </Collapse>
      )}

      {/* Add Network Modal */}
      <Modal isOpen={isNetworkModalOpen} onClose={onNetworkModalClose} size="sm">
        <ModalOverlay />
        <ModalContent bg="gray.800" color="white">
          <ModalHeader fontSize="md">Add Custom EVM Network</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <FormControl mb={3}>
              <FormLabel fontSize="xs" color="whiteAlpha.600">
                Chain ID *
              </FormLabel>
              <Input
                size="sm"
                placeholder="e.g. 42220"
                value={newNetwork.chainId}
                onChange={e => setNewNetwork(prev => ({ ...prev, chainId: e.target.value }))}
                bg="whiteAlpha.100"
                border="1px solid"
                borderColor="whiteAlpha.200"
              />
            </FormControl>
            <FormControl mb={3}>
              <FormLabel fontSize="xs" color="whiteAlpha.600">
                Network Name *
              </FormLabel>
              <Input
                size="sm"
                placeholder="e.g. Celo"
                value={newNetwork.name}
                onChange={e => setNewNetwork(prev => ({ ...prev, name: e.target.value }))}
                bg="whiteAlpha.100"
                border="1px solid"
                borderColor="whiteAlpha.200"
              />
            </FormControl>
            <FormControl mb={3}>
              <FormLabel fontSize="xs" color="whiteAlpha.600">
                RPC URL *
              </FormLabel>
              <Input
                size="sm"
                placeholder="https://forno.celo.org"
                value={newNetwork.rpc}
                onChange={e => setNewNetwork(prev => ({ ...prev, rpc: e.target.value }))}
                bg="whiteAlpha.100"
                border="1px solid"
                borderColor="whiteAlpha.200"
              />
            </FormControl>
            <FormControl mb={3}>
              <FormLabel fontSize="xs" color="whiteAlpha.600">
                Currency Symbol *
              </FormLabel>
              <Input
                size="sm"
                placeholder="e.g. CELO"
                value={newNetwork.symbol}
                onChange={e => setNewNetwork(prev => ({ ...prev, symbol: e.target.value }))}
                bg="whiteAlpha.100"
                border="1px solid"
                borderColor="whiteAlpha.200"
              />
            </FormControl>
            <FormControl mb={3}>
              <FormLabel fontSize="xs" color="whiteAlpha.600">
                Block Explorer URL (optional)
              </FormLabel>
              <Input
                size="sm"
                placeholder="https://explorer.celo.org"
                value={newNetwork.explorerUrl}
                onChange={e => setNewNetwork(prev => ({ ...prev, explorerUrl: e.target.value }))}
                bg="whiteAlpha.100"
                border="1px solid"
                borderColor="whiteAlpha.200"
              />
            </FormControl>
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="ghost" mr={2} onClick={onNetworkModalClose}>
              Cancel
            </Button>
            <Button size="sm" colorScheme="blue" onClick={handleAddNetwork}>
              Add Network
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
};

export default NetworkAccountHeader;
