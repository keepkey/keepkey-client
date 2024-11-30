/*
    Ethereum Provider Refactored
*/

import { Chain } from '@coinmasters/types';
import { JsonRpcProvider } from 'ethers';
import { createProviderRpcError } from '../utils';
import { requestStorage, web3ProviderStorage, assetContextStorage, blockchainDataStorage } from '@extension/storage';
import { EIP155_CHAINS } from '../chains';
import { v4 as uuidv4 } from 'uuid';
import { blockchainStorage } from '@extension/storage';

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

// Helper function to get the provider
const getProvider = async (): Promise<JsonRpcProvider> => {
  const currentProvider = await web3ProviderStorage.getWeb3Provider();
  if (!currentProvider || !currentProvider.providerUrl) {
    throw new Error('Provider not properly configured');
  }
  return new JsonRpcProvider(currentProvider.providerUrl);
};

// Handler functions for each method

const handleEthChainId = async () => {
  const currentProvider = await web3ProviderStorage.getWeb3Provider();
  return currentProvider.chainId;
};

const handleNetVersion = async () => {
  const currentProvider = await web3ProviderStorage.getWeb3Provider();
  const netVersion = currentProvider.chainId.toString();
  return convertHexToDecimalChainId(netVersion).toString();
};

const handleEthGetBlockByNumber = async params => {
  const provider = await getProvider();
  const blockByNumber = await provider.getBlock(params[0]);
  return blockByNumber;
};

const handleEthBlockNumber = async () => {
  const provider = await getProvider();
  const blockNumber = await provider.getBlockNumber();
  return '0x' + blockNumber.toString(16);
};

const handleEthGetBalance = async params => {
  const provider = await getProvider();
  const balance = await provider.getBalance(params[0], params[1]);
  return '0x' + balance.toString(16);
};

const handleEthGetTransactionReceipt = async params => {
  const provider = await getProvider();
  const transactionReceipt = await provider.getTransactionReceipt(params[0]);
  return transactionReceipt;
};

const handleEthGetTransactionByHash = async params => {
  const provider = await getProvider();
  const transactionByHash = await provider.getTransaction(params[0]);
  return transactionByHash;
};

const handleWeb3ClientVersion = async () => {
  const provider = await getProvider();
  const clientVersion = await provider.send('web3_clientVersion', []);
  return clientVersion;
};

const handleEthCall = async params => {
  const provider = await getProvider();
  const [callParams, blockTag, stateOverride] = params;
  const callResult = await provider.call(callParams, blockTag, stateOverride);
  return callResult;
};

const handleEthMaxPriorityFeePerGas = async () => {
  const provider = await getProvider();
  const feeData = await provider.getFeeData();
  return feeData.maxPriorityFeePerGas ? '0x' + feeData.maxPriorityFeePerGas.toString(16) : '0x0';
};

const handleEthMaxFeePerGas = async () => {
  const provider = await getProvider();
  const feeData = await provider.getFeeData();
  return feeData.maxFeePerGas ? '0x' + feeData.maxFeePerGas.toString(16) : '0x0';
};

const handleEthEstimateGas = async params => {
  const provider = await getProvider();
  const estimateGas = await provider.estimateGas(params[0]);
  return '0x' + estimateGas.toString(16);
};

const handleEthGasPrice = async () => {
  const provider = await getProvider();
  const feeData = await provider.getFeeData();
  return '0x' + feeData.gasPrice.toString(16);
};

const handleEthGetCode = async params => {
  const provider = await getProvider();
  const code = await provider.getCode(params[0], params[1]);
  return code;
};

const handleEthGetStorageAt = async params => {
  const provider = await getProvider();
  const storage = await provider.getStorageAt(params[0], params[1], params[2]);
  return storage;
};

const handleEthGetTransactionCount = async params => {
  const provider = await getProvider();
  const transactionCount = await provider.getTransactionCount(params[0], params[1]);
  return '0x' + transactionCount.toString(16);
};

const handleEthSendRawTransaction = async params => {
  const provider = await getProvider();
  const txResponse = await provider.broadcastTransaction(params[0]);
  return txResponse.hash;
};

const handleWalletAddEthereumChain = async (params, KEEPKEY_WALLET) => {
  const tag = TAG + ' | handleWalletAddEthereumChain | ';
  console.log(tag, 'Switching Chain params: ', params);
  if (!params || !params[0] || !params[0].chainId) throw new Error('Invalid chainId (Required)');

  const chainIdHex = params[0].chainId;
  const chainIdDecimal = parseInt(chainIdHex, 16);
  const chainId = chainIdDecimal.toString();
  const networkId = 'eip155:' + chainIdDecimal;
  console.log(tag, 'Switching Chain networkId: ', networkId);

  let currentProvider: any = await web3ProviderStorage.getWeb3Provider();

  if (params[0].rpcUrls && params[0].rpcUrls[0]) {
    const name = params[0].chainName;
    console.log(tag, 'Switching Chain name: ', name);
    currentProvider = {
      explorer: params[0].blockExplorerUrls[0],
      explorerAddressLink: params[0].blockExplorerUrls[0] + '/address/',
      explorerTxLink: params[0].blockExplorerUrls[0] + '/tx/',
      chainId,
      networkId,
      caip: `eip155:${chainIdDecimal}/slip44:60`,
      name: params[0].chainName,
      type: 'evm',
      identifier: params[0].chainName,
      nativeCurrency: params[0].nativeCurrency,
      symbol: params[0].nativeCurrency.symbol,
      precision: params[0].nativeCurrency.decimals,
      providerUrl: params[0].rpcUrls[0],
      providers: params[0].rpcUrls,
    };
    blockchainStorage.addBlockchain(currentProvider.networkId);
    blockchainDataStorage.addBlockchainData(currentProvider.networkId, currentProvider);
    console.log(tag, 'currentProvider', currentProvider);
  } else {
    console.log(tag, 'Switching to network without loading provider!: networkId', networkId);

    let chainFound = false;

    if (EIP155_CHAINS[networkId]) {
      console.log(tag, 'Chain found in defaults');
      currentProvider = {
        chainId: chainId,
        caip: EIP155_CHAINS[networkId].caip,
        networkId,
        name: EIP155_CHAINS[networkId].name,
        providerUrl: EIP155_CHAINS[networkId].rpc,
      };
      chainFound = true;
    } else {
      console.log(tag, 'Chain not found in defaults');
      const nodeInfoResponse = await KEEPKEY_WALLET.pioneer.SearchNodesByNetworkId({ chainId });
      const nodeInfo = nodeInfoResponse.data;
      console.log(tag, 'nodeInfo', nodeInfo);
      if (!nodeInfo[0] || !nodeInfo[0].service) throw new Error('Node not found! Unable to change networks!');

      let allProviders = [];
      for (let i = 0; i < nodeInfo.length; i++) {
        allProviders = allProviders.concat(nodeInfo[i].network);
      }

      currentProvider = {
        explorer: nodeInfo[0].infoURL,
        explorerAddressLink: nodeInfo[0].infoURL + '/address/',
        explorerTxLink: nodeInfo[0].infoURL + '/tx/',
        chainId: chainId,
        networkId,
        symbol: nodeInfo[0].nativeCurrency.symbol,
        name: nodeInfo[0].name,
        icon: nodeInfo[0].image,
        logo: nodeInfo[0].image,
        image: nodeInfo[0].image,
        type: nodeInfo[0].type.toLowerCase(),
        caip: nodeInfo[0].caip,
        rpc: nodeInfo[0].service,
        providerUrl: nodeInfo[0].service,
        providers: allProviders,
      };
      chainFound = true;
      blockchainStorage.addBlockchain(currentProvider.networkId);
      blockchainDataStorage.addBlockchainData(currentProvider.networkId, currentProvider);
    }

    if (!chainFound) {
      throw new Error(`Chain with chainId ${chainId} not found.`);
    }
  }

  assetContextStorage.updateContext(currentProvider);
  if (currentProvider != null) {
    await web3ProviderStorage.saveWeb3Provider(currentProvider);
  } else {
    throw Error('Failed to set provider! empty provider!');
  }

  console.log('Changing context to caip', currentProvider.caip);
  console.log('Changing context to networkId', currentProvider.networkId);
  if (!currentProvider.caip) throw Error('invalid provider! missing caip');
  if (!currentProvider.networkId) throw Error('invalid provider! missing networkId');
  const result = await KEEPKEY_WALLET.setAssetContext(currentProvider);
  console.log('Result ', result);
  console.log('KEEPKEY_WALLET.assetContext ', KEEPKEY_WALLET.assetContext);

  chrome.runtime.sendMessage({ type: 'PROVIDER_CHANGED', provider: currentProvider });
  chrome.runtime.sendMessage({ type: 'ASSET_CONTEXT_UPDATED', assetContext: KEEPKEY_WALLET.assetContext });

  return true;
};

const handleWalletGetSnaps = async () => {
  return [];
};

const handleWalletWatchAsset = async () => {
  return true;
};

const handleWalletPermissions = async () => {
  const permissions = [{ parentCapability: 'eth_accounts' }];
  return permissions;
};

const handleEthAccounts = async ADDRESS => {
  const accounts = [ADDRESS];
  return accounts;
};

const handleEthRequestAccounts = async ADDRESS => {
  const requestAccounts = [ADDRESS];
  return requestAccounts;
};

const handleSigningMethods = async (method, params, requestInfo, ADDRESS, KEEPKEY_WALLET, requireApproval) => {
  const tag = TAG + ` | handleSigningMethods | `;
  console.log(tag, 'method:', method);
  console.log(tag, 'params:', params);
  const currentProvider = await web3ProviderStorage.getWeb3Provider();
  console.log(tag, 'currentProvider:', currentProvider);

  if (!KEEPKEY_WALLET.assetContext || currentProvider.caip !== KEEPKEY_WALLET.assetContext.caip) {
    // Set context to the chain, defaults to ETH
    const currentProvider = await web3ProviderStorage.getWeb3Provider();
    await KEEPKEY_WALLET.setAssetContext({ caip: currentProvider.caip });
  }
  const networkId = KEEPKEY_WALLET.assetContext.networkId;
  console.log(tag, 'networkId:', networkId);
  if (!networkId) throw Error('Failed to set context before sending!');

  // Require user approval
  requestInfo.id = uuidv4();
  const result = await requireApproval(networkId, requestInfo, 'ethereum', method, params[0]);
  console.log(tag, 'requireApproval result:', result);

  if (result.success) {
    //TODO reload the params from storage (it may have updated!)
    const approvalResponse = await processApprovedEvent(method, params, KEEPKEY_WALLET, ADDRESS, requestInfo.id);
    return approvalResponse;
  } else {
    throw createProviderRpcError(4200, 'User denied transaction');
  }
};

const convertToHex = (amountInEther: string) => {
  const weiMultiplier = BigInt(1e18); // 1 Ether = 1e18 Wei
  const amountInWei = BigInt(parseFloat(amountInEther || '0') * 1e18); // Convert Ether to Wei

  // Convert the amount in Wei to a hex string
  return '0x' + amountInWei.toString(16);
};

// For 'transfer', build transaction info before calling requireApproval
const handleTransfer = async (params, requestInfo, ADDRESS, KEEPKEY_WALLET, requireApproval) => {
  const tag = TAG + ' | handleTransfer | ';
  console.log(tag, 'method: transfer');
  console.log(tag, 'params:', params);
  console.log(tag, 'requestInfo:', requestInfo);

  if (!KEEPKEY_WALLET.assetContext) {
    // Set context to the chain, defaults to ETH
    const currentProvider = await web3ProviderStorage.getWeb3Provider();
    await KEEPKEY_WALLET.setAssetContext({ caip: currentProvider.caip });
  }
  const networkId = KEEPKEY_WALLET.assetContext.networkId;
  console.log(tag, 'networkId:', networkId);
  if (!networkId) throw Error('Failed to set context before sending!');

  // Build transaction info before requireApproval
  const transaction = params[0];
  console.log(tag, 'transaction:', transaction);
  transaction.value = convertToHex(transaction.amount.amount);
  delete transaction.amount;
  // Ensure 'from' is set
  transaction.from = transaction.from || ADDRESS;

  // Get provider
  const provider = await getProvider();

  // Get chainId
  const currentProvider = await web3ProviderStorage.getWeb3Provider();
  const chainId = currentProvider.chainId;

  transaction.chainId = chainId;

  // Determine if isEIP1559
  const isEIP1559 = chainId === '1' || chainId === 1 || chainId === '0x1';

  // Get fee data
  const feeData = await provider.getFeeData();

  // Get nonce
  const nonce = await provider.getTransactionCount(transaction.from, 'pending');
  transaction.nonce = '0x' + nonce.toString(16);

  // Estimate gas limit
  let estimatedGasLimit;
  try {
    estimatedGasLimit = await provider.estimateGas({
      from: transaction.from,
      to: transaction.to,
      value: transaction.value,
      data: transaction.data,
    });
    transaction.gasLimit = '0x' + estimatedGasLimit.toString(16);
  } catch (e) {
    console.error('Failed to estimate gas limit:', e);
    // Set default gasLimit if estimation fails
    transaction.gasLimit = '0x' + BigInt('281000').toString(16); // minimum gas limit for ETH transfer
  }

  // Set fee data
  if (isEIP1559 && feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
    transaction.maxFeePerGas = '0x' + feeData.maxFeePerGas.toString(16);
    transaction.maxPriorityFeePerGas = '0x' + feeData.maxPriorityFeePerGas.toString(16);
  } else {
    transaction.gasPrice = feeData.gasPrice ? '0x' + feeData.gasPrice.toString(16) : undefined;
  }
  //assign eventId
  requestInfo.id = uuidv4();
  // Now call requireApproval with the transaction info
  const result = await requireApproval(networkId, requestInfo, 'ethereum', 'transfer', transaction);

  console.log(tag, 'requireApproval result:', result);
  //get payload from storage
  const response = await requestStorage.getEventById(requestInfo.id);
  console.log(tag, 'response:', response);

  if (result.success) {
    // Prepare transaction input for signing
    const input: any = {
      from: response.request.from,
      addressNList: [2147483692, 2147483708, 2147483648, 0, 0],
      data: response.request.data || '0x',
      nonce: response.request.nonce,
      gasLimit: response.request.gasLimit,
      gas: response.request.gasLimit,
      value: response.request.value || '0x0',
      to: response.request.to,
      chainId,
    };
    if (response.request.gasPrice) input.gasPrice = response.request.gasPrice;
    if (response.request.maxFeePerGas) input.maxFeePerGas = response.request.maxFeePerGas;
    if (response.request.maxPriorityFeePerGas) input.maxPriorityFeePerGas = response.request.maxPriorityFeePerGas;

    if (!input.gasPrice && !input.maxFeePerGas) throw Error('Failed to set gas price');
    console.log(tag, 'Final transaction input:', input);

    // Sign transaction
    const signedTx = await KEEPKEY_WALLET.keepKeySdk.eth.ethSignTransaction(input);
    console.log(tag, 'Signed transaction:', signedTx);

    response.signedTx = signedTx.serialized;
    await requestStorage.updateEventById(requestInfo.id, response);

    // Broadcast transaction
    const txHash = await broadcastTransaction(signedTx.serialized);

    //Placeholder for broadcast transaction testing
    // const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    // await delay(3000);
    //
    // const txHash = '';

    //push hash to front end
    response.txid = txHash;
    response.assetContext = KEEPKEY_WALLET.assetContext;
    await requestStorage.updateEventById(requestInfo.id, response);

    //push event
    chrome.runtime.sendMessage({
      action: 'transaction_complete',
      txHash: txHash,
    });

    return txHash;
  } else {
    throw createProviderRpcError(4200, 'User denied transaction');
  }
};

// Main handler function
export const handleEthereumRequest = async (
  method: string,
  params: any[],
  requestInfo: any,
  ADDRESS: string,
  KEEPKEY_WALLET: any,
  requireApproval: (networkId: string, requestInfo: any, chain: any, method: string, params: any) => Promise<any>,
): Promise<any> => {
  const tag = ' | handleEthereumRequest | ';
  console.log(tag, 'method: ', method);

  switch (method) {
    case 'eth_chainId':
      return await handleEthChainId();

    case 'net_version':
      return await handleNetVersion();

    case 'eth_getBlockByNumber':
      return await handleEthGetBlockByNumber(params);

    case 'eth_blockNumber':
      return await handleEthBlockNumber();

    case 'eth_getBalance':
      return await handleEthGetBalance(params);

    case 'eth_getTransactionReceipt':
      return await handleEthGetTransactionReceipt(params);

    case 'eth_getTransactionByHash':
      return await handleEthGetTransactionByHash(params);

    case 'web3_clientVersion':
      return await handleWeb3ClientVersion();

    case 'eth_call':
      return await handleEthCall(params);

    case 'eth_maxPriorityFeePerGas':
      return await handleEthMaxPriorityFeePerGas();

    case 'eth_maxFeePerGas':
      return await handleEthMaxFeePerGas();

    case 'eth_estimateGas':
      return await handleEthEstimateGas(params);

    case 'eth_gasPrice':
      return await handleEthGasPrice();

    case 'eth_getCode':
      return await handleEthGetCode(params);

    case 'eth_getStorageAt':
      return await handleEthGetStorageAt(params);

    case 'eth_getTransactionCount':
      return await handleEthGetTransactionCount(params);

    case 'eth_sendRawTransaction':
      return await handleEthSendRawTransaction(params);

    case 'wallet_addEthereumChain':
    case 'wallet_switchEthereumChain':
      return await handleWalletAddEthereumChain(params, KEEPKEY_WALLET);

    case 'wallet_getSnaps':
      return await handleWalletGetSnaps();

    case 'wallet_watchAsset':
      return await handleWalletWatchAsset();

    case 'wallet_getPermissions':
    case 'wallet_requestPermissions':
      return await handleWalletPermissions();

    case 'request_accounts':
    case 'eth_accounts':
      return await handleEthAccounts(ADDRESS);

    case 'eth_requestAccounts':
      return await handleEthRequestAccounts(ADDRESS);

    case 'eth_sendTransaction':
    case 'eth_signTransaction':
    case 'personal_sign':
    case 'eth_sign':
    case 'eth_signTypedData':
    case 'eth_signTypedData_v3':
    case 'eth_signTypedData_v4':
      return await handleSigningMethods(method, params, requestInfo, ADDRESS, KEEPKEY_WALLET, requireApproval);

    case 'transfer':
      return await handleTransfer(params, requestInfo, ADDRESS, KEEPKEY_WALLET, requireApproval);

    case 'eth_getEncryptionPublicKey':
      throw createProviderRpcError(4200, 'Method eth_getEncryptionPublicKey not supported');

    default:
      throw createProviderRpcError(4200, `Method ${method} not supported`);
  }
};

// Helper functions for processing approvals and signing

const processApprovedEvent = async (method: string, params: any, KEEPKEY_WALLET: any, ADDRESS: string, id: string) => {
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
        result = await sendTransaction(params, KEEPKEY_WALLET, ADDRESS, id);
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

    let nonce;
    if (!transaction.nonce) {
      // Get the nonce from the provider for the account
      nonce = await provider.getTransactionCount(transaction.from, 'latest');
      transaction.nonce = '0x' + nonce.toString(16);
    }

    if (!transaction.gasLimit) {
      console.error(tag, 'Asked to estimate gas on a signTransaction!');
      try {
        console.log('estimateGasPayload: ', {
          from: transaction.from,
          to: transaction.to,
          data: transaction.data,
        });

        let estimatedGas: any = await provider.estimateGas({
          from: transaction.from,
          to: transaction.to,
          data: transaction.data,
        });

        console.log(tag, 'Estimated gas: ', estimatedGas.toString());

        // If estimated gas is less than 115,000, set a warning and adjust
        if (estimatedGas < 615000) {
          console.warn(tag, `Estimated gas too low (${estimatedGas.toString()}). Using minimum of 115000.`);
          estimatedGas = 615000;
        }

        // If estimated gas exceeds 115,000, apply 25% bump
        if (estimatedGas > 615000) {
          estimatedGas = BigInt(estimatedGas) + BigInt(estimatedGas) / BigInt(4); // Adds 25%
          console.log(tag, `Increased gas by 25%: ${estimatedGas.toString()}`);
        }

        // Never exceed 2 million gas
        if (estimatedGas > 2000000) {
          console.warn(tag, `Estimated gas exceeds max limit. Using 1,000,000.`);
          estimatedGas = 2000000;
        }

        transaction.gasLimit = '0x' + estimatedGas.toString(16); // Convert to hex
      } catch (e) {
        console.error(tag, 'e: ', e);
        console.error(tag, 'Error estimating gas, using fallback 115,000 gas limit.');
        transaction.gasLimit = '0x' + BigInt('315000').toString(16); // Fallback gas limit
      }
    }

    const input: any = {
      from: transaction.from,
      addressNList: [2147483692, 2147483708, 2147483648, 0, 0],
      data: transaction.data || '0x',
      nonce: transaction.nonce,
      gasLimit: transaction.gasLimit,
      gas: transaction.gasLimit,
      value: transaction.value || '0x0',
      to: transaction.to,
      chainId: transaction.chainId,
    };

    // Set fee data
    if (transaction.maxFeePerGas && transaction.maxPriorityFeePerGas) {
      input.maxFeePerGas = transaction.maxFeePerGas;
      input.maxPriorityFeePerGas = transaction.maxPriorityFeePerGas;
    } else if (transaction.gasPrice) {
      input.gasPrice = transaction.gasPrice;
    } else {
      // Fetch fee data if not provided
      const feeData = await provider.getFeeData();
      input.gasPrice = feeData.gasPrice ? '0x' + feeData.gasPrice.toString(16) : undefined;
    }

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
    const typedData = params[1];
    const { domain, types, message, primaryType } = JSON.parse(typedData);
    const HDWalletPayload = {
      address: ADDRESS,
      addressNList: [2147483692, 2147483708, 2147483648, 0, 0],
      typedData: { domain, types, message, primaryType },
    };
    console.log(tag, '**** HDWalletPayload: ', HDWalletPayload);
    console.log(tag, '**** HDWalletPayload: ', JSON.stringify(HDWalletPayload));
    const signedMessage = await KEEPKEY_WALLET.keepKeySdk.eth.ethSignTypedData(HDWalletPayload);
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
    return txResponse.hash;
  } catch (e) {
    console.error(tag, e);
    throw createProviderRpcError(4000, 'Error broadcasting transaction', e);
  }
};

const sendTransaction = async (params: any, KEEPKEY_WALLET: any, ADDRESS: string, id: string) => {
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

    const txHash = await broadcastTransaction(signedTx);
    console.log(tag, 'txHash:', txHash);

    const response = await requestStorage.getEventById(id);
    console.log(tag, 'response:', response);

    response.txid = txHash;
    await requestStorage.updateEventById(id, response);

    //push event
    chrome.runtime.sendMessage({
      action: 'transaction_complete',
      txHash: txHash,
    });

    return txHash;
  } catch (e) {
    console.error(e);
    throw createProviderRpcError(4000, 'Error sending transaction', e);
  }
};
