import 'webextension-polyfill';
import packageJson from '../../package.json'; // Adjust the path as needed
import { onStartKeepkey } from './keepkey';
import { handleWalletRequest } from './methods';
// import { listenForApproval } from './approvals';
import { JsonRpcProvider } from 'ethers';
import { ChainToNetworkId } from '@pioneer-platform/pioneer-caip';
import { Chain } from '@coinmasters/types';
import { exampleSidebarStorage } from '@extension/storage'; // Re-import the storage
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
      KEEPKEY_STATE = 2; // Set state to connected
      updateIcon();
      pushStateChangeEvent();
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

    // listenForApproval(APP, ADDRESS);

    await APP.getAssets();

    const assetsMap = APP.assetsMap;
    console.log(tag, 'assetsMap:', assetsMap);

    await APP.getPubkeys();

    const pubkeys = APP.pubkeys;
    console.log(tag, 'pubkeys:', pubkeys);
    console.log(tag, 'pubkeys:', pubkeys.length);

    await APP.getBalances();

    const balances = APP.balances;
    console.log(tag, 'balances:', balances);
    console.log(tag, 'balances:', balances.length);

    const pubkeysEth = APP.pubkeys.filter((e: any) => e.networks.includes(ChainToNetworkId[Chain.Ethereum]));
    if (pubkeysEth.length > 0) {
      console.log(tag, 'pubkeys:', pubkeysEth);
      const address = pubkeysEth[0].address;
      if (address) {
        ADDRESS = address;
        KEEPKEY_STATE = 2;
        updateIcon();
        pushStateChangeEvent();
      }
    } else {
      console.error(tag, 'FAILED TO INIT, No Ethereum address found');
      //TODO retry?
    }
  } catch (e) {
    KEEPKEY_STATE = 4; // errored
    updateIcon();
    pushStateChangeEvent();
    console.error(tag, 'Error:', e);
  }
};

onStart();

chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
  (async () => {
    const tag = TAG + ' | chrome.runtime.onMessage | ';
    console.log(tag, 'Received message:', message);

    try {
      switch (message.type) {
        case 'WALLET_REQUEST': {
          const { requestInfo } = message;
          const { method, params, chain } = requestInfo;

          if (method) {
            try {
              const result = await handleWalletRequest(requestInfo, chain, method, params, provider, APP, ADDRESS);
              sendResponse({ result });
            } catch (error) {
              sendResponse({ error: error.message });
            }
          } else {
            sendResponse({ error: 'Invalid request: missing method' });
          }
          break;
        }

        case 'GET_KEEPKEY_STATE': {
          sendResponse({ state: KEEPKEY_STATE });
          break;
        }

        case 'ON_START': {
          onStart();
          setTimeout(() => {
            sendResponse({ state: KEEPKEY_STATE });
          }, 15000);
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

// chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
//   const tag = TAG + ' | chrome.runtime.onMessage | ';
//   console.log(tag, 'Received message:', message);
//
//   if (message.type === 'WALLET_REQUEST') {
//     const { requestInfo } = message;
//     const { method, params, chain } = requestInfo;
//
//     if (method) {
//       handleWalletRequest(requestInfo, chain, method, params, provider, APP, ADDRESS)
//         .then(result => sendResponse({ result }))
//         .catch(error => sendResponse({ error: error.message }));
//     } else {
//       sendResponse({ error: 'Invalid request: missing method' });
//     }
//
//     return true;
//   }
//
//   if (message.type === 'GET_KEEPKEY_STATE') {
//     sendResponse({ state: KEEPKEY_STATE });
//     return true;
//   }
//
//   if (message.type === 'ON_START') {
//     onStart();
//     setTimeout(() => {
//       sendResponse({ state: KEEPKEY_STATE });
//     }, 15000);
//     return true;
//   }
//
//   if (message.type === 'GET_APP') {
//     sendResponse({ app: APP });
//     return true;
//   }
//
//   if (message.type === 'GET_ASSET_CONTEXT') {
//     if (APP) {
//       sendResponse({ assets: APP.assetContext });
//       return true;
//     } else {
//       sendResponse({ error: 'APP not initialized' });
//     }
//   }
//
//   if (message.type === 'GET_MAX_SPENDABLE') {
//     if (APP) {
//       console.log(tag,'GET_MAX_SPENDABLE')
//       const assetContext = APP.assetContext
//       if(!assetContext) throw Error('Invalid asset context. Missing assetContext.');
//
//       let pubkeys = await APP.pubkeys;
//       pubkeys = pubkeys.filter((pubkey: any) => pubkey.networks.includes(assetContext.networkId));
//       console.log("onStart Transfer pubkeys", pubkeys);
//
//       if (!assetContext.caip) throw Error('Invalid asset context. Missing caip.');
//       const estimatePayload: any = {
//         feeRate: 10,
//         caip: assetContext.caip,
//         pubkeys,
//         memo:'',
//         recipient:'',
//       };
//       const maxSpendableAmount = await APP.swapKit.estimateMaxSendableAmount({ chain: assetContext.chain, params: estimatePayload });
//       console.log("maxSpendableAmount", maxSpendableAmount);
//       console.log("maxSpendableAmount", maxSpendableAmount.getValue('string'));
//       console.log("onStart Transfer pubkeys", pubkeys);
//       return maxSpendableAmount;
//     } else {
//       console.error('APP not initialized');
//       sendResponse({ error: 'APP not initialized' });
//     }
//   }
//
//
//   if (message.type === 'SET_ASSET_CONTEXT') {
//     if (APP) {
//       console.log('SET_ASSET_CONTEXT: message: ', message);
//       if (message.asset && message.asset.caip) {
//         APP.setAssetContext(message.asset)
//           .then(response => {
//             console.log('Asset context set:', response);
//             chrome.runtime.sendMessage({
//               type: 'ASSET_CONTEXT_UPDATED',
//               assetContext: response, // Notify frontend about the change
//             });
//             sendResponse(response);
//           })
//           .catch(error => {
//             console.error('Error setting asset context:', error);
//             sendResponse({ error: 'Failed to fetch assets' });
//           });
//       }
//       return true;
//     } else {
//       console.error('APP not initialized');
//       sendResponse({ error: 'APP not initialized' });
//     }
//   }
//
//   if (message.type === 'GET_ASSETS') {
//     if (APP) {
//       APP.getAssets()
//         .then(assets => {
//           console.log('Assets fetched:', assets);
//           sendResponse({ assets: assets });
//         })
//         .catch(error => {
//           console.error('Error fetching assets:', error);
//           sendResponse({ error: 'Failed to fetch assets' });
//         });
//       return true; // Indicates the response will be sent asynchronously
//     } else {
//       sendResponse({ error: 'APP not initialized' });
//     }
//   }
//
//   if (message.type === 'GET_APP_PUBKEYS') {
//     if (APP) {
//       sendResponse({ balances: APP.pubkeys });
//       return true;
//     } else {
//       sendResponse({ error: 'APP not initialized' });
//     }
//   }
//
//   if (message.type === 'GET_APP_BALANCES') {
//     if (APP) {
//       sendResponse({ balances: APP.balances });
//       return true;
//     } else {
//       sendResponse({ error: 'APP not initialized' });
//     }
//   }
//
//   return false;
// });

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
        chrome.action.setPopup({ popup: 'popup/index.html' });
        chrome.action.openPopup();
      }
    });
  })
  .catch(error => {
    console.error('Error fetching sidebar storage:', error);
  });
