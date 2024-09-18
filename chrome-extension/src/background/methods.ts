import { JsonRpcProvider } from 'ethers';
import { requestStorage } from '@extension/storage';
// import axios from 'axios';
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
import { handleMayaRequest } from './chains/mayaHandler';

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
        width: 400,
        height: 600,
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

const requireApproval = async function (requestInfo: any, chain: any, method: string, params: any) {
  const tag = TAG + ' | requireApproval | ';
  try {
    isPopupOpen = true;
    const event: Event = {
      id: uuidv4(),
      type: method,
      request: params,
      status: 'request',
      timestamp: new Date().toISOString(),
    };
    console.log(tag, 'Requesting approval for event:', event);
    const eventSaved = await requestStorage.addEvent(event);
    if (eventSaved) {
      console.log(tag, 'eventSaved:', eventSaved);
      console.log(tag, 'Event saved:', event);
    } else {
      throw new Error('Event not saved');
    }
    // openPopup();
  } catch (e) {
    console.error(tag, e);
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
  provider: JsonRpcProvider,
  KEEPKEY_WALLET: any,
  ADDRESS: string,
): Promise<any> => {
  const tag = ' | handleWalletRequest | ';
  try {
    console.log(tag, 'id:', requestInfo.id);
    console.log(tag, 'chain:', chain);
    console.log(tag, 'requestInfo:', requestInfo);
    if (!chain) throw Error('Chain not provided!');
    if (!requestInfo) throw Error('Cannot validate request! Refusing to proceed.');

    // if (!ADDRESS || !ADDRESS.length) {
    //   console.log('Device is not paired!');
    //   await requireUnlock();
    // }

    switch (chain) {
      case 'ethereum': {
        return await handleEthereumRequest(
          method,
          params,
          provider,
          CURRENT_PROVIDER,
          requestInfo,
          ADDRESS,
          KEEPKEY_WALLET,
          requireApproval,
        );
      }
      case 'bitcoin': {
        return await handleBitcoinRequest(
          method,
          params,
          provider,
          CURRENT_PROVIDER,
          requestInfo,
          ADDRESS,
          KEEPKEY_WALLET,
          requireApproval,
        );
      }
      case 'bitcoincash': {
        return await handleBitcoinCashRequest(
          method,
          params,
          provider,
          CURRENT_PROVIDER,
          requestInfo,
          ADDRESS,
          KEEPKEY_WALLET,
          requireApproval,
        );
      }
      case 'dogecoin': {
        return await handleDogecoinRequest(
          method,
          params,
          provider,
          CURRENT_PROVIDER,
          requestInfo,
          ADDRESS,
          KEEPKEY_WALLET,
          requireApproval,
        );
      }
      case 'litecoin': {
        return await handleLitecoinRequest(
          method,
          params,
          provider,
          CURRENT_PROVIDER,
          requestInfo,
          ADDRESS,
          KEEPKEY_WALLET,
          requireApproval,
        );
      }
      case 'dash': {
        return await handleDashRequest(
          method,
          params,
          provider,
          CURRENT_PROVIDER,
          requestInfo,
          ADDRESS,
          KEEPKEY_WALLET,
          requireApproval,
        );
      }
      case 'thorchain': {
        return await handleThorchainRequest(
          method,
          params,
          provider,
          CURRENT_PROVIDER,
          requestInfo,
          ADDRESS,
          KEEPKEY_WALLET,
          requireApproval,
        );
      }
      case 'cosmos': {
        return await handleCosmosRequest(
          method,
          params,
          provider,
          CURRENT_PROVIDER,
          requestInfo,
          ADDRESS,
          KEEPKEY_WALLET,
          requireApproval,
        );
      }
      case 'mayachain': {
        return await handleMayaRequest(
          method,
          params,
          provider,
          CURRENT_PROVIDER,
          requestInfo,
          ADDRESS,
          KEEPKEY_WALLET,
          requireApproval,
        );
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
