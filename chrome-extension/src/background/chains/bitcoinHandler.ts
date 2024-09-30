const TAG = ' | bitcoinHandler | ';
import { Chain } from '@coinmasters/types';
import { AssetValue } from '@pioneer-platform/helpers';
import { ChainToNetworkId, shortListSymbolToCaip, caipToNetworkId } from '@pioneer-platform/pioneer-caip';

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
  requireApproval: (networkId: string, requestInfo: any, chain: any, method: string, params: any) => Promise<void>,
): Promise<any> => {
  const tag = `${TAG} | handleBitcoinRequest | `;

  switch (method) {
    case 'request_accounts': {
      const pubkeys = KEEPKEY_WALLET.pubkeys.filter((e: any) => e.networks.includes(ChainToNetworkId[Chain.Bitcoin]));
      const accounts = pubkeys.map((pubkey: any) => pubkey.master || pubkey.address);

      return [accounts[1]]; // Return preference account
    }

    case 'request_balance': {
      const balance = KEEPKEY_WALLET.balances.find((balance: any) => balance.caip === shortListSymbolToCaip['BTC']);
      return [balance];
    }

    case 'transfer': {
      const caip = shortListSymbolToCaip['BTC'];
      const networkId = caipToNetworkId(caip);

      if (!KEEPKEY_WALLET.assetContext) {
        await KEEPKEY_WALLET.setAssetContext({ caip });
      }

      const pubkeys = KEEPKEY_WALLET.pubkeys.filter((e: any) => e.networks.includes(ChainToNetworkId[Chain.Bitcoin]));
      const accounts = pubkeys.map((pubkey: any) => pubkey.master || pubkey.address);

      const assetString = 'BTC.BTC';
      await AssetValue.loadStaticAssets();

      const assetValue = await AssetValue.fromString(assetString, parseFloat(params[0].amount.amount) / 100000000);
      const sendPayload = {
        from: accounts[0], //Select preference change address
        assetValue,
        memo: params[0].memo || '',
        recipient: params[0].recipient,
      };

      const wallet = await KEEPKEY_WALLET.swapKit.getWallet(Chain.Bitcoin);
      if (!wallet) throw Error('Failed to init swapkit');

      const unsignedTx = await wallet.buildTx(sendPayload);
      requestInfo.inputs = unsignedTx.inputs;
      requestInfo.outputs = unsignedTx.outputs;
      requestInfo.memo = unsignedTx.memo;

      const result = await requireApproval(networkId, requestInfo, 'bitcoin', method, params[0]);

      if (result.success) {
        const signedTx = await wallet.signTransaction(unsignedTx.psbt, unsignedTx.inputs, unsignedTx.memo);
        const txid = await wallet.broadcastTx(signedTx);
        return txid;
      } else {
        throw createProviderRpcError(4200, 'User denied transaction');
      }
    }

    default: {
      throw createProviderRpcError(4200, `Method ${method} not supported`);
    }
  }
};
