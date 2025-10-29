import React, { useState, useEffect } from 'react';
import { Flex, Spinner, Avatar, Box, Text, Badge, Card, Stack, Button } from '@chakra-ui/react';
import AssetSelect from './AssetSelect'; // Import AssetSelect component
import { blockchainDataStorage, blockchainStorage } from '@extension/storage';
import { COIN_MAP_LONG } from '@pioneer-platform/pioneer-coins';
import { NetworkIdToChain } from '@pioneer-platform/pioneer-caip';

const Balances = ({ setShowBack }: any) => {
  // Initialize state with cached data if available
  const getCachedData = (key: string) => {
    try {
      const cached = sessionStorage.getItem(key);
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  };

  const cachedBalances = getCachedData('app_balances');
  const cachedAssets = getCachedData('app_assets');

  const [balances, setBalances] = useState<any[]>(cachedBalances || []);
  const [assets, setAssets] = useState<any[]>(cachedAssets || []);
  const [loading, setLoading] = useState(!cachedBalances || !cachedAssets); // Only show loading if no cached data
  const [showAssetSelect, setShowAssetSelect] = useState(false); // New state to toggle between Balances and AssetSelect
  const [balancesLoaded, setBalancesLoaded] = useState(!!cachedBalances); // Already loaded if we have cached data
  const [loadingAssetId, setLoadingAssetId] = useState<string | null>(null); // Track which asset is being loaded

  // Function to add custom (added) assets
  const addAddedAssets = async () => {
    try {
      const addedAssets = [];
      // Get enabled chains
      const savedChains = await blockchainStorage.getAllBlockchains();

      for (let i = 0; i < savedChains.length; i++) {
        const networkId = savedChains[i];
        const chainName = (COIN_MAP_LONG as any)[(NetworkIdToChain as any)[networkId]] || 'unknown';

        const blockchain = {
          networkId: networkId,
          name: chainName,
          image: `https://pioneers.dev/coins/${chainName}.png`,
          isEnabled: true,
        };

        // If the name is "unknown", fetch additional asset data
        if (chainName === 'unknown') {
          try {
            // Get from storage
            const assetData = await blockchainDataStorage.getBlockchainData(networkId);
            console.log('storage assetData:', assetData);

            if (assetData && assetData.name) {
              blockchain.name = assetData.name;
              blockchain.image = assetData.image || `https://pioneers.dev/coins/${assetData.name.toLowerCase()}.png`;
            }
          } catch (error) {
            console.error(`Error fetching asset data for networkId ${networkId}:`, error);
          }
        }

        const asset = {
          networkId: networkId,
          caip: networkId + '/slip44:60',
          name: blockchain.name,
          icon: blockchain.image,
          manual: true, // Flag to identify custom added assets
        };

        // Push to addedAssets array
        addedAssets.push(asset);
      }
      return addedAssets;
    } catch (e) {
      console.error(e);
      return [];
    }
  };

  // Function to format the balance
  const formatBalance = (balance: string) => {
    try {
      // Parse the balance to ensure it's a valid number
      const numericBalance = parseFloat(balance);

      // If balance is NaN, use 0
      const safeBalance = isNaN(numericBalance) ? '0' : balance;

      const [integer, decimal] = safeBalance.split('.');
      const largePart = decimal?.slice(0, 4) || '0000';
      const smallPart = decimal?.slice(4, 6) || '00';

      return { integer, largePart, smallPart };
    } catch (error) {
      console.error('Error in formatBalance:', error);
      // Fallback to zeroed format
      return { integer: '0', largePart: '0000', smallPart: '00' };
    }
  };

  // Function to format USD value
  const formatUsd = (value: string) => {
    return parseFloat(value).toFixed(2);
  };

  // Remove asset context listener - dashboard should always show all assets
  // No longer listening for asset context changes since we want to always display all assets

  // Add message listener for when returning from asset view
  useEffect(() => {
    const messageListener = (message: any) => {
      if (message.type === 'ASSET_CONTEXT_CLEARED') {
        console.log('Asset context cleared, refreshing balances...');
        setLoadingAssetId(null); // Clear loading state when returning
        // Fetch fresh balances when returning from asset view
        chrome.runtime.sendMessage({ type: 'GET_APP_BALANCES' }, response => {
          if (response && response.balances && response.balances.length > 0) {
            console.log('Refreshed balances: ', response.balances.length);
            setBalances(response.balances);
            // Update session storage
            try {
              sessionStorage.setItem('app_balances', JSON.stringify(response.balances));
            } catch (e) {
              console.error('Failed to store refreshed balances:', e);
            }
          }
        });
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);
    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, []);

  // Fetch assets, balances, and asset context from background script
  useEffect(() => {
    const fetchAssetsAndBalances = async () => {
      // Only show loading if we haven't loaded balances yet
      if (!balancesLoaded) {
        setLoading(true);
      }

      // Dashboard always shows all assets
      setShowBack(false);

      // Fetch assets
      chrome.runtime.sendMessage({ type: 'GET_ASSETS' }, async response => {
        if (chrome.runtime.lastError) {
          console.error('Error fetching assets:', chrome.runtime.lastError.message);
          setLoading(false);
          return;
        }
        if (response && response.assets) {
          console.log(response.assets);

          const addedAssets = await addAddedAssets();

          // Log for debugging
          console.log('Default assets:', response.assets);
          console.log('Added assets:', addedAssets);

          // Create a Map to track unique assets by networkId
          const assetMap = new Map();

          // Add default assets first
          response.assets.forEach((asset: any) => {
            console.log('Adding default asset:', asset.name, 'networkId:', asset.networkId);
            assetMap.set(asset.networkId, asset);
          });

          // Only add custom assets that don't already exist
          addedAssets.forEach((asset: any) => {
            console.log('Checking added asset:', asset.name, 'networkId:', asset.networkId);
            if (!assetMap.has(asset.networkId)) {
              console.log('Adding custom asset:', asset.name);
              assetMap.set(asset.networkId, asset);
            } else {
              console.log('Skipping duplicate:', asset.name, 'networkId already exists');
            }
          });

          // Convert Map back to array
          const combined = Array.from(assetMap.values());
          console.log('Combined assets count:', combined.length);
          setAssets(combined);
          // Store assets in session storage
          try {
            sessionStorage.setItem('app_assets', JSON.stringify(combined));
          } catch (e) {
            console.error('Failed to store assets:', e);
          }
        } else {
          console.error('Error: No assets found in the response');
          // Try to restore cached assets
          try {
            const cachedAssets = sessionStorage.getItem('app_assets');
            if (cachedAssets) {
              const parsed = JSON.parse(cachedAssets);
              console.log('Using cached assets:', parsed.length);
              setAssets(parsed);
            }
          } catch (e) {
            console.error('Failed to retrieve cached assets:', e);
          }
        }
      });

      // Fetch balances
      chrome.runtime.sendMessage({ type: 'GET_APP_BALANCES' }, response => {
        if (chrome.runtime.lastError) {
          console.error('Error fetching balances:', chrome.runtime.lastError.message);
          setLoading(false);
          return;
        }
        if (response && response.balances && response.balances.length > 0) {
          console.log('Balances: ', response.balances.length);
          console.log('Sample balance structure:', response.balances[0]);
          console.log(
            'Bitcoin balances:',
            response.balances.filter(b => b.symbol === 'BTC' || b.name?.toLowerCase().includes('bitcoin')),
          );

          // Check if we have fewer balances than assets (might indicate incomplete data)
          if (assets.length > 0 && response.balances.length < assets.length / 2) {
            console.log('Balances seem incomplete, refreshing all...');
            // Try to refresh all balances
            chrome.runtime.sendMessage({ type: 'REFRESH_ALL_BALANCES' }, refreshResponse => {
              if (refreshResponse && refreshResponse.balances && refreshResponse.balances.length > 0) {
                console.log('Refreshed all balances:', refreshResponse.balances.length);
                setBalances(refreshResponse.balances);
                setBalancesLoaded(true);
                try {
                  sessionStorage.setItem('app_balances', JSON.stringify(refreshResponse.balances));
                } catch (e) {
                  console.error('Failed to store refreshed balances:', e);
                }
              } else {
                // Use the original response if refresh failed
                setBalances(response.balances);
                setBalancesLoaded(true);
                try {
                  sessionStorage.setItem('app_balances', JSON.stringify(response.balances));
                } catch (e) {
                  console.error('Failed to store balances:', e);
                }
              }
            });
          } else {
            setBalances(response.balances);
            setBalancesLoaded(true);
            // Store balances in session storage as backup
            try {
              sessionStorage.setItem('app_balances', JSON.stringify(response.balances));
            } catch (e) {
              console.error('Failed to store balances in session storage:', e);
            }
          }
        } else if (!balancesLoaded) {
          // Only use cached balances if we haven't loaded fresh ones yet
          console.log('No fresh balances, checking cache...');
          try {
            const cachedBalances = sessionStorage.getItem('app_balances');
            if (cachedBalances) {
              const parsed = JSON.parse(cachedBalances);
              console.log('Using cached balances:', parsed.length);
              setBalances(parsed);
            } else {
              console.error('No cached balances available');
              // Try to refresh all balances
              chrome.runtime.sendMessage({ type: 'REFRESH_ALL_BALANCES' }, refreshResponse => {
                if (refreshResponse && refreshResponse.balances) {
                  console.log('Fetched fresh balances:', refreshResponse.balances.length);
                  setBalances(refreshResponse.balances);
                  setBalancesLoaded(true);
                  try {
                    sessionStorage.setItem('app_balances', JSON.stringify(refreshResponse.balances));
                  } catch (e) {
                    console.error('Failed to store fresh balances:', e);
                  }
                }
              });
            }
          } catch (e) {
            console.error('Failed to retrieve cached balances:', e);
          }
        }

        setLoading(false);
      });

      // Don't fetch asset context - dashboard should always show all assets
    };

    // Call the function to fetch data on component mount and when returning to this view
    fetchAssetsAndBalances();
  }, [balancesLoaded, setShowBack]);

  const onSelect = (asset: any) => {
    console.log('Asset selected:', asset);
    setLoadingAssetId(asset.caip); // Set loading state for this specific asset

    try {
      // Store current balances before switching views
      if (balances && balances.length > 0) {
        try {
          sessionStorage.setItem('app_balances', JSON.stringify(balances));
          sessionStorage.setItem('app_assets', JSON.stringify(assets));
        } catch (e) {
          console.error('Failed to store data before navigation:', e);
        }
      }

      chrome.runtime.sendMessage(
        {
          type: 'SET_ASSET_CONTEXT',
          asset,
        },
        response => {
          if (chrome.runtime.lastError) {
            console.error('Error sending message:', chrome.runtime.lastError);
            setLoadingAssetId(null); // Clear loading state on error
          }
          console.log('SET_ASSET_CONTEXT response: ', response);
          if (response && response.error) {
            console.error('Error setting asset context:', response.error);
            setLoadingAssetId(null); // Clear loading state on error
          } else {
            console.log('Asset context set successfully:', response);
            // Don't clear loading here - let the navigation clear it
          }
        },
      );
    } catch (e) {
      console.error(e);
      setLoadingAssetId(null); // Clear loading state on error
    }
  };

  // Always show all assets - no filtering
  const sortedAssets = [...assets].sort((a: any, b: any) => {
    // Find balance for asset A
    let balanceA = balances.find(balance => balance.caip === a.caip);
    if (!balanceA && a.networkId) {
      balanceA = balances.find(b => b.networkId === a.networkId && b.isNative === true);
    }

    // Find balance for asset B
    let balanceB = balances.find(balance => balance.caip === b.caip);
    if (!balanceB && b.networkId) {
      balanceB = balances.find(b => b.networkId === b.networkId && b.isNative === true);
    }

    // Calculate total USD value for the entire chain (including tokens)
    const chainBalancesA = balances.filter(b => b.networkId === a.networkId);
    const chainBalancesB = balances.filter(b => b.networkId === b.networkId);

    const valueUsdA = chainBalancesA.reduce((sum, b) => sum + parseFloat(b.valueUsd || '0'), 0);
    const valueUsdB = chainBalancesB.reduce((sum, b) => sum + parseFloat(b.valueUsd || '0'), 0);

    // Sort in descending order by total USD value (highest to lowest)
    return valueUsdB - valueUsdA;
  });

  if (showAssetSelect) {
    // setShowBack(true)
    // If showAssetSelect is true, render the AssetSelect component
    return <AssetSelect setShowBack={setShowBack} setShowAssetSelect={setShowAssetSelect} />;
  }

  return (
    <Flex flex="1" overflowY="auto" width="100%">
      <Stack width="100%">
        {loading ? (
          <Flex justifyContent="center" alignItems="center" width="100%">
            <Spinner size="xl" />
            Loading....
          </Flex>
        ) : (
          <>
            {sortedAssets.length === 0 ? (
              <Flex justifyContent="center" alignItems="center" width="100%">
                <Text>No assets found</Text>
              </Flex>
            ) : (
              sortedAssets.map((asset: any, index: any) => {
                // Get all balances for this chain
                const chainBalances = balances.filter(b => b.networkId === asset.networkId);
                const totalUsdValue = chainBalances.reduce((sum, b) => sum + parseFloat(b.valueUsd || '0'), 0);
                const tokenCount = chainBalances.filter(b => !b.isNative).length;

                // For native assets, sum up all balances across different addresses
                const nativeBalances = chainBalances.filter(b => b.isNative === true || b.caip === asset.caip);

                let totalBalance = '0';
                if (nativeBalances.length > 0) {
                  // Sum all balances for this asset (handles multiple addresses)
                  const sum = nativeBalances.reduce((acc, b) => {
                    const bal = parseFloat(b.balance || '0');
                    return acc + bal;
                  }, 0);
                  totalBalance = sum.toString();
                } else {
                  // Fallback: try to find exact match
                  const balance = balances.find(b => b.caip === asset.caip);
                  totalBalance = balance?.balance || '0';
                }

                const { integer, largePart, smallPart } = formatBalance(totalBalance);

                return (
                  <Card key={index} borderRadius="md" p={4} mb={1} width="100%">
                    <Flex align="center" width="100%">
                      <Avatar src={asset.icon} />
                      <Box ml={3} flex="1" minWidth="0">
                        <Text fontWeight="bold" isTruncated>
                          {asset.name} {asset.manual && <Badge colorScheme="purple">Added Asset</Badge>}
                        </Text>

                        {asset.manual ? (
                          // For custom added assets
                          <>
                            <Text color="gray.500">Click to view balance</Text>
                          </>
                        ) : (
                          // For regular assets with balance
                          <>
                            <Text as="span" fontSize="lg">
                              {integer}.
                              <Text as="span" fontSize="lg">
                                {largePart}
                              </Text>
                              {largePart === '0000' && (
                                <Text as="span" fontSize="sm">
                                  {smallPart}
                                </Text>
                              )}
                              <Badge ml={2} colorScheme="teal">
                                {asset.symbol}
                              </Badge>
                              <br />
                              {/*<Badge colorScheme="green">USD {formatUsd(balance?.valueUsd || '0.00')}</Badge>*/}
                              <Badge colorScheme="green">USD {formatUsd(totalUsdValue.toString())}</Badge>
                              {/*{tokenCount > 1 && <Text fontSize="sm">Tokens: {tokenCount}</Text>}*/}
                              {/*{tokenCount > 1 && <Text fontSize="sm" color="gray.500">Tokens: {tokenCount}</Text>}*/}
                            </Text>
                          </>
                        )}
                      </Box>
                      <Button
                        ml="auto"
                        onClick={() => onSelect(asset)}
                        size="md"
                        isLoading={loadingAssetId === asset.caip}
                        loadingText="Loading..."
                        disabled={loadingAssetId !== null}>
                        Select
                      </Button>
                    </Flex>
                  </Card>
                );
              })
            )}

            {/* Add Blockchain Placeholder */}
            <Card borderRadius="md" p={4} mb={1} width="100%" bg="gray.100" border="2px dashed teal">
              <Flex align="center" width="100%" justifyContent="center">
                <Button colorScheme="teal" size="lg" onClick={() => setShowAssetSelect(true)}>
                  Add Blockchain
                </Button>
              </Flex>
            </Card>
          </>
        )}
      </Stack>
    </Flex>
  );
};

export default Balances;
