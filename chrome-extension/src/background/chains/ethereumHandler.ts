/*
    Ethereum Provider
*/

import { Chain } from '@coinmasters/types';
import { JsonRpcProvider } from 'ethers';
import { createProviderRpcError } from '../utils';
import { requestStorage, approvalStorage, assetContextStorage } from '@extension/storage';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { EIP155_CHAINS } from '../chains';

const TAG = ' | ethereumHandler | ';
const DOMAIN_WHITE_LIST = [];

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

          // Optionally, handle the popup window focus or other behaviors
        }
      },
    );
  } catch (e) {
    console.error(tag, e);
  }
};

const requireUnlock = async function () {
  const tag = TAG + ' | requireUnlock | ';
  try {
    console.log(tag, 'requireUnlock for domain');
    openPopup();
  } catch (e) {
    console.error(e);
    isPopupOpen = false;
  }
};

const convertHexToDecimalChainId = (hexChainId: string): number => {
  return parseInt(hexChainId, 16);
};

const sanitizeChainId = (chainId: string): string => {
  return chainId.replace(/^0x0x/, '0x');
};

export const handleEthereumRequest = async (
  method: string,
  params: any[],
  provider: JsonRpcProvider,
  CURRENT_PROVIDER: any,
  requestInfo: any,
  ADDRESS: string,
  KEEPKEY_WALLET: any,
  requireApproval: (requestInfo: any, chain: any, method: string, params: any) => Promise<void>,
): Promise<any> => {
  const tag = ' | handleEthereumRequest | ';
  switch (method) {
    case 'eth_chainId': {
      return CURRENT_PROVIDER.chainId;
    }
    case 'net_version': {
      const netVersion = CURRENT_PROVIDER.chainId.toString();
      return convertHexToDecimalChainId(netVersion).toString();
    }
    case 'eth_getBlockByNumber': {
      const blockByNumber = await CURRENT_PROVIDER.provider.getBlock(params[0]);
      return blockByNumber;
    }
    case 'eth_blockNumber': {
      const blockNumber = await CURRENT_PROVIDER.provider.getBlockNumber();
      return '0x' + blockNumber.toString(16);
    }
    case 'eth_getBalance': {
      const balance = await CURRENT_PROVIDER.provider.getBalance(params[0], params[1]);
      return '0x' + balance.toString(16);
    }
    case 'eth_getTransactionReceipt': {
      const transactionReceipt = await CURRENT_PROVIDER.provider.getTransactionReceipt(params[0]);
      return transactionReceipt;
    }
    case 'eth_getTransactionByHash': {
      const transactionByHash = await CURRENT_PROVIDER.provider.getTransaction(params[0]);
      return transactionByHash;
    }
    case 'eth_call': {
      const [callParams, blockTag, stateOverride] = params;
      const callResult = await CURRENT_PROVIDER.provider.call(callParams, blockTag, stateOverride);
      return callResult;
    }
    case 'eth_maxPriorityFeePerGas': {
      const feeData = await CURRENT_PROVIDER.provider.getFeeData();
      return feeData.maxPriorityFeePerGas ? '0x' + feeData.maxPriorityFeePerGas.toString(16) : '0x0';
    }
    case 'eth_maxFeePerGas': {
      const feeData = await CURRENT_PROVIDER.provider.getFeeData();
      return feeData.maxFeePerGas ? '0x' + feeData.maxFeePerGas.toString(16) : '0x0';
    }
    case 'eth_estimateGas': {
      const estimateGas = await CURRENT_PROVIDER.provider.estimateGas(params[0]);
      return '0x' + estimateGas.toString(16);
    }
    case 'eth_gasPrice': {
      const gasPrice = await CURRENT_PROVIDER.provider.getGasPrice();
      return '0x' + gasPrice.toString(16);
    }
    case 'eth_getCode': {
      const code = await CURRENT_PROVIDER.provider.getCode(params[0], params[1]);
      return code;
    }
    case 'eth_getStorageAt': {
      const storage = await CURRENT_PROVIDER.provider.getStorage(params[0], params[1], params[2]);
      return storage;
    }
    case 'eth_getTransactionCount': {
      const transactionCount = await CURRENT_PROVIDER.provider.getTransactionCount(params[0], params[1]);
      return '0x' + transactionCount.toString(16);
    }
    case 'eth_sendRawTransaction': {
      const txResponse = await CURRENT_PROVIDER.provider.sendTransaction(params[0]);
      return txResponse.hash;
    }
    case 'wallet_addEthereumChain':
    case 'wallet_switchEthereumChain': {
      if (!params || !params[0] || !params[0].chainId) throw new Error('Invalid chainId (Required)');
      let chainId = 'eip155:' + convertHexToDecimalChainId(params[0].chainId);
      chainId = sanitizeChainId(chainId);

      if (params && params[0] && params[0].rpcUrls && params[0].rpcUrls[0]) {
        CURRENT_PROVIDER.blockExplorerUrls = params[0].blockExplorerUrls;
        CURRENT_PROVIDER.chainId = sanitizeChainId(params[0].chainId);
        CURRENT_PROVIDER.caip = `eip155:${parseInt(params[0].chainId, 16)}/slip44:60`;
        CURRENT_PROVIDER.name = params[0].chainName;
        CURRENT_PROVIDER.nativeCurrency = params[0].nativeCurrency;
        CURRENT_PROVIDER.providerUrl = params[0].rpcUrls[0];
        CURRENT_PROVIDER.provider = new JsonRpcProvider(params[0].rpcUrls[0]);
      } else {
        const chainIdToFind = sanitizeChainId(params[0].chainId);
        let chainFound = false;

        for (const key of Object.keys(EIP155_CHAINS)) {
          if (EIP155_CHAINS[key].chainId === chainIdToFind) {
            CURRENT_PROVIDER.chainId = chainIdToFind;
            CURRENT_PROVIDER.caip = EIP155_CHAINS[key].caip;
            CURRENT_PROVIDER.name = EIP155_CHAINS[key].name;
            CURRENT_PROVIDER.providerUrl = EIP155_CHAINS[key].rpc;
            CURRENT_PROVIDER.provider = new JsonRpcProvider(EIP155_CHAINS[key].rpc);
            chainFound = true;
            break;
          }
        }

        if (!chainFound) {
          throw new Error(`Chain with chainId ${chainIdToFind} not found.`);
        }
      }

      // Update context and notify changes
      chrome.runtime.sendMessage({ type: 'PROVIDER_CHANGED', provider: CURRENT_PROVIDER });
      assetContextStorage.updateContext(CURRENT_PROVIDER);
      return true;
    }
    case 'wallet_getSnaps': {
      return [];
    }
    case 'wallet_watchAsset': {
      return true;
    }
    case 'wallet_getPermissions':
    case 'wallet_requestPermissions': {
      const permissions = [{ parentCapability: 'eth_accounts' }];
      return permissions;
    }
    case 'eth_accounts': {
      const accounts = [ADDRESS];
      return accounts;
    }
    case 'eth_requestAccounts': {
      const requestAccounts = [ADDRESS];
      return requestAccounts;
    }
    case 'eth_sendTransaction':
    case 'eth_signTransaction':
    case 'personal_sign':
    case 'eth_sign':
    case 'eth_signTypedData':
    case 'eth_signTypedData_v3':
    case 'eth_signTypedData_v4': {
      // Require user approval
      const result = await requireApproval(requestInfo, 'ethereum', method, params[0]);
      console.log(tag, 'result:', result);

      if (result.success) {
        const approvalResponse = await processApprovedEvent(method, params, CURRENT_PROVIDER, KEEPKEY_WALLET, ADDRESS);
        return approvalResponse;
      } else {
        throw createProviderRpcError(4200, 'User denied transaction');
      }
    }
    case 'eth_getEncryptionPublicKey': {
      throw createProviderRpcError(4200, 'Method eth_getEncryptionPublicKey not supported');
    }
    default: {
      throw createProviderRpcError(4200, `Method ${method} not supported`);
    }
  }
};

const processApprovedEvent = async (
  method: string,
  params: any,
  CURRENT_PROVIDER: any,
  KEEPKEY_WALLET: any,
  ADDRESS: string,
) => {
  try {
    console.log(TAG, 'processApprovedEvent method:', method);
    console.log(TAG, 'processApprovedEvent params:', params);

    let result;
    switch (method) {
      case 'personal_sign':
      case 'eth_sign':
        result = await signMessage(params[0], KEEPKEY_WALLET, ADDRESS);
        break;
      case 'eth_sendTransaction':
        result = await sendTransaction(params, CURRENT_PROVIDER, CURRENT_PROVIDER.provider, KEEPKEY_WALLET, ADDRESS);
        break;
      case 'eth_signTypedData':
      case 'eth_signTypedData_v3':
      case 'eth_signTypedData_v4':
        result = await signTypedData(params, KEEPKEY_WALLET, ADDRESS);
        break;
      case 'eth_signTransaction':
        result = await signTransaction(params[0], CURRENT_PROVIDER.provider, KEEPKEY_WALLET);
        break;
      default:
        console.error(TAG, `Unsupported event type: ${method}`);
        throw createProviderRpcError(4200, `Method ${method} not supported`);
    }

    console.log(TAG, `Returning result for method ${method}:`, result);
    return result;
  } catch (error) {
    console.error(TAG, 'Error processing approved event:', error);
    throw error; // Re-throw the error so it can be handled upstream if needed
  }
};

const signMessage = async (message: any, KEEPKEY_WALLET: any, ADDRESS: string) => {
  try {
    console.log('signMessage: ', message);
    const messageFormatted = `0x${Buffer.from(
      Uint8Array.from(typeof message === 'string' ? new TextEncoder().encode(message) : message),
    ).toString('hex')}`;

    let wallet = await KEEPKEY_WALLET.swapKit.getWallet(Chain.Ethereum);
    const signedMessage = await wallet.ethSign({
      addressNList: [2147483692, 2147483708, 2147483648, 0, 0],
      message: messageFormatted,
      address: ADDRESS,
    });
    return signedMessage.signature;
  } catch (e) {
    console.error(e);
    throw createProviderRpcError(4000, 'Error signing message', e);
  }
};

const signTransaction = async (transaction: any, provider: JsonRpcProvider, KEEPKEY_WALLET: any) => {
  const tag = ' | signTransaction | ';
  try {
    console.log(tag, '**** transaction: ', transaction);
    if (!transaction.from) throw createProviderRpcError(4000, 'Invalid transaction: missing from');
    if (!transaction.to) throw createProviderRpcError(4000, 'Invalid transaction: missing to');
    if (!transaction.chainId) throw createProviderRpcError(4000, 'Invalid transaction: missing chainId');

    const nonce = await provider.getTransactionCount(transaction.from, 'pending');
    transaction.nonce = '0x' + nonce.toString(16);

    const feeData = await provider.getFeeData();
    transaction.gasPrice = feeData.gasPrice ? '0x' + feeData.gasPrice.toString(16) : undefined;
    transaction.maxFeePerGas = feeData.maxFeePerGas ? '0x' + feeData.maxFeePerGas.toString(16) : undefined;
    transaction.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas
      ? '0x' + feeData.maxPriorityFeePerGas.toString(16)
      : undefined;

    try {
      const estimatedGas = await provider.estimateGas({
        from: transaction.from,
        to: transaction.to,
        data: transaction.data,
      });
      transaction.gas = '0x' + estimatedGas.toString(16);
    } catch (e) {
      transaction.gas = '0x' + BigInt('1000000').toString(16);
    }

    const input: any = {
      from: transaction.from,
      addressNList: [2147483692, 2147483708, 2147483648, 0, 0],
      data: transaction.data || '0x',
      nonce: transaction.nonce,
      gasLimit: transaction.gas,
      gas: transaction.gas,
      value: transaction.value || '0x0',
      to: transaction.to,
      chainId: '0x' + parseInt(transaction.chainId, 16).toString(16),
      gasPrice: transaction.gasPrice,
      maxFeePerGas: transaction.maxFeePerGas,
      maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
    };

    console.log(`${tag} Final input: `, input);
    let wallet = await KEEPKEY_WALLET.swapKit.getWallet(Chain.Ethereum);
    console.log('wallet: ', wallet);
    const output = await wallet.sendTransaction(input);
    console.log(`${tag} Transaction output: `, output);

    return output;
  } catch (e) {
    console.error(`${tag} Error: `, e);
    throw createProviderRpcError(4000, 'Error signing transaction', e);
  }
};

const signTypedData = async (params: any, KEEPKEY_WALLET: any, ADDRESS: string) => {
  const tag = ' | signTypedData | ';
  try {
    console.log(tag, '**** params: ', params);
    if (typeof params === 'string') params = JSON.parse(params);

    const payload = {
      address: ADDRESS,
      addressNList: [2147483692, 2147483708, 2147483648, 0, 0], // Adjust the path as needed
      typedData: params[1], // Assuming the typed data is the second parameter
    };
    console.log(tag, '**** payload: ', payload);

    let wallet = await KEEPKEY_WALLET.swapKit.getWallet(Chain.Ethereum);
    console.log('wallet: ', wallet);
    const signedMessage = await wallet.signTypedData(payload);
    console.log(tag, '**** signedMessage: ', signedMessage);
    return signedMessage.signature;
  } catch (e) {
    console.error(`${tag} Error: `, e);
    throw createProviderRpcError(4000, 'Error signing typed data', e);
  }
};

const broadcastTransaction = async (signedTx: string, provider: JsonRpcProvider) => {
  let tag = TAG + ' | broadcastTransaction | ';
  try {
    console.log(tag, 'Broadcasting transaction: ', signedTx);
    //@ts-ignore
    const txResponse = await provider.sendTransaction(signedTx);
    console.log('Transaction response:', txResponse);
    await txResponse.wait(); // Wait for transaction confirmation
    return txResponse.hash;
  } catch (e) {
    console.error(e);
    throw createProviderRpcError(4000, 'Error broadcasting transaction', e);
  }
};

const sendTransaction = async (
  params: any,
  CURRENT_PROVIDER: any,
  provider: JsonRpcProvider,
  KEEPKEY_WALLET: any,
  ADDRESS: string,
) => {
  const tag = ' | sendTransaction | ';
  try {
    console.log(tag, 'User accepted the request');
    console.log(tag, 'transaction:', params);
    console.log(tag, 'CURRENT_PROVIDER: ', CURRENT_PROVIDER);
    const transaction = params[0];
    const chainId = CURRENT_PROVIDER.chainId;
    transaction.chainId = chainId;
    transaction.from = ADDRESS;
    const signedTx = await signTransaction(transaction, provider, KEEPKEY_WALLET);
    console.log(tag, 'signedTx:', signedTx);

    const result = await broadcastTransaction(signedTx, provider);
    console.log(tag, 'result:', result);
    return result;
  } catch (e) {
    console.error(e);
    throw createProviderRpcError(4000, 'Error sending transaction', e);
  }
};
