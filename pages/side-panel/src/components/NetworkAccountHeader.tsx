import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Flex, Box, IconButton, useToast, useDisclosure } from '@chakra-ui/react';
import DeviceReadout from './v2/DeviceReadout';
import { SettingsIcon, RepeatIcon } from '@chakra-ui/icons';
import { NetworkIdToChain } from '@extension/shared';

import type { NetworkItem, AccountItem, CustomEvmNetwork, NetworkAccountHeaderProps } from './header/headerTypes';
import { getChainFamily, buildNetworkList, buildAccountList, supportsMultiAccount } from './header/headerUtils';
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
  // restored account instead of snapping back to the default. Note is
  // checked first because UTXO chains (BTC) have multiple accounts at
  // accountIndex 0 distinguished only by script_type — accountIndex
  // alone restores to the wrong row (legacy when user wanted Native
  // Segwit). script_type is a fallback for callers that didn't emit a
  // note.
  const [desiredAccountIndex, setDesiredAccountIndex] = useState<number | null>(null);
  const [desiredNote, setDesiredNote] = useState<string | null>(null);
  const [desiredScriptType, setDesiredScriptType] = useState<string | null>(null);
  const toast = useToast();

  const { isOpen: isNetworkModalOpen, onOpen: onNetworkModalOpen, onClose: onNetworkModalClose } = useDisclosure();

  const isPaired = keepkeyState === 5;

  // Derived data
  const networks = useMemo(() => buildNetworkList(pubkeys, customEvmNetworks), [pubkeys, customEvmNetworks]);

  const accounts = useMemo(
    () => (selectedNetworkId ? buildAccountList(pubkeys, selectedNetworkId, ethAccounts) : []),
    [pubkeys, selectedNetworkId, ethAccounts],
  );

  const canAddAccount = supportsMultiAccount(selectedNetworkId);

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
            // GET_APP_PUBKEYS already includes the vault-sourced Hive pubkey
            // (injected background-side), so no per-component merge here.
            setPubkeys(response.balances);

            // Restore selection from stored asset context. Carries
            // note + script_type + accountIndex so multi-account EVM
            // picks AND multi-script BTC picks survive a reload —
            // without all three the auto-select effect snaps back to
            // the first chainConfig path on the network.
            chrome.runtime.sendMessage({ type: 'GET_ASSET_CONTEXT' }, ctxResponse => {
              const stored = ctxResponse?.assets;
              if (stored?.networkId) {
                setSelectedNetworkId(stored.networkId);
                setHasAssetContext(true);
                if (stored.note) setDesiredNote(stored.note);
                if (stored.script_type) setDesiredScriptType(stored.script_type);
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
        const ctx = message.assetContext;
        setSelectedNetworkId(ctx.networkId);
        setHasAssetContext(true);
        // Feed desired* so the auto-select effect can re-target if the
        // stored context now points to a different account on the same
        // network. The effect compares against the current
        // selectedAccountKey and is a no-op when the selection already
        // matches, so this doesn't loop on the broadcast that fires
        // back from our own SET_ASSET_CONTEXT.
        setDesiredNote(ctx.note ?? null);
        setDesiredScriptType(ctx.script_type ?? null);
        setDesiredAccountIndex(ctx.accountIndex !== undefined && ctx.accountIndex !== null ? ctx.accountIndex : null);
      }
      if (message.type === 'ASSET_CONTEXT_CLEARED') {
        setSelectedNetworkId(null);
        setSelectedAccountKey(null);
        setHasAssetContext(false);
        setDesiredNote(null);
        setDesiredScriptType(null);
        setDesiredAccountIndex(null);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [fetchPubkeys]);

  // Pure data setter — sends SET_ASSET_CONTEXT and updates local
  // hasAssetContext. Returns the asset object so click handlers can
  // pass it to onSelectNetwork. Side-effects (drawer-open) live in the
  // click handlers, NOT here, so the auto-default effect can call this
  // without triggering an unprompted AssetDetail drawer on cold start.
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
        // Native Segwit all under account 0), and multiple paths can
        // share a script_type (BTC account 0 and account 1 are both
        // p2wpkh). Note is unique per chainConfig path, so it's what the
        // background uses to scope GET_PUBKEY_CONTEXT exactly. Send
        // all three: GET_PUBKEY_CONTEXT prefers note, falls back to
        // script_type / accountIndex.
        script_type: account.scriptType,
        note: account.note,
      };
      chrome.runtime.sendMessage({ type: 'SET_ASSET_CONTEXT', asset });
      setHasAssetContext(true);
      return asset;
    },
    [networks],
  );

  // Network selected — user-initiated, opens AssetDetail.
  const handleNetworkSelect = useCallback(
    (net: NetworkItem) => {
      setSelectedNetworkId(net.networkId);
      const accts = buildAccountList(pubkeys, net.networkId, ethAccounts);
      const defaultAcc = accts.find(a => a.isDefault) || accts[0];
      if (defaultAcc) {
        setSelectedAccountKey(defaultAcc.key);
        const asset = setAssetContext(net.networkId, defaultAcc);
        if (onSelectNetwork) onSelectNetwork(asset);
      }
    },
    [pubkeys, ethAccounts, setAssetContext, onSelectNetwork],
  );

  // Account selected — user-initiated, opens AssetDetail.
  const handleAccountSelect = useCallback(
    (account: AccountItem) => {
      setSelectedAccountKey(account.key);
      if (selectedNetworkId) {
        const asset = setAssetContext(selectedNetworkId, account);
        if (onSelectNetwork) onSelectNetwork(asset);
      }
    },
    [selectedNetworkId, setAssetContext, onSelectNetwork],
  );

  // Auto-select an account when accounts/desired identifiers change.
  // Priority:
  //   1. Restore target by note (unique per chainConfig path)
  //   2. Restore target by script_type (UTXO fallback if note missing)
  //   3. Restore target by accountIndex (multi-account EVM)
  //   4. Current selection if still valid (no desired* set)
  //   5. isDefault → first account
  //
  // Also pushes SET_ASSET_CONTEXT so the stored asset matches the
  // dropdown — but only when the chosen key actually changes, otherwise
  // the ASSET_CONTEXT_UPDATED broadcast that comes back would feed
  // desired* and re-fire the effect indefinitely. The `silent` style
  // for setAssetContext (it no longer calls onSelectNetwork) keeps
  // this auto-default from opening AssetDetail unprompted.
  useEffect(() => {
    if (accounts.length === 0) return;

    const target =
      (desiredNote && accounts.find(a => a.note === desiredNote)) ||
      (desiredScriptType && accounts.find(a => a.scriptType === desiredScriptType)) ||
      (desiredAccountIndex !== null && accounts.find(a => a.accountIndex === desiredAccountIndex)) ||
      null;

    if (target) {
      // Always clear desired* (one-shot), only push to background when
      // the account actually changes.
      const changed = target.key !== selectedAccountKey;
      if (changed) {
        setSelectedAccountKey(target.key);
        if (selectedNetworkId) setAssetContext(selectedNetworkId, target);
      }
      if (desiredNote !== null) setDesiredNote(null);
      if (desiredScriptType !== null) setDesiredScriptType(null);
      if (desiredAccountIndex !== null) setDesiredAccountIndex(null);
      return;
    }

    // No desired* targets — keep the current selection if it's still in
    // the rebuilt accounts list, otherwise fall back to the default.
    if (selectedAccountKey && accounts.find(a => a.key === selectedAccountKey)) return;

    const defaultAcc = accounts.find(a => a.isDefault) || accounts[0];
    if (defaultAcc) {
      setSelectedAccountKey(defaultAcc.key);
      if (selectedNetworkId) setAssetContext(selectedNetworkId, defaultAcc);
    }
  }, [
    accounts,
    selectedAccountKey,
    desiredNote,
    desiredScriptType,
    desiredAccountIndex,
    selectedNetworkId,
    setAssetContext,
  ]);

  // Account add/remove. EVM dispatches to ADD_ETH_ACCOUNT / REMOVE_ETH_ACCOUNT
  // (cross-chain ethAccountsStorage); other supported families (non-Bitcoin
  // UTXO, Cosmos, Solana) dispatch to the per-network ADD_ACCOUNT / REMOVE_ACCOUNT
  // handlers keyed by networkId.
  const handleAddAccount = useCallback(() => {
    if (!selectedNetworkId) return;
    setIsAddingAccount(true);
    const isEvm = selectedNetworkId.startsWith('eip155:');
    const nextIndex = isEvm ? Math.max(...ethAccounts) + 1 : Math.max(0, ...accounts.map(a => a.accountIndex ?? 0)) + 1;
    const msg = isEvm
      ? { type: 'ADD_ETH_ACCOUNT', accountIndex: nextIndex }
      : { type: 'ADD_ACCOUNT', networkId: selectedNetworkId, accountIndex: nextIndex };
    chrome.runtime.sendMessage(msg, response => {
      setIsAddingAccount(false);
      if (response?.success) {
        if (isEvm && response.accounts) setEthAccounts(response.accounts);
        toast({ title: `Account ${nextIndex} added`, status: 'success', duration: 2000 });
        fetchPubkeys();
      } else {
        toast({ title: 'Failed to add account', description: response?.error, status: 'error', duration: 3000 });
      }
    });
  }, [selectedNetworkId, ethAccounts, accounts, fetchPubkeys, toast]);

  const handleRemoveAccount = useCallback(
    (index: number) => {
      if (index === 0 || !selectedNetworkId) return;
      const isEvm = selectedNetworkId.startsWith('eip155:');
      const msg = isEvm
        ? { type: 'REMOVE_ETH_ACCOUNT', accountIndex: index }
        : { type: 'REMOVE_ACCOUNT', networkId: selectedNetworkId, accountIndex: index };
      chrome.runtime.sendMessage(msg, response => {
        if (response?.success) {
          if (isEvm && response.accounts) setEthAccounts(response.accounts);
          toast({ title: `Account ${index} removed`, status: 'info', duration: 2000 });
          fetchPubkeys();
        } else {
          toast({ title: 'Failed to remove account', description: response?.error, status: 'error', duration: 3000 });
        }
      });
    },
    [selectedNetworkId, fetchPubkeys, toast],
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
        {/* Left: device readout = home button AND device-status indicator.
            v2 retires the gradient shield (KEEPKEY_STYLE.md §0) — an 8px LED
            plus a mono label says which device and what state in one line,
            and leaves the header room for the chain/account pills. */}
        <DeviceReadout state={keepkeyState} onClick={onHome} />

        {/* Spacer — the header is `minmax(0,1fr) auto` (readout | icons). The
            chain/account pills deliberately do NOT live here; see the sub-bar
            below. */}
        <Box flex={1} minW={0} />

        {/* Right: refresh + settings (status lives in the left readout now) */}
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

      {/* Sub-bar: chain + account (KEEPKEY_STYLE.md §0 / design "Dashboard").
          These sit on their own 40px row rather than in the 56px header —
          readout, two pills and two icon buttons on one line leaves the
          readout fighting for width at 400px, and the pills are context for
          the screen below, not for the device. Account sits left and chain
          right, matching the design. */}
      {isPaired && hasAssetContext && networks.length > 0 && (
        <Flex
          alignItems="center"
          justifyContent="space-between"
          gap={2}
          height="40px"
          mt={1}
          borderTop="1px solid"
          borderColor="kk.line"
          minW={0}>
          <AccountDropdown
            accounts={accounts}
            selectedAccountKey={selectedAccountKey}
            onSelect={handleAccountSelect}
            canAddAccount={canAddAccount}
            onAddAccount={handleAddAccount}
            isAddingAccount={isAddingAccount}
            onRemoveAccount={canAddAccount ? handleRemoveAccount : undefined}
          />
          <NetworkDropdown
            networks={networks}
            selectedNetworkId={selectedNetworkId}
            onSelect={handleNetworkSelect}
            onAddNetwork={onNetworkModalOpen}
            onRemoveNetwork={handleRemoveNetwork}
          />
        </Flex>
      )}

      {/* Add Network Modal */}
      <AddNetworkModal isOpen={isNetworkModalOpen} onClose={onNetworkModalClose} onSubmit={handleAddNetwork} />
    </Box>
  );
};

export default NetworkAccountHeader;
