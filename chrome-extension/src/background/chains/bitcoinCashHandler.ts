const TAG = ' | thorchainHandler | ';
import { JsonRpcProvider } from 'ethers';
import { Chain } from '@coinmasters/types';
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

export const handleBitcoinCashRequest = async (
  method: string,
  params: any[],
  requestInfo: any,
  ADDRESS: string,
  KEEPKEY_WALLET: any,
  requireApproval: (networkId: string, requestInfo: any, chain: any, method: string, params: any) => Promise<void>,
): Promise<any> => {
  const tag = TAG + ' | handleBitcoinCashRequest | ';
  console.log(tag, 'method:', method);
  console.log(tag, 'params:', params);
  switch (method) {
    case 'request_accounts': {
      //Unsigned TX
      const pubkeys = KEEPKEY_WALLET.pubkeys.filter((e: any) =>
        e.networks.includes(ChainToNetworkId[Chain.BitcoinCash]),
      );
      const accounts = [];
      for (let i = 0; i < pubkeys.length; i++) {
        const pubkey = pubkeys[i];
        let address = pubkey.master || pubkey.address;
        address = 'bitcoincash:' + address;
        accounts.push(address);
      }
      console.log(tag, 'accounts: ', accounts);
      console.log(tag, method + ' Returning: ', accounts);
      return [accounts[0]];
    }
    case 'request_balance': {
      //get sum of all pubkeys configured
      const balance = KEEPKEY_WALLET.balances.find((balance: any) => balance.caip === shortListSymbolToCaip['BCH']);

      //let pubkeys = await KEEPKEY_WALLET.swapKit.getBalance(Chain.Bitcoin);
      console.log(tag, 'balance: ', balance);
      return [balance];
    }
    case 'transfer': {
      //send tx
      console.log(tag, 'params[0]: ', params[0]);
      const assetString = 'BCH.BCH';
      await AssetValue.loadStaticAssets();
      console.log(tag, 'params[0].amount.amount: ', params[0].amount.amount);
      const assetValue = await AssetValue.fromString(assetString, parseFloat(params[0].amount.amount));
      const sendPayload = {
        from: params[0].from,
        assetValue,
        memo: params[0].memo || '',
        recipient: params[0].recipient,
      };
      console.log(tag, 'sendPayload: ', sendPayload);
      const txHash = await KEEPKEY_WALLET.swapKit.transfer(sendPayload);
      console.log(tag, 'txHash: ', txHash);
      return txHash;
    }
    default: {
      console.log(tag, `Method ${method} not supported`);
      throw createProviderRpcError(4200, `Method ${method} not supported`);
    }
  }
};
