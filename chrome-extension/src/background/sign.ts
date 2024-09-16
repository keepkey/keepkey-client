import { JsonRpcProvider } from 'ethers';
import { createProviderRpcError } from './utils'; // Import createProviderRpcError from a common utilities file

export const signMessage = async (message: any, KEEPKEY_SDK: any) => {
  try {
    console.log('signMessage: ', message);
    console.log('KEEPKEY_SDK.ETH.walletMethods: ', KEEPKEY_SDK.ETH.walletMethods);
    const address = KEEPKEY_SDK.ETH.wallet.address;
    const messageFormatted = `0x${Buffer.from(
      Uint8Array.from(typeof message === 'string' ? new TextEncoder().encode(message) : message),
    ).toString('hex')}`;
    return KEEPKEY_SDK.eth.ethSign({ address, message: messageFormatted });
  } catch (e) {
    console.error(e);
    throw createProviderRpcError(4000, 'Error signing message', e);
  }
};

export const signTransaction = async (transaction: any, provider: JsonRpcProvider, KEEPKEY_SDK: any) => {
  const tag = ' | signTransaction | ';
  try {
    console.log(tag, '**** transaction: ', transaction);

    if (!transaction.from) throw createProviderRpcError(4000, 'Invalid transaction: missing from');
    if (!transaction.to) throw createProviderRpcError(4000, 'Invalid transaction: missing to');
    if (!transaction.chainId) throw createProviderRpcError(4000, 'Invalid transaction: missing chainId');

    const nonce = await provider.getTransactionCount(transaction.from, 'pending');
    transaction.nonce = `0x${nonce.toString(16)}`;

    const feeData = await provider.getFeeData();
    console.log('feeData: ', feeData);
    transaction.gasPrice = `0x${BigInt(feeData.gasPrice || '0').toString(16)}`;
    transaction.maxFeePerGas = `0x${BigInt(feeData.maxFeePerGas || '0').toString(16)}`;
    transaction.maxPriorityFeePerGas = `0x${BigInt(feeData.maxPriorityFeePerGas || '0').toString(16)}`;

    try {
      const estimatedGas = await provider.estimateGas({
        from: transaction.from,
        to: transaction.to,
        data: transaction.data,
      });
      console.log('estimatedGas: ', estimatedGas);
      transaction.gas = `0x${estimatedGas.toString(16)}`;
    } catch (e) {
      transaction.gas = `0x${BigInt('1000000').toString(16)}`;
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
      chainId: `0x${transaction.chainId.toString(16)}`,
      gasPrice: transaction.gasPrice,
      maxFeePerGas: transaction.maxFeePerGas,
      maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
    };

    console.log(`${tag} Final input: `, input);
    console.log(`${tag} KEEPKEY_SDK: `, KEEPKEY_SDK);
    const output = await KEEPKEY_SDK.eth.ethSignTransaction(input);
    console.log(`${tag} Transaction output: `, output);

    return output.serialized;
  } catch (e) {
    console.error(`${tag} Error: `, e);
    throw createProviderRpcError(4000, 'Error signing transaction', e);
  }
};

export const signTypedData = async (params: any, KEEPKEY_SDK: any, ADDRESS: string) => {
  const tag = ' | signTypedData | ';
  try {
    console.log(tag, '**** params: ', params);
    console.log(tag, '**** params: ', typeof params);
    if (typeof params === 'string') params = JSON.parse(params);

    const payload = {
      address: ADDRESS,
      addressNList: [2147483692, 2147483708, 2147483648, 0, 0], //TODO multi path
      typedData: params,
    };
    console.log(tag, '**** payload: ', payload);

    const signedMessage = await KEEPKEY_SDK.eth.ethSignTypedData(payload);
    console.log(tag, '**** signedMessage: ', signedMessage);
    return signedMessage;
  } catch (e) {
    console.error(`${tag} Error: `, e);
    throw createProviderRpcError(4000, 'Error signing typed data', e);
  }
};

export const broadcastTransaction = async (signedTx: string, networkId: string, provider: JsonRpcProvider) => {
  try {
    const receipt = await provider.send('eth_sendRawTransaction', [signedTx]);
    console.log('Transaction receipt:', receipt);

    return receipt;
  } catch (e) {
    console.error(e);
    throw createProviderRpcError(4000, 'Error broadcasting transaction', e);
  }
};

export const sendTransaction = async (
  transaction: any,
  provider: JsonRpcProvider,
  KEEPKEY_SDK: any,
  ADDRESS: string,
) => {
  const tag = ' | sendTransaction | ';
  try {
    const userResponse = { decision: 'accept' }; // This should be dynamic based on actual user input

    if (userResponse.decision === 'accept') {
      console.log(tag, 'User accepted the request');
      console.log(tag, 'transaction:', transaction);
      const params = transaction;
      const chainId = '0x1';
      params.chainId = chainId;
      params.from = ADDRESS;
      const signedTx = await signTransaction(params, provider, KEEPKEY_SDK);
      console.log(tag, 'signedTx:', signedTx);

      const result = await broadcastTransaction(signedTx, chainId, provider);
      return result;
    } else if (userResponse.decision === 'reject') {
      console.log(tag, 'User rejected the request');
      throw createProviderRpcError(4001, 'User rejected the transaction');
    }

    throw createProviderRpcError(4000, 'Unexpected user decision');
  } catch (e) {
    console.error(e);
    throw createProviderRpcError(4000, 'Error sending transaction', e);
  }
};
