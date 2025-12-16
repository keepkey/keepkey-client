import 'webextension-polyfill';
// Process polyfill for browser environment
import '../polyfills/process';
// Buffer polyfill for browser environment
import { Buffer } from 'buffer';
globalThis.Buffer = Buffer;

import packageJson from '../../package.json'; // Adjust the path as needed
import { onStartKeepkey } from './keepkey';
import { handleWalletRequest } from './methods';
// import { listenForApproval } from './approvals';
import { JsonRpcProvider } from 'ethers';
import { ChainToNetworkId, Chain } from '@pioneer-platform/pioneer-caip';
import { requestStorage, exampleSidebarStorage, web3ProviderStorage, blockchainDataStorage } from '@extension/storage'; // Re-import the storage
import { EIP155_CHAINS } from './chains';
import axios from 'axios';

const TAG = ' | background/index.js | ';
console.log('Background script loaded');
console.log('Version:', packageJson.version);

const KEEPKEY_STATES = {
  0: 'unknown',
  1: 'disconnected',
  2: 'connected',
  3: 'busy',
  4: 'errored',
  5: 'paired',
};
let KEEPKEY_STATE = 0;

function updateIcon() {
  let iconPath = './icon-128.png';
  // Show green/online icon when connected (state 2) or paired (state 5)
  if (KEEPKEY_STATE === 2 || KEEPKEY_STATE === 5) iconPath = './icon-128-online.png';

  chrome.action.setIcon({ path: iconPath }, () => {
    if (chrome.runtime.lastError) {
      console.error('Error setting icon:', chrome.runtime.lastError);
    }
  });
}

function pushStateChangeEvent() {
  chrome.runtime.sendMessage({
    type: 'KEEPKEY_STATE_CHANGED',
    state: KEEPKEY_STATE,
  });
}

async function checkKeepKey() {
  try {
    const response = await axios.get('http://localhost:1646/docs');
    if (response.status === 200) {
      updateIcon();
      if (KEEPKEY_STATE < 2) {
        KEEPKEY_STATE = 2; // Set state to connected
        pushStateChangeEvent();
      }
    }
  } catch (error) {
    console.error('KeepKey endpoint not found:', error);
    KEEPKEY_STATE = 4; // Set state to errored
    updateIcon();
    pushStateChangeEvent();
  }
}

// Call checkKeepKey every 5 seconds
setInterval(checkKeepKey, 5000);

updateIcon();
console.log('Background loaded');

const provider = new JsonRpcProvider(EIP155_CHAINS['eip155:1'].rpc);

let ADDRESS = '';
let APP: any = null;

const onStart = async function () {
  const tag = TAG + ' | onStart | ';
  try {
    console.log(tag, 'Starting...');
    APP = await onStartKeepkey();
    console.log(tag, 'APP:', APP);
    if (!APP) throw Error('Failed to INIT!');

    console.log(tag, 'APP.balances: ', APP.balances);
    console.log(tag, 'APP.pubkeys: ', APP.pubkeys);

    // AUTO-SAVE: Cache pubkeys after successful pairing
    if (APP && APP.pubkeys && APP.pubkeys.length > 0) {
      const { pubkeyStorage } = await import('@extension/storage');

      try {
        const deviceInfo = {
          label: APP.keepKeySdk?.device?.label || 'KeepKey',
          model: APP.keepKeySdk?.device?.model || 'KeepKey',
          deviceId: APP.keepKeySdk?.device?.deviceId || 'unknown',
          features: APP.keepKeySdk?.device?.features,
        };

        const saved = await pubkeyStorage.savePubkeys(APP.pubkeys, deviceInfo);
        if (saved) {
          console.log('✅ Cached', APP.pubkeys.length, 'pubkeys for view-only mode');
        }
      } catch (error) {
        console.error('⚠️ Failed to cache pubkeys:', error);
      }
    }

    // Run migration check once per session
    const { pubkeyStorage: migrationStorage } = await import('@extension/storage');
    try {
      const migrated = await migrationStorage.migrateFromVault();
      if (migrated) {
        console.log('✅ Successfully migrated pubkeys from vault');
      }
    } catch (error) {
      console.warn('⚠️ Migration check failed (normal if vault not installed):', error);
    }

    // Fetch balances for all available networks
    if (APP.balances && APP.balances.length === 0) {
      console.log(tag, 'No initial balances, fetching all network balances...');
      try {
        // Get unique network IDs from pubkeys
        const networkIds = new Set<string>();
        APP.pubkeys.forEach((pubkey: any) => {
          if (pubkey.networks && Array.isArray(pubkey.networks)) {
            pubkey.networks.forEach((networkId: string) => networkIds.add(networkId));
          }
        });

        console.log(tag, 'Found networks to fetch balances for:', Array.from(networkIds));

        // Fetch balances for each network and accumulate them
        const allBalances: any[] = [];
        for (const networkId of networkIds) {
          try {
            await APP.getBalance(networkId);
            // After each fetch, collect the balances
            if (APP.balances && APP.balances.length > 0) {
              APP.balances.forEach((balance: any) => {
                // Only add if not already in allBalances
                if (!allBalances.find((b: any) => b.caip === balance.caip)) {
                  allBalances.push(balance);
                }
              });
            }
          } catch (e) {
            console.error(tag, `Failed to fetch balance for ${networkId}:`, e);
          }
        }

        // Set all accumulated balances
        if (allBalances.length > 0) {
          APP.balances = allBalances;
        }

        console.log(tag, 'Finished fetching all balances, total:', APP.balances?.length);
      } catch (e) {
        console.error(tag, 'Error fetching initial balances:', e);
      }
    }

    // Discover tokens for all networks
    console.log(tag, 'Discovering tokens via APP.getCharts()...');
    try {
      await APP.getCharts();
      console.log(tag, 'Token discovery complete, total balances:', APP.balances?.length);
    } catch (e) {
      console.error(tag, 'Error discovering tokens:', e);
    }

    const pubkeysEth = APP.pubkeys.filter((e: any) => e.networks.includes(ChainToNetworkId[Chain.Ethereum]));
    if (pubkeysEth.length > 0) {
      console.log(tag, 'pubkeys:', pubkeysEth);
      const address = pubkeysEth[0].address;
      if (address) {
        console.log(tag, 'Ethereum address:', address);
        ADDRESS = address;
        KEEPKEY_STATE = 5;
        updateIcon();
        pushStateChangeEvent();
      }

      const defaultProvider: any = {
        chainId: '0x1',
        caip: 'eip155:1/slip44:60',
        blockExplorerUrls: ['https://etherscan.io'],
        name: 'Ethereum',
        providerUrl: 'https://eth.llamarpc.com',
        fallbacks: [],
      };
      //get current provider
      const currentProvider = await web3ProviderStorage.getWeb3Provider();
      if (!currentProvider) {
        console.log(tag, 'No provider set, setting default provider');
        await web3ProviderStorage.saveWeb3Provider(defaultProvider);
      }
      //if not set, set it to eth mainnet
    } else {
      console.error(tag, 'FAILED TO INIT, No Ethereum address found');
      // APP.getCharts();
      //TODO retry?
      // setTimeout(() => {
      //   onStart();
      // }, 5000);
    }
  } catch (e) {
    KEEPKEY_STATE = 4; // errored
    updateIcon();
    pushStateChangeEvent();
    console.error(tag, 'Error:', e);
  }
};

setTimeout(() => {
  onStart();
}, 5000);

chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
  (async () => {
    const tag = TAG + ' | chrome.runtime.onMessage | ';
    // console.log(tag, 'Received message:', message);

    try {
      switch (message.type) {
        case 'WALLET_REQUEST': {
          if (!APP) throw Error('APP not initialized');
          const { requestInfo } = message;
          const { method, params, chain } = requestInfo;

          if (method) {
            try {
              const result = await handleWalletRequest(requestInfo, chain, method, params, APP, ADDRESS);
              sendResponse({ result });
            } catch (error) {
              sendResponse({ error: error.message });
            }
          } else {
            sendResponse({ error: 'Invalid request: missing method' });
          }
          break;
        }
        //OPEN_SIDEBAR
        case 'open_sidebar':
        case 'OPEN_SIDEBAR': {
          console.log(tag, 'Opening sidebar ** ');
          // Query all tabs across all windows
          chrome.tabs.query({}, tabs => {
            if (chrome.runtime.lastError) {
              console.error('Error querying tabs:', chrome.runtime.lastError);
              return;
            }

            // Filter out extension pages and internal Chrome pages
            const webPageTabs = tabs.filter(tab => {
              return (
                tab.url &&
                !tab.url.startsWith('chrome://') &&
                !tab.url.startsWith('chrome-extension://') &&
                !tab.url.startsWith('about:')
              );
            });

            if (webPageTabs.length > 0) {
              // Sort tabs by last accessed time to find the most recently active tab
              webPageTabs.sort((a, b) => b.lastAccessed - a.lastAccessed);
              const tab = webPageTabs[0];
              const windowId = tab.windowId;

              console.log(tag, 'Opening sidebar in tab:', tab);

              chrome.sidePanel.open({ windowId }, () => {
                if (chrome.runtime.lastError) {
                  console.error('Error opening side panel:', chrome.runtime.lastError);
                } else {
                  console.log('Side panel opened successfully.');
                }
              });
            } else {
              console.error('No suitable web page tabs found to open the side panel.');
            }
          });
          break;
        }

        case 'GET_KEEPKEY_STATE': {
          sendResponse({ state: KEEPKEY_STATE });
          break;
        }

        case 'UPDATE_EVENT_BY_ID': {
          const { id, updatedEvent } = message.payload;

          // Update the event in storage
          const success = await requestStorage.updateEventById(id, updatedEvent);

          if (success) {
            console.log(`Event with id ${id} has been updated successfully.`);
          } else {
            console.error(`Failed to update event with id ${id}.`);
          }

          break;
        }

        case 'GET_BALANCE': {
          if (APP) {
            const { networkId } = message;
            if (!networkId) throw Error('Network ID not provided');
            APP.getBalance([networkId]);
            sendResponse(true);
          } else {
            sendResponse({ error: 'APP not initialized' });
          }
          break;
        }

        case 'ON_START': {
          onStart();
          setTimeout(() => {
            sendResponse({ state: KEEPKEY_STATE });
          }, 15000);
          break;
        }

        case 'CLEAR_CACHE': {
          if (APP) {
            APP.clearCache();
            sendResponse(true);
          } else {
            sendResponse({ error: 'APP not initialized' });
          }
          break;
        }

        case 'RESET_APP': {
          console.log(tag, 'Resetting app...');
          chrome.runtime.reload();
          sendResponse({ result: true });
          break;
        }

        case 'GET_APP': {
          sendResponse({ app: APP });
          break;
        }

        case 'GET_ASSET_CONTEXT': {
          if (APP) {
            sendResponse({ assets: APP.assetContext });
          } else {
            sendResponse({ error: 'APP not initialized' });
          }
          break;
        }

        case 'GET_TX_INSIGHT': {
          if (APP) {
            //get chainid
            const assetContext = APP.assetContext;
            if (!assetContext) throw new Error('Invalid asset context. Missing assetContext.');
            const { tx, source } = message;
            tx.chainId = assetContext.networkId.replace('eip155:', '');
            console.log(tag, 'chainId: ', tx.chainId);
            console.log(tag, 'GET_TX_INSIGHT', tx, source);
            if (!tx) throw new Error('Invalid request: missing tx');
            if (!source) throw new Error('Invalid request: missing source');

            //result
            const result = await APP.pioneer.Insight({ tx, source });
            console.log(tag, 'GET_TX_INSIGHT', result);
            sendResponse(result.data);
          } else {
            sendResponse({ error: 'APP not initialized' });
          }
          break;
        }

        case 'GET_GAS_ESTIMATE': {
          if (APP) {
            const providerInfo = await web3ProviderStorage.getWeb3Provider();
            if (!providerInfo) throw Error('Failed to get provider info');
            console.log('providerInfo', providerInfo);
            const provider = new JsonRpcProvider(providerInfo.providerUrl);
            const feeData = await provider.getFeeData();
            sendResponse(feeData);
          } else {
            sendResponse({ error: 'APP not initialized' });
          }
          break;
        }

        case 'GET_MAX_SPENDABLE': {
          if (APP) {
            console.log(tag, 'GET_MAX_SPENDABLE');
            const assetContext = APP.assetContext;
            if (!assetContext) throw new Error('Invalid asset context. Missing assetContext.');

            let pubkeys = await APP.pubkeys;
            pubkeys = pubkeys.filter((pubkey: any) => pubkey.networks.includes(assetContext.networkId));
            console.log('onStart Transfer pubkeys', pubkeys);

            if (!assetContext.caip) throw new Error('Invalid asset context. Missing caip.');

            const estimatePayload: any = {
              feeRate: 10,
              caip: assetContext.caip,
              pubkeys,
              memo: '',
              recipient: '',
            };

            const maxSpendableAmount = await APP.swapKit.estimateMaxSendableAmount({
              chain: assetContext.chain,
              params: estimatePayload,
            });

            console.log('maxSpendableAmount', maxSpendableAmount);
            console.log('maxSpendableAmount string value', maxSpendableAmount.getValue('string'));

            sendResponse({ maxSpendable: maxSpendableAmount.getValue('string') });
          } else {
            sendResponse({ error: 'APP not initialized' });
          }
          break;
        }

        case 'CLEAR_ASSET_CONTEXT': {
          if (APP) {
            APP.setAssetContext();
            // Notify all tabs/panels that asset context has been cleared
            chrome.runtime.sendMessage({ type: 'ASSET_CONTEXT_CLEARED' }).catch(() => {
              // Ignore errors if no listeners
            });
            sendResponse({ success: true });
          } else {
            sendResponse({ error: 'APP not initialized' });
          }
          break;
        }

        case 'SET_ASSET_CONTEXT': {
          if (APP) {
            const { asset } = message;
            if (asset && asset.caip) {
              try {
                // Store existing balances before fetching new ones
                const existingBalances = APP.balances ? [...APP.balances] : [];
                console.log(tag, 'Existing balances count before update:', existingBalances.length);

                //refresh balances for network
                const networkId = asset.networkId;
                await APP.getBalance(networkId);

                // Check if getBalance replaced all balances
                console.log(tag, 'Balances count after getBalance:', APP.balances?.length);

                // If we had more balances before and now have fewer, merge them
                if (existingBalances.length > 0 && APP.balances) {
                  // Create a map of new balances for the updated network
                  const newBalancesMap = new Map();
                  APP.balances.forEach((balance: any) => {
                    if (balance.networkId === networkId) {
                      newBalancesMap.set(balance.caip, balance);
                    }
                  });

                  // Update existing balances with new data for this network only
                  const mergedBalances = existingBalances.map((balance: any) => {
                    // If this balance is for the network we just updated, use the new data
                    if (balance.networkId === networkId && newBalancesMap.has(balance.caip)) {
                      return newBalancesMap.get(balance.caip);
                    }
                    // Otherwise keep the existing balance
                    return balance;
                  });

                  // Add any new balances for this network that didn't exist before
                  newBalancesMap.forEach((newBalance: any, caip: string) => {
                    if (!mergedBalances.find((b: any) => b.caip === caip)) {
                      mergedBalances.push(newBalance);
                    }
                  });

                  // Restore the full balances array
                  APP.balances = mergedBalances;
                  console.log(tag, 'Restored balances count:', APP.balances.length);
                }

                console.log(tag, 'Setting asset context:', asset);
                const response = await APP.setAssetContext(asset);
                console.log('Asset context set:', response);
                chrome.runtime.sendMessage({
                  type: 'ASSET_CONTEXT_UPDATED',
                  assetContext: response, // Notify frontend about the change
                });
                sendResponse(response);

                const currentAssetContext = await APP.assetContext;
                //if eip155 then set web3 provider
                if (currentAssetContext.networkId.includes('eip155')) {
                  // Try to get provider data from custom chains first (user-added networks)
                  let providerData = await blockchainDataStorage.getBlockchainData(currentAssetContext.networkId);

                  // Fallback to static chain list if not found in custom storage
                  if (!providerData) {
                    const chainInfo = EIP155_CHAINS[currentAssetContext.networkId];
                    if (chainInfo) {
                      // Build provider object from static chain info
                      providerData = {
                        chainId: chainInfo.chainId,
                        caip: chainInfo.caip,
                        blockExplorerUrls: [],
                        name: chainInfo.name,
                        providerUrl: chainInfo.rpc,
                        fallbacks: [],
                      };
                    } else {
                      console.error(
                        tag,
                        'Network not found in custom or static chains:',
                        currentAssetContext.networkId,
                      );
                    }
                  }

                  console.log('newProvider', providerData);
                  if (providerData) {
                    await web3ProviderStorage.setWeb3Provider(providerData);
                  }
                }
              } catch (error) {
                console.error('Error setting asset context:', error);
                sendResponse({ error: 'Failed to fetch assets' });
              }
            }
          } else {
            sendResponse({ error: 'APP not initialized' });
          }
          break;
        }

        case 'GET_PUBKEY_CONTEXT': {
          if (APP) {
            sendResponse({ pubkeyContext: APP.pubkeyContext });
          } else {
            sendResponse({ error: 'APP not initialized' });
          }
          break;
        }

        case 'SET_PUBKEY_CONTEXT': {
          if (APP) {
            const { pubkey } = message;
            try {
              await APP.setPubkeyContext(pubkey);
              chrome.runtime.sendMessage({
                type: 'PUBKEY_CONTEXT_UPDATED',
                pubkeyContext: APP.pubkeyContext,
              });
              sendResponse({ success: true, pubkeyContext: APP.pubkeyContext });
            } catch (error) {
              console.error('Error setting pubkey context:', error);
              sendResponse({ error: 'Failed to set pubkey context' });
            }
          } else {
            sendResponse({ error: 'APP not initialized' });
          }
          break;
        }

        case 'GET_PUBKEYS_FOR_NETWORK': {
          if (APP) {
            const { networkId } = message;
            const pubkeys = APP.pubkeys.filter((pk: any) => pk.networks && pk.networks.includes(networkId));
            sendResponse({ pubkeys });
          } else {
            sendResponse({ error: 'APP not initialized' });
          }
          break;
        }

        case 'ADD_ACCOUNT_PATH': {
          if (APP) {
            const { path } = message;
            try {
              // Add path to APP configuration
              APP.paths.push(path);
              // Re-pair with new path
              await APP.getPubkeys();
              sendResponse({ success: true, pubkeys: APP.pubkeys });
            } catch (error) {
              console.error('Error adding account path:', error);
              sendResponse({ error: 'Failed to add account path' });
            }
          } else {
            sendResponse({ error: 'APP not initialized' });
          }
          break;
        }

        case 'GET_TX_HISTORY': {
          if (APP) {
            try {
              console.log(tag, 'GET_TX_HISTORY');
              //Assumed EVM*
              // eslint-disable-next-line prefer-const
              let { networkId, fromBlock, toBlock } = message;
              if (!toBlock) toBlock = 'latest';
              if (!fromBlock) fromBlock = 'latest';
              const dappsResponse = await APP.pioneer.GetTransactionsByNetwork({
                networkId,
                address: ADDRESS,
                fromBlock,
                toBlock,
              });
              console.log('dappsResponse:', dappsResponse.data);

              sendResponse(dappsResponse.data);
            } catch (error) {
              console.error('Error fetching assets:', error);
              sendResponse({ error: 'Failed to fetch assets' });
            }
          } else {
            sendResponse({ error: 'APP not initialized' });
          }
          break;
        }

        case 'GET_DAPPS_BY_NETWORKID': {
          if (APP) {
            try {
              //Assumed EVM*
              const { networkId } = message;

              const dappsResponse = await APP.pioneer.SearchDappsByNetworkId({ networkId });
              console.log('dappsResponse:', dappsResponse.data);

              sendResponse(dappsResponse.data);
            } catch (error) {
              console.error('Error fetching assets:', error);
              sendResponse({ error: 'Failed to fetch assets' });
            }
          } else {
            sendResponse({ error: 'APP not initialized' });
          }
          break;
        }

        case 'DISCOVERY_DAPP': {
          if (APP) {
            try {
              //Assumed EVM*
              const { networkId, url, name, description } = message;
              const body = {
                networks: [networkId],
                url,
                name,
                description,
              };
              const dappsResponse = await APP.pioneer.DiscoverDapp(body);
              console.log('dappsResponse:', dappsResponse.data);

              sendResponse(dappsResponse.data);
            } catch (error) {
              console.error('Error fetching assets:', error);
              sendResponse({ error: 'Failed to fetch assets' });
            }
          } else {
            sendResponse({ error: 'APP not initialized' });
          }
          break;
        }

        case 'GET_ASSET_BALANCE': {
          if (APP) {
            try {
              console.log(tag, 'GET_ASSET_BALANCE');
              //Assumed EVM*
              const { networkId } = message;
              const chainId = networkId.replace('eip155:', '');
              console.log('chainId:', chainId);
              const nodeInfoResponse = await APP.pioneer.SearchNodesByNetworkId({ chainId });
              console.log('nodeInfoResponse:', nodeInfoResponse.data);

              //TODO
              //test all services
              //give ping
              //remmove broken services
              //TODO push broken to api

              const service = nodeInfoResponse?.data[0]?.service;
              if (service) {
                console.log(tag, 'service:', service);
                if (!ADDRESS) throw new Error('ADDRESS not set');
                const provider = new JsonRpcProvider(nodeInfoResponse.data[0].service);
                const params = [ADDRESS, 'latest'];
                //get balance
                const balance = await provider.getBalance(params[0], params[1]);
                console.log('balance:', balance);
                sendResponse('0x' + balance.toString(16));
              } else {
                sendResponse('0');
              }
            } catch (error) {
              console.error('Error fetching assets:', error);
              sendResponse({ error: 'Failed to fetch balances' });
            }
          } else {
            sendResponse({ error: 'APP not initialized' });
          }
          break;
        }

        case 'GET_ASSETS_INFO': {
          if (APP) {
            try {
              //Assumed EVM*
              const { networkId } = message;
              const chainId = networkId.replace('eip155:', '');
              console.log('chainId:', chainId);
              const nodeInfoResponse = await APP.pioneer.SearchNodesByNetworkId({ chainId });
              console.log('nodeInfoResponse:', nodeInfoResponse.data);
              const caip = networkId + '/slip44:60';
              console.log('caip:', caip);
              const marketInfoResponse = await APP.pioneer.MarketInfo({ caip });
              console.log('marketInfoResponse:', marketInfoResponse.data);

              console.log('nodeInfoResponse fetched:', nodeInfoResponse);
              sendResponse(nodeInfoResponse);
            } catch (error) {
              console.error('Error fetching assets:', error);
              sendResponse({ error: 'Failed to fetch assets' });
            }
          } else {
            sendResponse({ error: 'APP not initialized' });
          }
          break;
        }

        case 'GET_ASSETS': {
          if (APP) {
            try {
              const assets = await APP.getAssets();
              console.log('Assets fetched:', assets);
              let assetsArray;
              if (assets instanceof Map) {
                assetsArray = Array.from(assets.values()); // Extract only the values if it's a Map
              } else {
                assetsArray = assets; // Leave it as-is if it's not a Map
              }
              sendResponse({ assets: assetsArray });
            } catch (error) {
              console.error('Error fetching assets:', error);
              sendResponse({ error: 'Failed to fetch assets' });
            }
          } else {
            sendResponse({ error: 'APP not initialized' });
          }
          break;
        }

        case 'GET_APP_PUBKEYS': {
          if (APP) {
            sendResponse({ balances: APP.pubkeys });
          } else {
            sendResponse({ error: 'APP not initialized' });
          }
          break;
        }

        case 'GET_APP_BALANCES': {
          if (APP) {
            console.log(tag, 'GET_APP_BALANCES - Total balances:', APP.balances?.length);
            console.log(tag, 'GET_APP_BALANCES - Sample balance:', APP.balances?.[0]);
            const tokens = APP.balances?.filter((b: any) => b.token === true);
            console.log(tag, 'GET_APP_BALANCES - Tokens found:', tokens?.length);
            if (tokens && tokens.length > 0) {
              console.log(tag, 'GET_APP_BALANCES - Sample token:', tokens[0]);
            }
            sendResponse({ balances: APP.balances });
          } else {
            sendResponse({ error: 'APP not initialized' });
          }
          break;
        }

        case 'REFRESH_ALL_BALANCES': {
          if (APP) {
            console.log(tag, 'Refreshing all balances...');
            try {
              // Get unique network IDs from pubkeys
              const networkIds = new Set<string>();
              APP.pubkeys.forEach((pubkey: any) => {
                if (pubkey.networks && Array.isArray(pubkey.networks)) {
                  pubkey.networks.forEach((networkId: string) => networkIds.add(networkId));
                }
              });

              // Fetch and accumulate balances for all networks
              const allBalances: any[] = [];
              for (const networkId of networkIds) {
                try {
                  await APP.getBalance(networkId);
                  // After each fetch, collect the balances
                  if (APP.balances && APP.balances.length > 0) {
                    APP.balances.forEach((balance: any) => {
                      // Only add if not already in allBalances
                      if (!allBalances.find((b: any) => b.caip === balance.caip)) {
                        allBalances.push(balance);
                      }
                    });
                  }
                } catch (e) {
                  console.error(tag, `Failed to fetch balance for ${networkId}:`, e);
                }
              }

              // Update APP.balances with all accumulated balances
              if (allBalances.length > 0) {
                APP.balances = allBalances;
              }

              console.log(tag, 'All balances refreshed, total:', APP.balances?.length);
              sendResponse({ balances: APP.balances });
            } catch (error) {
              console.error('Error refreshing all balances:', error);
              sendResponse({ error: 'Failed to refresh all balances' });
            }
          } else {
            sendResponse({ error: 'APP not initialized' });
          }
          break;
        }

        case 'GET_CHARTS': {
          if (APP) {
            console.log(tag, 'Fetching charts (discovering tokens)...');
            try {
              const { networkIds } = message;

              // Call getCharts with optional network filter
              // If networkIds array is provided, only fetch for those networks
              // If not provided, fetch for all networks
              if (networkIds && Array.isArray(networkIds) && networkIds.length > 0) {
                console.log(tag, `Fetching charts for specific networks: ${networkIds.join(', ')}`);
                await APP.getCharts(networkIds);
              } else {
                console.log(tag, 'Fetching charts for all networks');
                await APP.getCharts();
              }

              console.log(tag, 'Charts fetched successfully, balances count:', APP.balances?.length);

              // Return the updated balances
              sendResponse({
                success: true,
                balances: APP.balances,
                message: 'Charts fetched successfully',
              });
            } catch (error: any) {
              console.error('Error fetching charts:', error);
              sendResponse({
                error: error.message || 'Failed to fetch charts',
                success: false,
              });
            }
          } else {
            sendResponse({ error: 'APP not initialized', success: false });
          }
          break;
        }

        case 'LOOKUP_TOKEN_METADATA': {
          if (APP) {
            console.log(tag, 'Looking up token metadata...');
            try {
              const { networkId, contractAddress, userAddress } = message;

              if (!networkId || !contractAddress) {
                throw new Error('networkId and contractAddress are required');
              }

              console.log(tag, 'Calling APP.pioneer.LookupTokenMetadata:', { networkId, contractAddress, userAddress });

              const payload: any = {
                networkId,
                contractAddress,
              };

              // Include userAddress if provided to get balance too
              if (userAddress) {
                payload.userAddress = userAddress;
              }

              const result = await APP.pioneer.LookupTokenMetadata(payload);

              console.log(tag, 'Token metadata lookup result:', result);

              sendResponse({
                success: true,
                data: result.data,
              });
            } catch (error: any) {
              console.error('Error looking up token metadata:', error);
              sendResponse({
                success: false,
                error: error.message || 'Failed to lookup token metadata',
              });
            }
          } else {
            sendResponse({ error: 'APP not initialized', success: false });
          }
          break;
        }

        case 'ADD_CUSTOM_TOKEN': {
          if (APP) {
            console.log(tag, 'Adding custom token...');
            try {
              const { userAddress, token } = message;

              if (!userAddress || !token) {
                throw new Error('userAddress and token are required');
              }

              console.log(tag, 'Calling APP.pioneer.AddCustomToken:', { userAddress, token });

              const result = await APP.pioneer.AddCustomToken({
                userAddress,
                token: {
                  networkId: token.networkId,
                  address: token.address,
                  caip: token.caip,
                  name: token.name,
                  symbol: token.symbol,
                  decimals: token.decimals,
                  icon: token.icon,
                  coingeckoId: token.coingeckoId,
                },
              });

              console.log(tag, 'Add custom token result:', result);

              sendResponse({
                success: result?.success || result?.data?.success || false,
                data: result.data,
              });
            } catch (error: any) {
              console.error('Error adding custom token:', error);
              sendResponse({
                success: false,
                error: error.message || 'Failed to add custom token',
              });
            }
          } else {
            sendResponse({ error: 'APP not initialized', success: false });
          }
          break;
        }

        case 'GET_CUSTOM_TOKENS': {
          if (APP) {
            console.log(tag, 'Getting custom tokens...');
            try {
              const { userAddress, networkId } = message;

              if (!userAddress) {
                throw new Error('userAddress is required');
              }

              console.log(tag, 'Calling APP.pioneer.GetCustomTokens:', { userAddress, networkId });

              const payload: any = { userAddress };
              if (networkId) {
                payload.networkId = networkId;
              }

              const result = await APP.pioneer.GetCustomTokens(payload);

              console.log(tag, 'Get custom tokens result:', result);

              // Handle nested response structure: result.data.data.tokens
              const tokens = result?.data?.data?.tokens || result?.data?.tokens || result?.tokens || [];

              sendResponse({
                success: true,
                tokens,
              });
            } catch (error: any) {
              console.error('Error getting custom tokens:', error);
              sendResponse({
                success: false,
                error: error.message || 'Failed to get custom tokens',
                tokens: [],
              });
            }
          } else {
            sendResponse({ error: 'APP not initialized', success: false });
          }
          break;
        }

        case 'GET_CUSTOM_TOKEN_BALANCES': {
          if (APP) {
            console.log(tag, 'Getting custom token balances...');
            try {
              const { networkId, address } = message;

              if (!networkId || !address) {
                throw new Error('networkId and address are required');
              }

              console.log(tag, 'Calling APP.pioneer.GetCustomTokenBalances:', { networkId, address });

              const result = await APP.pioneer.GetCustomTokenBalances({
                networkId,
                address,
              });

              console.log(tag, 'Get custom token balances result:', result);

              // Handle nested response structure
              const tokens = result?.data?.data?.tokens || result?.data?.tokens || result?.tokens || [];

              sendResponse({
                success: true,
                tokens,
              });
            } catch (error: any) {
              console.error('Error getting custom token balances:', error);
              sendResponse({
                success: false,
                error: error.message || 'Failed to get custom token balances',
                tokens: [],
              });
            }
          } else {
            sendResponse({ error: 'APP not initialized', success: false });
          }
          break;
        }

        case 'REMOVE_CUSTOM_TOKEN': {
          if (APP) {
            console.log(tag, 'Removing custom token...');
            try {
              const { userAddress, networkId, tokenAddress } = message;

              if (!userAddress || !networkId || !tokenAddress) {
                throw new Error('userAddress, networkId, and tokenAddress are required');
              }

              console.log(tag, 'Calling APP.pioneer.RemoveCustomToken:', { userAddress, networkId, tokenAddress });

              const result = await APP.pioneer.RemoveCustomToken({
                userAddress,
                networkId,
                tokenAddress,
              });

              console.log(tag, 'Remove custom token result:', result);

              sendResponse({
                success: result?.success || result?.data?.success || false,
                data: result.data,
              });
            } catch (error: any) {
              console.error('Error removing custom token:', error);
              sendResponse({
                success: false,
                error: error.message || 'Failed to remove custom token',
              });
            }
          } else {
            sendResponse({ error: 'APP not initialized', success: false });
          }
          break;
        }

        case 'VALIDATE_ERC20_TOKEN': {
          if (APP) {
            try {
              const { contractAddress, networkId } = message;

              if (!contractAddress) {
                sendResponse({ valid: false, error: 'Contract address is required' });
                break;
              }

              if (!networkId) {
                sendResponse({ valid: false, error: 'Network ID is required' });
                break;
              }

              // Extract chain ID from network ID (e.g., 'eip155:1' -> '1')
              const chainId = networkId.replace('eip155:', '');

              // Get RPC provider for the network
              const chainInfo = EIP155_CHAINS[networkId];
              if (!chainInfo) {
                sendResponse({ valid: false, error: 'Unsupported network' });
                break;
              }

              const rpcProvider = new JsonRpcProvider(chainInfo.rpc);

              // ERC-20 ABI for name, symbol, and decimals
              const ERC20_ABI = [
                'function name() view returns (string)',
                'function symbol() view returns (string)',
                'function decimals() view returns (uint8)',
              ];

              const { Contract } = await import('ethers');
              const tokenContract = new Contract(contractAddress, ERC20_ABI, rpcProvider);

              // Validate token by calling its methods
              const [name, symbol, decimals] = await Promise.all([
                tokenContract.name(),
                tokenContract.symbol(),
                tokenContract.decimals(),
              ]);

              // Build CAIP identifier
              const caip = `${networkId}/erc20:${contractAddress.toLowerCase()}`;

              const tokenData = {
                address: contractAddress,
                symbol,
                name,
                decimals: Number(decimals),
                caip,
                networkId,
              };

              console.log(tag, 'Token validated successfully:', tokenData);
              sendResponse({ valid: true, token: tokenData });
            } catch (error: any) {
              console.error(tag, 'Error validating ERC-20 token:', error);
              sendResponse({
                valid: false,
                error: error.message || 'Failed to validate token. Make sure it is a valid ERC-20 contract.',
              });
            }
          } else {
            sendResponse({ valid: false, error: 'APP not initialized' });
          }
          break;
        }

        case 'INJECTION_SUCCESS': {
          // Content script successfully injected - just log it
          console.log(tag, 'Injection successful:', message.url);
          sendResponse({ success: true });
          break;
        }

        case 'GET_CACHED_PUBKEYS_STATUS': {
          const { pubkeyStorage } = await import('@extension/storage');
          try {
            const [hasCached, deviceInfo, cacheEnabled] = await Promise.all([
              pubkeyStorage.hasStoredPubkeys(),
              pubkeyStorage.getDeviceInfo(),
              pubkeyStorage.isCacheEnabled(),
            ]);

            sendResponse({
              hasCached,
              deviceInfo,
              cacheEnabled,
              isViewOnlyMode: hasCached && !APP?.keepKeySdk?.device,
            });
          } catch (error) {
            sendResponse({ error: 'Failed to get cache status' });
          }
          break;
        }

        case 'CLEAR_CACHED_PUBKEYS': {
          const { pubkeyStorage } = await import('@extension/storage');
          try {
            const success = await pubkeyStorage.clearPubkeys();
            sendResponse({ success });
          } catch (error) {
            sendResponse({ error: 'Failed to clear cache' });
          }
          break;
        }

        case 'SET_CACHE_ENABLED': {
          const { pubkeyStorage } = await import('@extension/storage');
          const { enabled } = message;
          try {
            const success = await pubkeyStorage.setCacheEnabled(enabled);
            sendResponse({ success, enabled });
          } catch (error) {
            sendResponse({ error: 'Failed to update cache setting' });
          }
          break;
        }

        default:
          // Handle action-based messages (like eth_sign_response) that are handled by other listeners
          if (message.action) {
            // Don't log error for action-based messages - they're handled by other listeners
            sendResponse({ success: true });
          } else {
            console.error('Unknown message:', message);
            sendResponse({ error: 'Unknown message type: ' + message.type });
          }
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ error: error.message });
    }
  })();

  // Return true to indicate that the response will be sent asynchronously
  return true;
});

exampleSidebarStorage
  .get()
  .then(openSidebar => {
    chrome.action.onClicked.addListener((tab: any) => {
      if (openSidebar === true) {
        chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
          chrome.sidePanel.open({ tabId: tab.id }, () => {
            if (chrome.runtime.lastError) {
              console.error('Error opening side panel:', chrome.runtime.lastError);
            }
          });
        });
      } else {
        // chrome.action.setPopup({ popup: 'popup/index.html' });
        // chrome.action.openPopup();
      }
    });
  })
  .catch(error => {
    console.error('Error fetching sidebar storage:', error);
  });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getMaskingSettings') {
    chrome.storage.local.get(['enableMetaMaskMasking', 'enableXfiMasking', 'enableKeplrMasking'], result => {
      console.log('getMaskingSettings result: ', result);
      sendResponse(result);
    });
    return true; // To indicate asynchronous response
  }
});
