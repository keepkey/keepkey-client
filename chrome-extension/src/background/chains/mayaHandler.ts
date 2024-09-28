const TAG = ' | thorchainHandler | ';
import { JsonRpcProvider } from 'ethers';
import { Chain } from '@coinmasters/types';
import { AssetValue } from '@pioneer-platform/helpers';
import { EIP155_CHAINS } from '../chains';
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

export const handleMayaRequest = async (
  method: string,
  params: any[],
  requestInfo: any,
  ADDRESS: string,
  KEEPKEY_WALLET: any,
  requireApproval: (networkId: string, requestInfo: any, chain: any, method: string, params: any) => Promise<void>,
): Promise<any> => {
  const tag = TAG + ' | handleMayaRequest | ';
  console.log(tag, 'method:', method);
  console.log(tag, 'params:', params);
  switch (method) {
    case 'request_accounts': {
      //Unsigned TX
      let pubkeys = KEEPKEY_WALLET.pubkeys.filter((e: any) => e.networks.includes(ChainToNetworkId[Chain.Mayachain]));
      let accounts = [];
      for (let i = 0; i < pubkeys.length; i++) {
        let pubkey = pubkeys[i];
        let address = pubkey.master || pubkey.address;
        accounts.push(address);
      }
      console.log(tag, 'accounts: ', accounts);
      console.log(tag, method + ' Returning', accounts);
      //TODO preference on which account to return
      return [accounts[0]];
    }
    case 'request_balance': {
      //get sum of all pubkeys configured
      let pubkeys = await KEEPKEY_WALLET.swapKit.getBalance(Chain.Litecoin);
      console.log(tag, 'pubkeys: ', pubkeys);
      return [pubkeys];
    }
    case 'transfer': {
      const caip = shortListSymbolToCaip['MAYA'];
      console.log(tag, 'caip: ', caip);
      const networkId = caipToNetworkId(caip);
      //verify context is bitcoin
      if (!KEEPKEY_WALLET.assetContext) {
        // Set context to the chain, defaults to ETH
        await KEEPKEY_WALLET.setAssetContext({ caip });
      }
      // Require user approval
      const result = await requireApproval(networkId, requestInfo, 'bitcoin', method, params[0]);
      console.log(tag, 'result:', result);

      //send tx
      console.log(tag, 'params[0]: ', params[0]);
      let assetString = 'MAYA.CACAO';
      await AssetValue.loadStaticAssets();
      console.log(tag, 'params[0].amount.amount: ', params[0].amount.amount);
      let assetValue = await AssetValue.fromString(assetString, parseFloat(params[0].amount.amount));
      let sendPayload = {
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
