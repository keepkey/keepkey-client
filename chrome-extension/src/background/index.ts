import 'webextension-polyfill';
import packageJson from '../../package.json'; // Adjust the path as needed
import { onStartKeepkey } from './keepkey';
import { handleWalletRequest } from './methods';
import { listenForApproval } from './approvals';
import { JsonRpcProvider } from 'ethers';
import { Chain } from '@coinmasters/types';
import { exampleSidebarStorage } from '@extension/storage'; // Re-import the storage

const TAG = ' | background/index.js | ';
console.log('Background script loaded');
console.log('Version:', packageJson.version);

const KEEPKEY_STATES = {
  0: 'unknown',
  1: 'disconnected',
  2: 'connected',
  3: 'busy', // multi-user-action signing cannot be interrupted
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
updateIcon();
console.log('Background loaded');

// Define the supported chains and RPC URLs
const EIP155_CHAINS = {
  'eip155:1': {
    chainId: 1,
    name: 'Ethereum',
    logo: '/chain-logos/eip155-1.png',
    rgb: '99, 125, 234',
    rpc: 'https://1rpc.io/eth',
    namespace: 'eip155',
  },
  'eip155:43114': {
    chainId: 43114,
    name: 'Avalanche C-Chain',
    logo: '/chain-logos/eip155-43113.png',
    rgb: '232, 65, 66',
    rpc: 'https://api.avax.network/ext/bc/C/rpc',
    namespace: 'eip155',
  },
  'eip155:137': {
    chainId: 137,
    name: 'Polygon',
    logo: '/chain-logos/eip155-137.png',
    rgb: '130, 71, 229',
    rpc: 'https://polygon-rpc.com/',
    namespace: 'eip155',
  },
  'eip155:10': {
    chainId: 10,
    name: 'Optimism',
    logo: '/chain-logos/eip155-10.png',
    rgb: '235, 0, 25',
    rpc: 'https://mainnet.optimism.io',
    namespace: 'eip155',
  },
  'eip155:324': {
    chainId: 324,
    name: 'zkSync Era',
    logo: '/chain-logos/eip155-324.svg',
    rgb: '242, 242, 242',
    rpc: 'https://mainnet.era.zksync.io/',
    namespace: 'eip155',
  },
  'eip155:8453': {
    chainId: 8453,
    name: 'Base',
    logo: '/chain-logos/base.png',
    rgb: '242, 242, 242',
    rpc: 'https://mainnet.base.org',
    namespace: 'eip155',
  },
  'eip155:42161': {
    chainId: 8453,
    name: 'Arbitrum',
    logo: '/chain-logos/arbitrum.png',
    rgb: '4, 100, 214',
    rpc: 'https://api.zan.top/node/v1/arb/one/public',
    namespace: 'eip155',
  },
  'eip155:100': {
    chainId: 100,
    name: 'Gnosis',
    logo: '/chain-logos/gnosis.png',
    rgb: '33, 186, 69',
    rpc: 'https://api.zan.top/node/v1/arb/one/public',
    namespace: 'eip155',
  },
};

const provider = new JsonRpcProvider(EIP155_CHAINS['eip155:1'].rpc);

// KeepKey Initialization
let ADDRESS = '';
let KEEPKEY_WALLET: any = '';

const onStart = async function () {
  const tag = TAG + ' | onStart | ';
  try {
    console.log(tag, 'Starting...');
    // Connect to KeepKey
    const app = await onStartKeepkey();
    console.log(tag, 'app: ', app);
    const address = await app.swapKit.getAddress(Chain.Ethereum);
    console.log(tag, 'address: ', address);
    if (address) {
      KEEPKEY_STATE = 2;
      updateIcon();
    }
    console.log(tag, 'address: ', address);

    // Set addresses
    ADDRESS = address;
    console.log(tag, '**** keepkey: ', app);
    KEEPKEY_WALLET = app;
    console.log(tag, 'KEEPKEY_WALLET: ', KEEPKEY_WALLET);

    // Start listening for approval events
    listenForApproval(KEEPKEY_WALLET, ADDRESS);

    // Sync with KeepKey
    await app.getPubkeys();
    await app.getBalances();
  } catch (e) {
    KEEPKEY_STATE = 4; // errored
    updateIcon();
    console.error(tag, 'Error:', e);
  }
};

onStart();

chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
  const tag = TAG + ' | chrome.runtime.onMessage | ';
  console.log(tag, 'Received message:', message);

  if (message.type === 'WALLET_REQUEST') {
    console.log(tag, 'Handling WALLET_REQUEST:', message);

    // Extract requestInfo from the message
    const { requestInfo } = message;

    // Now, extract method, params, and chain from requestInfo
    const { method, params, chain } = requestInfo;

    console.log(tag, 'id:', requestInfo.id);
    console.log(tag, 'chain:', chain);
    console.log(tag, 'method:', method);
    console.log(tag, 'params:', params);

    if (method) {
      handleWalletRequest(requestInfo, chain, method, params, provider, KEEPKEY_WALLET, ADDRESS)
        .then(result => {
          sendResponse({ result });
        })
        .catch(error => {
          sendResponse({ error: error.message });
        });
    } else {
      console.log(tag, 'Invalid WALLET_REQUEST: Missing method');
      sendResponse({ error: 'Invalid request: missing method' });
    }

    return true; // Indicates that the response will be sent asynchronously
  }

  if (message.type === 'GET_KEEPKEY_STATE') {
    sendResponse({ state: KEEPKEY_STATE });
    return true;
  }

  if (message.type === 'ON_START') {
    onStart();
    setTimeout(() => {
      sendResponse({ state: KEEPKEY_STATE });
    }, 15000); // 15 seconds delay
    return true;
  }

  return false;
});

// Example usage of exampleSidebarStorage to get the user's preference
exampleSidebarStorage
  .get()
  .then(openSidebar => {
    console.log('openSidebar:', openSidebar);
    // Update the click handler for the extension icon
    chrome.action.onClicked.addListener((tab: any) => {
      // Check the user's preference for opening the side panel or popup
      if (openSidebar === true) {
        // If true, open the side panel
        chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
          chrome.sidePanel.open({ tabId: tab.id }, () => {
            if (chrome.runtime.lastError) {
              console.error('Error opening side panel:', chrome.runtime.lastError);
            }
          });
        });
      } else {
        // Otherwise, fallback to popup
        chrome.action.setPopup({ popup: 'popup/index.html' });
        chrome.action.openPopup();
      }
    });
  })
  .catch(error => {
    console.error('Error fetching sidebar storage:', error);
  });
