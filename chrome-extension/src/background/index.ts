import 'webextension-polyfill';
import packageJson from '../../package.json'; // Adjust the path as needed
import { onStartKeepkey } from './keepkey';
import { handleWalletRequest } from './methods';
import { listenForApproval } from './approvals';
import { JsonRpcProvider } from 'ethers';
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
    const app = await onStartKeepkey();
    const address = await app.swapKit.getAddress(Chain.Ethereum);
    if (address) {
      KEEPKEY_STATE = 2;
      updateIcon();
      pushStateChangeEvent();
    }

    ADDRESS = address;
    APP = app;

    listenForApproval(APP, ADDRESS);

    await APP.getAssets();
    await APP.getPubkeys();
    await APP.getBalances();
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
