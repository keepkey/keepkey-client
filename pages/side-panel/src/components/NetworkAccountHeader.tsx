import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Flex, Text, Box, IconButton, Avatar, Tooltip, Icon, useToast, useDisclosure } from '@chakra-ui/react';
import { SettingsIcon, CheckCircleIcon, WarningIcon, RepeatIcon } from '@chakra-ui/icons';
import { NetworkIdToChain } from '@extension/shared';

import type { NetworkItem, AccountItem, CustomEvmNetwork, NetworkAccountHeaderProps } from './header/headerTypes';
import { stateNames } from './header/headerConstants';
import { getChainFamily, buildNetworkList, buildAccountList } from './header/headerUtils';
import NetworkDropdown from './header/NetworkDropdown';
import AccountDropdown from './header/AccountDropdown';
import AddNetworkModal from './header/AddNetworkModal';

const NetworkAccountHeader: React.FC<NetworkAccountHeaderProps> = ({
  keepkeyState,
  isRefreshing,
  onSettingsOpen,
  onRefresh,
  onSelectNetwork,
}) => {
  const [pubkeys, setPubkeys] = useState<any[]>([]);
  const [selectedNetworkId, setSelectedNetworkId] = useState<string | null>(null);
  const [selectedAccountKey, setSelectedAccountKey] = useState<string | null>(null);
  const [ethAccounts, setEthAccounts] = useState<number[]>([0]);
  const [customEvmNetworks, setCustomEvmNetworks] = useState<CustomEvmNetwork[]>([]);
  const [isAddingAccount, setIsAddingAccount] = useState(false);
  const [hasAssetContext, setHasAssetContext] = useState(false);
  const toast = useToast();

  const { isOpen: isNetworkModalOpen, onOpen: onNetworkModalOpen, onClose: onNetworkModalClose } = useDisclosure();

  const isPaired = keepkeyState === 5;

  // Derived data
  const networks = useMemo(() => buildNetworkList(pubkeys, customEvmNetworks), [pubkeys, customEvmNetworks]);

  const accounts = useMemo(
    () => (selectedNetworkId ? buildAccountList(pubkeys, selectedNetworkId, ethAccounts) : []),
    [pubkeys, selectedNetworkId, ethAccounts],
  );

  const canAddAccount = selectedNetworkId?.startsWith('eip155:') ?? false;

  // Fetch pubkeys + persisted state
  const fetchPubkeys = useCallback(() => {
    if (keepkeyState !== 5) return;

    chrome.runtime.sendMessage({ type: 'GET_ETH_ACCOUNTS' }, accResponse => {
      const accs = accResponse?.accounts || [0];
      setEthAccounts(accs);

      chrome.runtime.sendMessage({ type: 'GET_CUSTOM_EVM_NETWORKS' }, netResponse => {
        const customNets = netResponse?.networks || [];
        setCustomEvmNetworks(customNets);

        chrome.runtime.sendMessage({ type: 'GET_APP_PUBKEYS' }, response => {
          if (response?.balances) {
            setPubkeys(response.balances);

            // Restore selection from stored asset context
            chrome.runtime.sendMessage({ type: 'GET_ASSET_CONTEXT' }, ctxResponse => {
              const stored = ctxResponse?.assets;
              if (stored?.networkId) {
                setSelectedNetworkId(stored.networkId);
                setHasAssetContext(true);
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

  // Listen for asset context changes and state changes
  useEffect(() => {
    const listener = (message: any) => {
      if (message.type === 'KEEPKEY_STATE_CHANGED' && message.state === 5) {
        fetchPubkeys();
      }
      if (message.type === 'ASSET_CONTEXT_UPDATED' && message.assetContext?.networkId) {
        setSelectedNetworkId(message.assetContext.networkId);
        setHasAssetContext(true);
      }
      if (message.type === 'ASSET_CONTEXT_CLEARED') {
        setSelectedNetworkId(null);
        setSelectedAccountKey(null);
        setHasAssetContext(false);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [fetchPubkeys]);

  // Auto-select default account when network changes
  useEffect(() => {
    if (accounts.length > 0 && !accounts.find(a => a.key === selectedAccountKey)) {
      const defaultAcc = accounts.find(a => a.isDefault) || accounts[0];
      setSelectedAccountKey(defaultAcc.key);
    }
  }, [accounts, selectedAccountKey]);

  // Helpers to fire SET_ASSET_CONTEXT and notify parent
  const setAssetContext = useCallback(
    (networkId: string, account: AccountItem) => {
      const chainSymbol = NetworkIdToChain[networkId];
      const net = networks.find(n => n.networkId === networkId);
      const asset = {
        networkId,
        caip: networkId,
        name: net?.name || chainSymbol || networkId,
        symbol: chainSymbol || net?.name || '',
        icon: net?.icon || '',
        address: account.address,
        pubkeys: account.pubkey ? [account.pubkey] : [],
      };
      chrome.runtime.sendMessage({ type: 'SET_ASSET_CONTEXT', asset });
      setHasAssetContext(true);
      if (onSelectNetwork) onSelectNetwork(asset);
    },
    [networks, onSelectNetwork],
  );

  // Network selected
  const handleNetworkSelect = useCallback(
    (net: NetworkItem) => {
      setSelectedNetworkId(net.networkId);
      // Build accounts for this network and pick the default
      const accts = buildAccountList(pubkeys, net.networkId, ethAccounts);
      const defaultAcc = accts.find(a => a.isDefault) || accts[0];
      if (defaultAcc) {
        setSelectedAccountKey(defaultAcc.key);
        setAssetContext(net.networkId, defaultAcc);
      }
    },
    [pubkeys, ethAccounts, setAssetContext],
  );

  // Account selected
  const handleAccountSelect = useCallback(
    (account: AccountItem) => {
      setSelectedAccountKey(account.key);
      if (selectedNetworkId) {
        setAssetContext(selectedNetworkId, account);
      }
    },
    [selectedNetworkId, setAssetContext],
  );

  // ETH account add/remove
  const handleAddEthAccount = useCallback(() => {
    const nextIndex = Math.max(...ethAccounts) + 1;
    setIsAddingAccount(true);
    chrome.runtime.sendMessage({ type: 'ADD_ETH_ACCOUNT', accountIndex: nextIndex }, response => {
      setIsAddingAccount(false);
      if (response?.success) {
        setEthAccounts(response.accounts);
        toast({ title: `Account ${nextIndex} added`, status: 'success', duration: 2000 });
        fetchPubkeys();
      } else {
        toast({ title: 'Failed to add account', description: response?.error, status: 'error', duration: 3000 });
      }
    });
  }, [ethAccounts, fetchPubkeys, toast]);

  const handleRemoveEthAccount = useCallback(
    (index: number) => {
      if (index === 0) return;
      chrome.runtime.sendMessage({ type: 'REMOVE_ETH_ACCOUNT', accountIndex: index }, response => {
        if (response?.success) {
          setEthAccounts(response.accounts);
          toast({ title: `Account ${index} removed`, status: 'info', duration: 2000 });
          fetchPubkeys();
        }
      });
    },
    [fetchPubkeys, toast],
  );

  // Custom network add/remove
  const handleAddNetwork = useCallback(
    (network: CustomEvmNetwork) => {
      chrome.runtime.sendMessage({ type: 'ADD_CUSTOM_EVM_NETWORK', network }, response => {
        if (response?.success) {
          setCustomEvmNetworks(response.networks);
          toast({ title: `${network.name} added`, status: 'success', duration: 2000 });
          fetchPubkeys();
        } else {
          toast({ title: 'Failed to add network', description: response?.error, status: 'error', duration: 3000 });
        }
      });
    },
    [fetchPubkeys, toast],
  );

  const handleRemoveNetwork = useCallback(
    (networkId: string) => {
      chrome.runtime.sendMessage({ type: 'REMOVE_CUSTOM_EVM_NETWORK', networkId }, response => {
        if (response?.success) {
          setCustomEvmNetworks(response.networks);
          toast({ title: 'Network removed', status: 'info', duration: 2000 });
          fetchPubkeys();
        }
      });
    },
    [fetchPubkeys, toast],
  );

  return (
    <Box mb={2}>
      <Flex alignItems="center" justifyContent="space-between" gap={2}>
        {/* Left: Settings */}
        <IconButton icon={<SettingsIcon />} aria-label="Settings" variant="ghost" size="sm" onClick={onSettingsOpen} />

        {/* Center: Branding or Network + Account dropdowns */}
        {isPaired && hasAssetContext && networks.length > 0 ? (
          <Flex flex={1} alignItems="center" justifyContent="center" gap={1} minW={0}>
            <NetworkDropdown
              networks={networks}
              selectedNetworkId={selectedNetworkId}
              onSelect={handleNetworkSelect}
              onAddNetwork={onNetworkModalOpen}
              onRemoveNetwork={handleRemoveNetwork}
            />
            <AccountDropdown
              accounts={accounts}
              selectedAccountKey={selectedAccountKey}
              onSelect={handleAccountSelect}
              canAddAccount={canAddAccount}
              onAddAccount={handleAddEthAccount}
              isAddingAccount={isAddingAccount}
              onRemoveAccount={canAddAccount ? handleRemoveEthAccount : undefined}
            />
          </Flex>
        ) : (
          <Flex flex={1} alignItems="center" justifyContent="center">
            <Avatar size="xs" src="/kk-logo.png" name="KeepKey" mr={2} />
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

      {/* Add Network Modal */}
      <AddNetworkModal isOpen={isNetworkModalOpen} onClose={onNetworkModalClose} onSubmit={handleAddNetwork} />
    </Box>
  );
};

export default NetworkAccountHeader;
