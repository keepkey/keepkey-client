import { JsonRpcProvider } from 'ethers';
import { requestStorage } from '@extension/storage';
// import axios from 'axios';
import { caipToNetworkId, shortListNameToCaip } from '@pioneer-platform/pioneer-caip';

//@ts-ignore
import { v4 as uuidv4 } from 'uuid';
import { handleEthereumRequest } from './chains/ethereumHandler';
import { handleThorchainRequest } from './chains/thorchainHandler';
import { handleBitcoinRequest } from './chains/bitcoinHandler';
import { handleBitcoinCashRequest } from './chains/bitcoinCashHandler';
import { handleDogecoinRequest } from './chains/dogecoinHandler';
import { handleLitecoinRequest } from './chains/litecoinHandler';
import { handleDashRequest } from './chains/dashHandler';
import { handleCosmosRequest } from './chains/cosmosHandler';
import { handleOsmosisRequest } from './chains/osmosisHandler';
import { handleMayaRequest } from './chains/mayaHandler';
import { handleRippleRequest } from './chains/rippleHandler';

const TAG = ' | METHODS | ';
const DOMAIN_WHITE_LIST = [];

const CURRENT_PROVIDER: any = {
  chainId: '0x1',
  caip: 'eip155:1/slip44:60',
  blockExplorerUrls: ['https://etherscan.io'],
  name: 'Ethereum',
  providerUrl: 'https://eth.llamarpc.com',
  provider: new JsonRpcProvider('https://eth.llamarpc.com'),
  fallbacks: [],
};

interface ChainInfo {
  chainId: string;
  name: string;
  logo: string;
  rgb: string;
  rpc: string;
  namespace: string;
  caip: string;
}

interface Eip155Chains {
  [key: string]: ChainInfo;
}

type Event = {
  id: string;
  type: string;
  request: any;
  status: 'request' | 'approval' | 'completed';
  timestamp: string;
};

interface ProviderRpcError extends Error {
  code: number;
  data?: unknown;
}

export const createProviderRpcError = (code: number, message: string, data?: unknown): ProviderRpcError => {
  const error = new Error(message) as ProviderRpcError;
  error.code = code;
  if (data) error.data = data;
  return error;
};

let isPopupOpen = false; // Flag to track popup state

const openPopup = function () {
  const tag = TAG + ' | openPopup | ';
  try {
    console.log(tag, 'Opening popup');
    chrome.windows.create(
      {
        url: chrome.runtime.getURL('popup/index.html'), // Adjust the URL to your popup file
        type: 'popup',
        width: 360,
        height: 900,
      },
      window => {
        if (chrome.runtime.lastError) {
          console.error('Error creating popup:', chrome.runtime.lastError);
          isPopupOpen = false;
        } else {
          console.log('Popup window created:', window);
        }
      },
    );
  } catch (e) {
    console.error(tag, e);
  }
};

/*
  "requestInfo": {
    "chain": "ethereum",
    "href": "http://localhost:5173/",
    "id": 1,
    "language": "en-US",
    "method": "personal_sign",
    "params": [
      "Hello, World!",
      null
    ],
    "platform": "MacIntel",
    "referrer": "",
    "requestTime": "2024-09-19T20:33:37.020Z",
    "scriptSource": "KeepKey Extension",
    "siteUrl": "http://localhost:5173/",
    "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "version": "1.0.7"
  },


 */

const requireApproval = async function (networkId, requestInfo, chain, method, params, KEEPKEY_WALLET) {
  const tag = TAG + ' | requireApproval | ';
  try {
    isPopupOpen = true;
    console.log(tag, 'networkId:', networkId);

    //if chain is ethereum, use current context for networkId

    //chain to networkId
    // const networkId = caipToNetworkId(shortListNameToCaip[chain]);
    // if (!networkId) throw Error('unhandled chain ' + chain);
    // console.log(tag, 'NetworkId:', networkId);

    //if evm set from address

    //if token transfer, set assetContext to token

    //set assetContext

    const event = {
      id: requestInfo.id || uuidv4(),
      networkId,
      chain,
      href: requestInfo.href,
      language: requestInfo.language,
      platform: requestInfo.platform,
      referrer: requestInfo.referrer,
      requestTime: requestInfo.requestTime,
      scriptSource: requestInfo.scriptSource,
      siteUrl: requestInfo.siteUrl,
      userAgent: requestInfo.userAgent,
      injectScriptVersion: requestInfo.version,
      requestInfo,
      type: method,
      request: params,
      status: 'request',
      timestamp: new Date().toISOString(),
    };
    console.log(tag, 'Requesting approval for event:', event);
    const eventSaved = await requestStorage.addEvent(event);
    if (eventSaved) {
      chrome.runtime.sendMessage({
        action: 'TRANSACTION_CONTEXT_UPDATED',
        id: event.id,
      });
      console.log(tag, 'Event saved:', event);
    } else {
      throw new Error('Event not saved');
    }
    openPopup();

    // Wait for user's decision and return the result
    return new Promise(resolve => {
      const listener = (message, sender, sendResponse) => {
        if (message.action === 'eth_sign_response' && message.response.eventId === event.id) {
          console.log(tag, 'Received eth_sign_response for event:', message.response.eventId);
          chrome.runtime.onMessage.removeListener(listener);
          if (message.response.decision === 'accept') {
            resolve({ success: true });
          } else {
            resolve({ success: false });
          }
        }
      };
      chrome.runtime.onMessage.addListener(listener);
    });
  } catch (e) {
    console.error(tag, e);
    return { success: false }; // Return failure in case of error
  }
};

const requireUnlock = async function () {
  const tag = TAG + ' | requireUnlock | ';
  try {
    console.log(tag, 'requireUnlock for domain');
    // openPopup();
  } catch (e) {
    console.error(e);
    isPopupOpen = false;
  }
};

export const handleWalletRequest = async (
  requestInfo: any,
  chain: string,
  method: string,
  params: any[],
  KEEPKEY_WALLET: any,
  ADDRESS: string,
): Promise<any> => {
  const tag = ' | handleWalletRequest | ';
  try {
    console.log(tag, 'id:', requestInfo.id);
    console.log(tag, 'chain:', chain);
    console.log(tag, 'params:', params);
    console.log(tag, 'requestInfo:', requestInfo);
    console.log(tag, 'KEEPKEY_WALLET:', KEEPKEY_WALLET);
    if (!chain) throw Error('Chain not provided!');
    if (!requestInfo) throw Error('Cannot validate request! Refusing to proceed.');

    switch (chain) {
      case 'ethereum': {
        return await handleEthereumRequest(method, params, requestInfo, ADDRESS, KEEPKEY_WALLET, requireApproval);
        break;
      }
      case 'bitcoin': {
        return await handleBitcoinRequest(method, params, requestInfo, ADDRESS, KEEPKEY_WALLET, requireApproval);
        break;
      }
      case 'bitcoincash': {
        return await handleBitcoinCashRequest(method, params, requestInfo, ADDRESS, KEEPKEY_WALLET, requireApproval);
        break;
      }
      case 'dogecoin': {
        console.log(tag, 'checkpoint handle doge');
        return await handleDogecoinRequest(method, params, requestInfo, ADDRESS, KEEPKEY_WALLET, requireApproval);
        break;
      }
      case 'litecoin': {
        console.log(tag, 'checkpoint handle litecoin');
        return await handleLitecoinRequest(method, params, requestInfo, ADDRESS, KEEPKEY_WALLET, requireApproval);
        break;
      }
      case 'dash': {
        return await handleDashRequest(method, params, requestInfo, ADDRESS, KEEPKEY_WALLET, requireApproval);
        break;
      }
      case 'thorchain': {
        return await handleThorchainRequest(method, params, requestInfo, ADDRESS, KEEPKEY_WALLET, requireApproval);
        break;
      }
      case 'osmosis': {
        return await handleOsmosisRequest(method, params, requestInfo, ADDRESS, KEEPKEY_WALLET, requireApproval);
        break;
      }
      case 'cosmos': {
        return await handleCosmosRequest(method, params, requestInfo, ADDRESS, KEEPKEY_WALLET, requireApproval);
        break;
      }
      case 'ripple': {
        return await handleRippleRequest(method, params, requestInfo, ADDRESS, KEEPKEY_WALLET, requireApproval);
        break;
      }
      case 'mayachain': {
        return await handleMayaRequest(method, params, requestInfo, ADDRESS, KEEPKEY_WALLET, requireApproval);
        break;
      }
      default: {
        console.log(tag, `Chain ${chain} not supported`);
        throw createProviderRpcError(4200, `Chain ${chain} not supported`);
      }
    }
  } catch (error) {
    console.error(tag, `Error processing method ${method}:`, error);
    if ((error as ProviderRpcError).code && (error as ProviderRpcError).message) {
      throw error;
    } else {
      throw createProviderRpcError(4000, `Unexpected error processing method ${method}`, error);
    }
  }
};

// Handle message to get the current provider
chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
  const tag = TAG + ' | chrome.runtime.onMessage | ';

  if (message.type === 'GET_PROVIDER') {
    sendResponse({ provider: CURRENT_PROVIDER });
    return true;
  }

  // Return false if the message type is not handled
  return false;
});
