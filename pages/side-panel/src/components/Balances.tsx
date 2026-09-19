import React, { useState, useEffect } from 'react';
import { Flex, Box, Text, Stack } from '@chakra-ui/react';
import { AddIcon } from '@chakra-ui/icons';
import { AssetIcon } from './AssetIcon';
import { HairlineRow, SkeletonRows } from './v2/primitives';
import { getChainDisplayName } from './chainDisplay';
import { SpinningDevice } from './SpinningDevice';
import AssetSelect from './AssetSelect';

interface BalancesProps {
  onSelectAsset: (asset: any) => void;
  /** Controlled by SidePanel so the home button + dashboard-gating can see it. */
  showAddBlockchain: boolean;
  setShowAddBlockchain: (show: boolean) => void;
}

const Balances = ({ onSelectAsset, showAddBlockchain, setShowAddBlockchain }: BalancesProps) => {
  const [balances, setBalances] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const formatBalance = (balance: string) => {
    const numericBalance = parseFloat(balance);
    const safeBalance = isNaN(numericBalance) ? '0' : balance;
    const [integer, decimal] = safeBalance.split('.');
    const largePart = decimal?.slice(0, 4) || '0000';
    const smallPart = decimal?.slice(4, 6) || '00';
    return { integer, largePart, smallPart };
  };

  const formatUsd = (value: string) => parseFloat(value).toFixed(2);

  // Fetch assets once; refresh balances on mount and on background BALANCES_UPDATED push
  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_ASSETS' }, response => {
      if (response?.assets) setAssets(response.assets);
    });

    const refreshBalances = () => {
      chrome.runtime.sendMessage({ type: 'GET_APP_BALANCES' }, response => {
        if (response?.balances) setBalances(response.balances);
        setFetchError(response?.error ?? null);
        setLoading(false);
      });
    };

    refreshBalances();

    // Cold-start: background may land Solana + SPL tokens after the panel
    // mounts and paints a pre-Solana snapshot. Listen for BALANCES_UPDATED
    // pushes so the UI reflects the latest cache without the user having to
    // refresh manually.
    const listener = (message: any) => {
      if (message?.type === 'BALANCES_UPDATED') refreshBalances();
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  // Drive the dashboard from HOLDINGS, not the full static catalog: a chain
  // shows only if it has a positive balance (native or token). Keying off the
  // balance AMOUNT — not USD value — keeps a held asset visible even when its
  // price is missing/0. The complete catalog stays one tap away via
  // "+ Add blockchain", so empty chains no longer render as $0.00 rows.
  const heldNetworkIds = new Set(
    balances.filter(bal => parseFloat(bal.balance ?? bal.amount ?? '0') > 0).map(bal => bal.networkId),
  );
  const sortedAssets = [...assets]
    .filter((asset: any) => heldNetworkIds.has(asset.networkId))
    .sort((assetA: any, assetB: any) => {
      const valueA = balances
        .filter(bal => bal.networkId === assetA.networkId)
        .reduce((s, bal) => s + parseFloat(bal.valueUsd || '0'), 0);
      const valueB = balances
        .filter(bal => bal.networkId === assetB.networkId)
        .reduce((s, bal) => s + parseFloat(bal.valueUsd || '0'), 0);
      return valueB - valueA;
    });

  // Force-refresh after a failed load. REFRESH_ALL_BALANCES bypasses the cache.
  const retryFetch = () => {
    setLoading(true);
    setFetchError(null);
    chrome.runtime.sendMessage({ type: 'REFRESH_ALL_BALANCES' }, response => {
      if (response?.balances) setBalances(response.balances);
      setFetchError(response?.error ?? null);
      setLoading(false);
    });
  };

  if (showAddBlockchain) {
    return <AssetSelect setShowAssetSelect={setShowAddBlockchain} />;
  }

  if (loading) {
    // v2 loading state (KEEPKEY_STYLE.md §5, §6): the device hero keeps the
    // wait honest — it is the thing being read from — over skeletons that
    // share the real rows' geometry, so nothing shifts when balances land.
    // The shimmer keyframes are global (index.css); redefining them here at a
    // different duration would silently override the spec'd 1.4s linear.
    return (
      <Flex direction="column" width="100%" flex="1" overflow="hidden">
        <Flex direction="column" align="center" gap={3} pt={2} pb={5}>
          <SpinningDevice scale={0.36} durationSeconds={11} label="FETCHING" />
          <Text className="kk-eyebrow">Fetching balances</Text>
        </Flex>
        <SkeletonRows count={5} />
      </Flex>
    );
  }

  return (
    <Flex flex="1" overflowY="auto" width="100%" direction="column">
      <Stack width="100%">
        {sortedAssets.length === 0 ? (
          fetchError ? (
            <Flex direction="column" justifyContent="center" alignItems="center" gap={3} width="100%" minH="30vh">
              <Text color="kk.text" fontSize="sm" fontWeight="medium">
                Couldn’t load balances
              </Text>
              <Text color="kk.faint" fontSize="xs" textAlign="center" maxW="240px">
                {fetchError}
              </Text>
              <Flex
                align="center"
                justify="center"
                gap={1.5}
                px={5}
                py={2}
                borderRadius="12px"
                border="1px solid"
                borderColor="kk.lineHi"
                _hover={{ bg: 'kk.surfaceHi', cursor: 'pointer' }}
                onClick={retryFetch}
                transition="background 0.15s">
                <Text color="kk.text" fontSize="xs">
                  Retry
                </Text>
              </Flex>
            </Flex>
          ) : (
            <Flex direction="column" justifyContent="center" alignItems="center" gap={4} width="100%" minH="30vh">
              <Text color="kk.faint" fontSize="sm">
                No assets yet — receive funds to get started
              </Text>
              <Flex
                align="center"
                justify="center"
                gap={1.5}
                px={4}
                py={2}
                borderRadius="12px"
                border="1px dashed"
                borderColor="kk.line"
                _hover={{ borderColor: 'kk.lineHi', cursor: 'pointer' }}
                onClick={() => setShowAddBlockchain(true)}
                transition="border-color 0.15s">
                <Text color="kk.faint" fontSize="xs">
                  + Add blockchain
                </Text>
              </Flex>
            </Flex>
          )
        ) : (
          <>
            {sortedAssets.map((asset: any, index: number) => {
              const chainBalances = balances.filter(b => b.networkId === asset.networkId);
              const totalUsdValue = chainBalances.reduce((sum, b) => sum + parseFloat(b.valueUsd || '0'), 0);

              const nativeBalances = chainBalances.filter(b => b.isNative === true || b.caip === asset.caip);
              let totalBalance = '0';
              if (nativeBalances.length > 0) {
                totalBalance = nativeBalances.reduce((acc, b) => acc + parseFloat(b.balance || '0'), 0).toString();
              } else {
                const balance = balances.find(b => b.caip === asset.caip);
                totalBalance = balance?.balance || '0';
              }

              const { integer, largePart, smallPart } = formatBalance(totalBalance);
              const chainName = getChainDisplayName(asset.networkId);

              // v2 rows (KEEPKEY_STYLE.md §0): 60px, 28px logo, hairline
              // divider, no card. The chain name only earns a place in the
              // sub-line when it differs from the asset name — on an L2 the
              // shared "ETH" ticker is otherwise ambiguous (§5).
              const qty = `${integer}.${largePart}${largePart === '0000' ? smallPart : ''}`;
              const subtitle =
                chainName && chainName !== asset.name
                  ? `${qty} ${asset.symbol} · ${chainName}`
                  : `${qty} ${asset.symbol}`;

              return (
                <HairlineRow
                  key={asset.caip || asset.networkId || index}
                  icon={<AssetIcon src={asset.icon} symbol={asset.symbol} size={28} />}
                  title={asset.name}
                  subtitle={subtitle}
                  value={`$${formatUsd(totalUsdValue.toString())}`}
                  delayMs={index * 50}
                  onClick={() => onSelectAsset(asset)}
                />
              );
            })}

            <Box
              as="button"
              onClick={() => setShowAddBlockchain(true)}
              height="48px"
              border={0}
              background="transparent"
              color="kk.faint"
              fontSize="11px"
              className="mono"
              letterSpacing="0.1em"
              cursor="pointer"
              display="flex"
              alignItems="center"
              gap="8px"
              padding="0 2px"
              _hover={{ color: 'kk.accent' }}>
              <AddIcon boxSize="10px" />
              <span>ADD A CHAIN</span>
            </Box>
          </>
        )}
      </Stack>
    </Flex>
  );
};

export default Balances;
