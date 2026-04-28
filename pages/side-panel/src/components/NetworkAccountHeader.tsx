import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Flex, Text, Box, IconButton, Tooltip, useToast, useDisclosure } from '@chakra-ui/react';
import { SettingsIcon, RepeatIcon } from '@chakra-ui/icons';
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
  onHome,
  onSelectNetwork,
}) => {
  const [pubkeys, setPubkeys] = useState<any[]>([]);
  const [selectedNetworkId, setSelectedNetworkId] = useState<string | null>(null);
  const [selectedAccountKey, setSelectedAccountKey] = useState<string | null>(null);
  const [ethAccounts, setEthAccounts] = useState<number[]>([0]);
  const [customEvmNetworks, setCustomEvmNetworks] = useState<CustomEvmNetwork[]>([]);
  const [isAddingAccount, setIsAddingAccount] = useState(false);
  const [hasAssetContext, setHasAssetContext] = useState(false);
  // Held across pubkey load so the auto-select effect can land on the
  // restored account instead of snapping back to the default.
  const [desiredAccountIndex, setDesiredAccountIndex] = useState<number | null>(null);
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

            // Restore selection from stored asset context. Carries
            // accountIndex too so multi-account EVM picks survive a
            // reload — without this the auto-select effect below
            // snapped back to Account 0 every time.
            chrome.runtime.sendMessage({ type: 'GET_ASSET_CONTEXT' }, ctxResponse => {
              const stored = ctxResponse?.assets;
              if (stored?.networkId) {
                setSelectedNetworkId(stored.networkId);
                setHasAssetContext(true);
                if (stored.accountIndex !== undefined && stored.accountIndex !== null) {
                  setDesiredAccountIndex(stored.accountIndex);
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

  // Auto-select an account when network changes. Priority:
  //   1. Restore target (from persisted asset context on reload)
  //   2. Current selection if still valid
  //   3. isDefault → first account
  useEffect(() => {
    if (accounts.length === 0) return;
    if (selectedAccountKey && accounts.find(a => a.key === selectedAccountKey)) return;

    if (desiredAccountIndex !== null) {
      const target = accounts.find(a => a.accountIndex === desiredAccountIndex);
      if (target) {
        setSelectedAccountKey(target.key);
        setDesiredAccountIndex(null); // one-shot — don't keep overriding manual picks
        return;
      }
      // Restore target doesn't exist (e.g. account was removed) — fall through.
      setDesiredAccountIndex(null);
    }

    const defaultAcc = accounts.find(a => a.isDefault) || accounts[0];
    setSelectedAccountKey(defaultAcc.key);
  }, [accounts, selectedAccountKey, desiredAccountIndex]);

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
        // Carry the selected account index so GET_PUBKEY_CONTEXT in the
        // background can scope its response to the right derivation on
        // multi-account EVM chains. Without this the scoping logic always
        // falls back to scoped[0], and Receive shows account 0's address
        // even when the user picked account 2.
        accountIndex: account.accountIndex,
        // UTXO accounts share an accountIndex (BTC has Legacy / Segwit /
        // Native Segwit all under account 0). The script_type is what
        // distinguishes them, so the background's pubkey scoping needs
        // it; without it Receive defaults to the first chainConfig path
        // and ignores the user's header selection. Snake_case to match
        // the field name on raw pubkey objects.
        script_type: account.scriptType,
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

  // The shield badge encodes BOTH home-button and device status: its gradient
  // tints to green when paired, red when errored, gold (brand default) while
  // transient. One glyph, two jobs — no duplicate status indicator elsewhere.
  const shieldStatus = isPaired
    ? {
        tooltip: stateNames[5],
        gradient: 'linear-gradient(135deg, #57ce51 0%, #1f7e24 100%)',
        edge: 'rgba(87,206,81,0.36)',
        pulse: false,
      }
    : keepkeyState === 4
      ? {
          tooltip: stateNames[4],
          gradient: 'linear-gradient(135deg, #e56a4d 0%, #8a2a18 100%)',
          edge: 'rgba(229,106,77,0.36)',
          pulse: false,
        }
      : {
          tooltip: 'connecting…',
          gradient: 'linear-gradient(135deg, #d29929 0%, #6d4a13 100%)',
          edge: 'rgba(210,153,41,0.36)',
          pulse: true,
        };

  return (
    <Box mb={2}>
      <Flex alignItems="center" justifyContent="space-between" gap={2}>
        {/* Left: shield-badge = home button AND device-status indicator */}
        <Tooltip label={shieldStatus.tooltip} placement="bottom" hasArrow>
          <span>
            <ShieldBadge
              onClick={onHome}
              gradient={shieldStatus.gradient}
              edge={shieldStatus.edge}
              pulse={shieldStatus.pulse}
            />
          </span>
        </Tooltip>

        {/* Center: Network + Account dropdowns when ready, wordmark otherwise */}
        {isPaired && hasAssetContext && networks.length > 0 ? (
          <Flex flex={1} alignItems="center" justifyContent="center" gap={2} minW={0}>
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
            <Text fontSize="sm" fontWeight={700} color="kk.text" letterSpacing="-0.1px">
              KeepKey
            </Text>
          </Flex>
        )}

        {/* Right: refresh + settings (status lives in the left shield now) */}
        <Flex alignItems="center" gap={1}>
          <IconButton
            icon={<RepeatIcon />}
            aria-label="Refresh"
            variant="ghost"
            size="sm"
            isLoading={isRefreshing}
            onClick={onRefresh}
          />
          <IconButton
            icon={<SettingsIcon />}
            aria-label="Settings"
            variant="ghost"
            size="sm"
            onClick={onSettingsOpen}
          />
        </Flex>
      </Flex>

      {/* Add Network Modal */}
      <AddNetworkModal isOpen={isNetworkModalOpen} onClose={onNetworkModalClose} onSubmit={handleAddNetwork} />
    </Box>
  );
};

// Gradient shield tile — acts as home button AND device-status indicator.
// Tint comes from the active state (gold / green / red); a soft pulse plays
// while we're still figuring out the state so the user sees "thinking…".
const ShieldBadge = ({
  onClick,
  gradient,
  edge,
  pulse,
}: {
  onClick?: () => void;
  gradient: string;
  edge: string;
  pulse?: boolean;
}) => (
  <Flex
    as={onClick ? 'button' : 'div'}
    onClick={onClick}
    aria-label={onClick ? 'Home' : undefined}
    w="32px"
    h="32px"
    flexShrink={0}
    borderRadius="8px"
    alignItems="center"
    justifyContent="center"
    bgImage={gradient}
    boxShadow={`0 0 0 1px ${edge}, inset 0 1px 0 rgba(255,255,255,0.25), 0 0 14px -4px ${edge}`}
    cursor={onClick ? 'pointer' : 'default'}
    transition="filter 0.15s, transform 0.15s, box-shadow 0.3s"
    sx={pulse ? { animation: 'kk-badge-pulse 1.4s ease-in-out infinite' } : undefined}
    _hover={onClick ? { filter: 'brightness(1.1)' } : {}}
    _active={onClick ? { transform: 'scale(0.95)' } : {}}>
    <style>{`@keyframes kk-badge-pulse { 0%,100% { opacity: 0.7 } 50% { opacity: 1 } }`}</style>
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#0b0d10"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round">
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 8-4-.5-7-3.5-7-8V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  </Flex>
);

export default NetworkAccountHeader;
