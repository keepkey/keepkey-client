const TAG = ' | bitcoinCashHandler | ';
import { JsonRpcProvider } from 'ethers';
import { Chain } from '@coinmasters/types';
import { AssetValue } from '@pioneer-platform/helpers';
// @ts-ignore
// @ts-ignore
import { ChainToNetworkId, shortListSymbolToCaip, caipToNetworkId } from '@pioneer-platform/pioneer-caip';
// @ts-ignore
import { v4 as uuidv4 } from 'uuid';

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
      //caip
      const caip = shortListSymbolToCaip['BCH'];
      console.log(tag, 'caip: ', caip);
      const networkId = caipToNetworkId(caip);
      //verify context is bitcoin
      if (!KEEPKEY_WALLET.assetContext) {
        await KEEPKEY_WALLET.setAssetContext({ caip });
      }

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
      // const txHash = await KEEPKEY_WALLET.swapKit.transfer(sendPayload);
      // console.log(tag, 'txHash: ', txHash);

      const unsignedTx = await wallet.buildTx(sendPayload);
      log.info('unsignedTx: ', unsignedTx);
      requestInfo.unsignedTx = unsignedTx;
      // Require user approval
      const result = await requireApproval(networkId, requestInfo, 'bitcoin', method, params[0]);
      console.log(tag, 'result:', result);

      // signTransaction
      const signedTx = await wallet.signTransaction(unsignedTx.psbt, unsignedTx.inputs, unsignedTx.memo);
      log.info('signedTx: ', signedTx);

      //push signed to user to approve

      //broadcastTx
      const txid = await wallet.broadcastTx(signedTx);
      log.info('txid: ', txid);

      return txid;
    }
    default: {
      console.log(tag, `Method ${method} not supported`);
      throw createProviderRpcError(4200, `Method ${method} not supported`);
    }
  }
};
