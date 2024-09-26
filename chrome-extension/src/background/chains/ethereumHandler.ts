/*
    Ethereum Provider Refactored
*/

import { Chain } from '@coinmasters/types';
import { JsonRpcProvider } from 'ethers';
import { createProviderRpcError } from '../utils';
import { web3ProviderStorage, assetContextStorage } from '@extension/storage';
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
  requestInfo: any,
  ADDRESS: string,
  KEEPKEY_WALLET: any,
  requireApproval: (requestInfo: any, chain: any, method: string, params: any) => Promise<void>,
): Promise<any> => {
  const tag = ' | handleEthereumRequest | ';
  switch (method) {
    case 'eth_chainId': {
      const currentProvider = await web3ProviderStorage.getWeb3Provider();
      return currentProvider.chainId;
    }
    case 'net_version': {
      const currentProvider = await web3ProviderStorage.getWeb3Provider();
      const netVersion = currentProvider.chainId.toString();
      return convertHexToDecimalChainId(netVersion).toString();
    }
    case 'eth_getBlockByNumber': {
      const provider = await getProvider();
      const blockByNumber = await provider.getBlock(params[0]);
      return blockByNumber;
    }
    case 'eth_blockNumber': {
      const provider = await getProvider();
      const blockNumber = await provider.getBlockNumber();
      return '0x' + blockNumber.toString(16);
    }
    case 'eth_getBalance': {
      const provider = await getProvider();
      const balance = await provider.getBalance(params[0], params[1]);
      return '0x' + balance.toString(16);
    }
    case 'eth_getTransactionReceipt': {
      const provider = await getProvider();
      const transactionReceipt = await provider.getTransactionReceipt(params[0]);
      return transactionReceipt;
    }
    case 'eth_getTransactionByHash': {
      const provider = await getProvider();
      const transactionByHash = await provider.getTransaction(params[0]);
      return transactionByHash;
    }
    case 'eth_call': {
      const provider = await getProvider();
      const [callParams, blockTag, stateOverride] = params;
      const callResult = await provider.call(callParams, blockTag, stateOverride);
      return callResult;
    }
    case 'eth_maxPriorityFeePerGas': {
      const provider = await getProvider();
      const feeData = await provider.getFeeData();
      return feeData.maxPriorityFeePerGas ? '0x' + feeData.maxPriorityFeePerGas.toString(16) : '0x0';
    }
    case 'eth_maxFeePerGas': {
      const provider = await getProvider();
      const feeData = await provider.getFeeData();
      return feeData.maxFeePerGas ? '0x' + feeData.maxFeePerGas.toString(16) : '0x0';
    }
    case 'eth_estimateGas': {
      const provider = await getProvider();
      const estimateGas = await provider.estimateGas(params[0]);
      return '0x' + estimateGas.toString(16);
    }
    case 'eth_gasPrice': {
      const provider = await getProvider();
      const gasPrice = await provider.getFeeData();
      return '0x' + gasPrice.gasPrice.toString(16);
    }
    case 'eth_getCode': {
      const provider = await getProvider();
      const code = await provider.getCode(params[0], params[1]);
      return code;
    }
    case 'eth_getStorageAt': {
      const provider = await getProvider();
      const storage = await provider.getStorageAt(params[0], params[1], params[2]);
      return storage;
    }
    case 'eth_getTransactionCount': {
      const provider = await getProvider();
      const transactionCount = await provider.getTransactionCount(params[0], params[1]);
      return '0x' + transactionCount.toString(16);
    }
    case 'eth_sendRawTransaction': {
      const provider = await getProvider();
      const txResponse = await provider.broadcastTransaction(params[0]);
      return txResponse.hash;
    }
    case 'wallet_addEthereumChain':
    case 'wallet_switchEthereumChain': {
      if (!params || !params[0] || !params[0].chainId) throw new Error('Invalid chainId (Required)');
      let chainId = 'eip155:' + convertHexToDecimalChainId(params[0].chainId);
      chainId = sanitizeChainId(chainId);

      let currentProvider = await web3ProviderStorage.getWeb3Provider();

      if (params && params[0] && params[0].rpcUrls && params[0].rpcUrls[0]) {
        currentProvider = {
          blockExplorerUrls: params[0].blockExplorerUrls,
          chainId: sanitizeChainId(params[0].chainId),
          caip: `eip155:${parseInt(params[0].chainId, 16)}/slip44:60`,
          name: params[0].chainName,
          nativeCurrency: params[0].nativeCurrency,
          providerUrl: params[0].rpcUrls[0],
        };
      } else {
        const chainIdToFind = sanitizeChainId(params[0].chainId);
        let chainFound = false;

        for (const key of Object.keys(EIP155_CHAINS)) {
          if (EIP155_CHAINS[key].chainId === chainIdToFind) {
            currentProvider = {
              chainId: chainIdToFind,
              caip: EIP155_CHAINS[key].caip,
              name: EIP155_CHAINS[key].name,
              providerUrl: EIP155_CHAINS[key].rpc,
            };
            chainFound = true;
            break;
          }
        }

        if (!chainFound) {
          throw new Error(`Chain with chainId ${chainIdToFind} not found.`);
        }
      }

      // Save the updated provider to storage
      await web3ProviderStorage.saveWeb3Provider(currentProvider);

      // Update context and notify changes
      chrome.runtime.sendMessage({ type: 'PROVIDER_CHANGED', provider: currentProvider });
      assetContextStorage.updateContext(currentProvider);
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
      console.log(tag, 'method:', method);
      console.log(tag, 'params:', params);
      if (!KEEPKEY_WALLET.assetContext) {
        // Set context to the chain, defaults to ETH
        const currentProvider = await web3ProviderStorage.getWeb3Provider();
        await KEEPKEY_WALLET.setAssetContext({ caip: currentProvider.caip });
      }

      // Require user approval
      const result = await requireApproval(requestInfo, 'ethereum', method, params[0]);
      console.log(tag, 'result:', result);

      if (result.success) {
        const approvalResponse = await processApprovedEvent(method, params, KEEPKEY_WALLET, ADDRESS);
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

// Helper function to get the provider
const getProvider = async (): Promise<JsonRpcProvider> => {
  const currentProvider = await web3ProviderStorage.getWeb3Provider();
  if (!currentProvider || !currentProvider.providerUrl) {
    throw new Error('Provider not properly configured');
  }
  return new JsonRpcProvider(currentProvider.providerUrl);
};

const processApprovedEvent = async (method: string, params: any, KEEPKEY_WALLET: any, ADDRESS: string) => {
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
        result = await sendTransaction(params, KEEPKEY_WALLET, ADDRESS);
        break;
      case 'eth_signTypedData':
      case 'eth_signTypedData_v3':
      case 'eth_signTypedData_v4':
        result = await signTypedData(params, KEEPKEY_WALLET, ADDRESS);
        break;
      case 'eth_signTransaction':
        result = await signTransaction(params[0], KEEPKEY_WALLET);
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

const signMessage = async (message, KEEPKEY_WALLET, ADDRESS: string) => {
  const tag = TAG + ' [signMessage] ';
  try {
    console.log(tag, '**** message: ', message);
    console.log(tag, '**** ADDRESS: ', ADDRESS);

    const output = await KEEPKEY_WALLET.keepKeySdk.eth.ethSign({ address: ADDRESS, message: message });
    console.log(`${tag} Transaction output: `, output);

    return output;
  } catch (e) {
    console.error(e);
    throw createProviderRpcError(4000, 'Error signing message', e);
  }
};

const signTransaction = async (transaction: any, KEEPKEY_WALLET: any) => {
  const tag = ' | signTransaction | ';
  try {
    console.log(tag, '**** transaction: ', transaction);
    if (!transaction.from) throw createProviderRpcError(4000, 'Invalid transaction: missing from');
    if (!transaction.to) throw createProviderRpcError(4000, 'Invalid transaction: missing to');
    if (!transaction.chainId) throw createProviderRpcError(4000, 'Invalid transaction: missing chainId');

    const provider = await getProvider();

    const nonce = await provider.getTransactionCount(transaction.from, 'pending');
    if (!transaction.nonce) transaction.nonce = '0x' + nonce.toString(16);
    if (transaction.nonce !== '0x' + nonce.toString(16)) {
      console.error('transaction.nonce:', transaction.nonce);
      console.error('nonce:', nonce);
      console.error('transaction nonce does not match recommended nonce');
    }

    try {
      const estimatedGas = await provider.estimateGas({
        from: transaction.from,
        to: transaction.to,
        data: transaction.data,
      });
      transaction.gas = '0x' + Math.max(Math.floor(estimatedGas.toNumber() * 1.2), 0xc350).toString(16); // 50,000 min
    } catch (e) {
      transaction.gas = '0x' + BigInt('1000000').toString(16); // 1,000,000 fallback with min 50,000
    }

    const feeData = await provider.getFeeData();
    transaction.gasPrice = '0x' + feeData.gasPrice.toString(16);

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
    };
    if (transaction.gasPrice) input.gasPrice = transaction.gasPrice;
    if (transaction.maxFeePerGas) input.maxFeePerGas = transaction.maxFeePerGas;
    if (transaction.maxPriorityFeePerGas) input.maxPriorityFeePerGas = transaction.maxPriorityFeePerGas;

    console.log(`${tag} Final input: `, input);
    const output = await KEEPKEY_WALLET.keepKeySdk.eth.ethSignTransaction(input);
    console.log(`${tag} Transaction output: `, output);

    return output.serialized;
  } catch (e) {
    console.error(`${tag} Error: `, e);
    throw createProviderRpcError(4000, 'Error signing transaction', e);
  }
};

const signTypedData = async (params: any, KEEPKEY_WALLET: any, ADDRESS: string) => {
  const tag = ' | signTypedData | ';
  try {
    console.log(tag, '**** params: ', params);
    const wallet = await KEEPKEY_WALLET.swapKit.getWallet(Chain.Ethereum);
    console.log('wallet: ', wallet);
    let typedData = params[1];
    if (typedData && typeof typedData === 'string') typedData = JSON.parse(typedData);
    const { domain, types, message, primaryType } = typedData;
    const signedMessage = await wallet.signTypedData({ domain, types, message, primaryType });
    console.log(tag, '**** signedMessage: ', signedMessage);
    return signedMessage;
  } catch (e) {
    console.error(`${tag} Error: `, e);
    throw createProviderRpcError(4000, 'Error signing typed data', e);
  }
};

const broadcastTransaction = async (signedTx: string) => {
  const tag = TAG + ' | broadcastTransaction | ';
  try {
    const provider = await getProvider();

    console.log(tag, 'provider: ', provider);
    console.log(tag, 'Broadcasting transaction: ', signedTx);

    const txResponse = await provider.broadcastTransaction(signedTx);
    console.log('Transaction response:', txResponse);
    // await txResponse.wait(); // Wait for transaction confirmation
    return txResponse.hash;
  } catch (e) {
    console.error(tag, e);
    throw createProviderRpcError(4000, 'Error broadcasting transaction', e);
  }
};

const sendTransaction = async (params: any, KEEPKEY_WALLET: any, ADDRESS: string) => {
  const tag = ' | sendTransaction | ';
  try {
    console.log(tag, 'User accepted the request');
    console.log(tag, 'transaction:', params);
    const transaction = params[0];
    const currentProvider = await web3ProviderStorage.getWeb3Provider();
    const chainId = currentProvider.chainId;

    transaction.chainId = chainId;
    transaction.from = ADDRESS;

    const signedTx = await signTransaction(transaction, KEEPKEY_WALLET);
    console.log(tag, 'signedTx:', signedTx);

    const result = await broadcastTransaction(signedTx);
    console.log(tag, 'result:', result);
    return result;
  } catch (e) {
    console.error(e);
    throw createProviderRpcError(4000, 'Error sending transaction', e);
  }
};
