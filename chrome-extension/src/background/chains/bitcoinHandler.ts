const TAG = ' | bitcoinHandler | ';
import type { JsonRpcProvider } from 'ethers';
import { Chain } from '@coinmasters/types';
import { EIP155_CHAINS } from '../chains';
import { AssetValue } from '@pioneer-platform/helpers';
// @ts-ignore
import { ChainToNetworkId, shortListSymbolToCaip } from '@pioneer-platform/pioneer-caip';

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

export const handleBitcoinRequest = async (
  method: string,
  params: any[],
  requestInfo: any,
  ADDRESS: string,
  KEEPKEY_WALLET: any,
  requireApproval: (requestInfo: any, chain: any, method: string, params: any) => Promise<void>,
): Promise<any> => {
  const tag = TAG + ' | handleBitcoinRequest | ';
  console.log(tag, 'method:', method);
  console.log(tag, 'params:', params);
  switch (method) {
    case 'request_accounts': {
      console.log(tag, 'KEEPKEY_WALLET: ', KEEPKEY_WALLET);
      //Unsigned TX
      const pubkeys = KEEPKEY_WALLET.pubkeys.filter((e: any) => e.networks.includes(ChainToNetworkId[Chain.Bitcoin]));
      const accounts = [];
      for (let i = 0; i < pubkeys.length; i++) {
        const pubkey = pubkeys[i];
        const address = pubkey.master || pubkey.address;
        accounts.push(address);
      }
      console.log(tag, 'accounts: ', accounts);
      console.log(tag, method + ' Returning', accounts);
      //TODO preference on which account to return
      return [accounts[1]];
    }
    case 'request_balance': {
      //get sum of all pubkeys configured
      console.log(tag, 'KEEPKEY_WALLET: ', KEEPKEY_WALLET);
      console.log(tag, 'KEEPKEY_WALLET.swapKit: ', KEEPKEY_WALLET.swapKit);
      console.log(tag, 'KEEPKEY_WALLET.swapKit: ', KEEPKEY_WALLET.balances);
      const balance = KEEPKEY_WALLET.balances.find((balance: any) => balance.caip === shortListSymbolToCaip['BTC']);

      //let pubkeys = await KEEPKEY_WALLET.swapKit.getBalance(Chain.Bitcoin);
      console.log(tag, 'balance: ', balance);
      return [balance];
    }
    case 'transfer': {
      // Require user approval
      const result = await requireApproval(requestInfo, 'bitcoin', method, params[0]);
      console.log(tag, 'result:', result);

      if (result.success) {
        //send tx
        console.log(tag, 'params[0]: ', params[0]);
        const assetString = 'BTC.BTC';
        await AssetValue.loadStaticAssets();
        console.log(tag, 'params[0].amount.amount: ', params[0].amount.amount);
        const assetValue = await AssetValue.fromString(assetString, parseFloat(params[0].amount.amount) / 100000000);
        const sendPayload = {
          from: params[0].from,
          assetValue,
          memo: params[0].memo || '',
          recipient: params[0].recipient,
        };
        console.log(tag, 'sendPayload: ', sendPayload);
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        console.log(tag, 'sendPayload: ', sendPayload.assetValue.getValue('string'));
        try {
          const txHash = '083d4710e9880367370235bf0948745cab113f164881a9329330c6a96f9c2b26';

          // const txHash = await KEEPKEY_WALLET.swapKit.transfer(sendPayload);
          // console.log(tag, 'txHash: ', txHash);
          // chrome.runtime.sendMessage({ action: 'transaction_complete', txHash });

          return txHash;
        } catch (e) {
          console.error(tag, 'Failed to send transaction: ', e);
          chrome.runtime.sendMessage({ action: 'transaction_error', e });
          throw createProviderRpcError(4200, 'Failed to send transaction');
        }
      } else {
        throw createProviderRpcError(4200, 'User denied transaction');
      }
    }
    default: {
      console.log(tag, `Method ${method} not supported`);
      throw createProviderRpcError(4200, `Method ${method} not supported`);
    }
  }
};
