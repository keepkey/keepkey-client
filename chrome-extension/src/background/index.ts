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

    const pubkeysEth = KEEPKEY_WALLET.pubkeys.filter((e: any) => e.networks.includes(ChainToNetworkId[Chain.Ethereum]));
    if (pubkeysEth.length > 0) {
      console.log(tag, 'pubkeys:', pubkeysEth);
      const address = pubkeysEth[0].address;
      if (address) {
        ADDRESS = address;
        APP = app;

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
  const tag = TAG + ' | chrome.runtime.onMessage | ';
  console.log(tag, 'Received message:', message);

  if (message.type === 'WALLET_REQUEST') {
    const { requestInfo } = message;
    const { method, params, chain } = requestInfo;

    if (method) {
      handleWalletRequest(requestInfo, chain, method, params, provider, APP, ADDRESS)
        .then(result => sendResponse({ result }))
        .catch(error => sendResponse({ error: error.message }));
    } else {
      sendResponse({ error: 'Invalid request: missing method' });
    }

    return true;
  }

  if (message.type === 'GET_KEEPKEY_STATE') {
    sendResponse({ state: KEEPKEY_STATE });
    return true;
  }

  if (message.type === 'ON_START') {
    onStart();
    setTimeout(() => {
      sendResponse({ state: KEEPKEY_STATE });
    }, 15000);
    return true;
  }

  if (message.type === 'GET_APP') {
    sendResponse({ app: APP });
    return true;
  }

  if (message.type === 'GET_ASSET_CONTEXT') {
    if (APP) {
      sendResponse({ assets: APP.assetContext });
      return true;
    } else {
      sendResponse({ error: 'APP not initialized' });
    }
  }

  if (message.type === 'SET_ASSET_CONTEXT') {
    if (APP) {
      console.log('SET_ASSET_CONTEXT: message: ', message);
      if (message.asset && message.asset.caip) {
        APP.setAssetContext(message.asset)
          .then(response => {
            console.log('Asset context set:', response);
            chrome.runtime.sendMessage({
              type: 'ASSET_CONTEXT_UPDATED',
              assetContext: response, // Notify frontend about the change
            });
            sendResponse(response);
          })
          .catch(error => {
            console.error('Error setting asset context:', error);
            sendResponse({ error: 'Failed to fetch assets' });
          });
      }
      return true;
    } else {
      console.error('APP not initialized');
      sendResponse({ error: 'APP not initialized' });
    }
  }

  if (message.type === 'GET_ASSETS') {
    if (APP) {
      APP.getAssets()
        .then(assets => {
          console.log('Assets fetched:', assets);
          sendResponse({ assets: assets });
        })
        .catch(error => {
          console.error('Error fetching assets:', error);
          sendResponse({ error: 'Failed to fetch assets' });
        });
      return true; // Indicates the response will be sent asynchronously
    } else {
      sendResponse({ error: 'APP not initialized' });
    }
  }

  if (message.type === 'GET_APP_PUBKEYS') {
    if (APP) {
      sendResponse({ balances: APP.pubkeys });
      return true;
    } else {
      sendResponse({ error: 'APP not initialized' });
    }
  }

  if (message.type === 'GET_APP_BALANCES') {
    if (APP) {
      sendResponse({ balances: APP.balances });
      return true;
    } else {
      sendResponse({ error: 'APP not initialized' });
    }
  }

  return false;
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
        chrome.action.setPopup({ popup: 'popup/index.html' });
        chrome.action.openPopup();
      }
    });
  })
  .catch(error => {
    console.error('Error fetching sidebar storage:', error);
  });
