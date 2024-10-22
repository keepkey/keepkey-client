import 'webextension-polyfill';
import packageJson from '../../package.json'; // Adjust the path as needed
import { onStartKeepkey } from './keepkey';
import { handleWalletRequest } from './methods';
// import { listenForApproval } from './approvals';
import { JsonRpcProvider } from 'ethers';
import { ChainToNetworkId } from '@pioneer-platform/pioneer-caip';
import { Chain } from '@coinmasters/types';
import { requestStorage, exampleSidebarStorage, web3ProviderStorage } from '@extension/storage'; // Re-import the storage
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
  if (KEEPKEY_STATE === 2) iconPath = './icon-128-online.png';

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

    await APP.getAssets();
    await APP.getPubkeys();
    await APP.getBalances();
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

        case 'ON_START': {
          onStart();
          setTimeout(() => {
            sendResponse({ state: KEEPKEY_STATE });
          }, 15000);
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

        case 'SET_ASSET_CONTEXT': {
          if (APP) {
            const { asset } = message;
            if (asset && asset.caip) {
              try {
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
                  const newProvider = EIP155_CHAINS[currentAssetContext.networkId].provider;
                  console.log('newProvider', newProvider);
                  await web3ProviderStorage.setWeb3Provider(newProvider);
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
              sendResponse({ assets });
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
            sendResponse({ balances: APP.balances });
          } else {
            sendResponse({ error: 'APP not initialized' });
          }
          break;
        }

        default:
          sendResponse({ error: 'Unknown message type' });
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
