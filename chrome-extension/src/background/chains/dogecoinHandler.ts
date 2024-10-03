const TAG = ' | dogecoinHandler | ';
import type { JsonRpcProvider } from 'ethers';
import { Chain } from '@coinmasters/types';
import { AssetValue } from '@pioneer-platform/helpers';
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

export const handleDogecoinRequest = async (
  method: string,
  params: any[],
  requestInfo: any,
  ADDRESS: string,
  KEEPKEY_WALLET: any,
  requireApproval: (networkId: string, requestInfo: any, chain: any, method: string, params: any) => Promise<void>,
): Promise<any> => {
  const tag = TAG + ' | handleDogecoinRequest | ';
  console.log(tag, 'method:', method);
  console.log(tag, 'params:', params);
  switch (method) {
    case 'request_accounts': {
      const pubkeys = KEEPKEY_WALLET.pubkeys.filter((e: any) => e.networks.includes(ChainToNetworkId[Chain.Dogecoin]));
      const accounts = [];
      for (let i = 0; i < pubkeys.length; i++) {
        const pubkey = pubkeys[i];
        const address = pubkey.master || pubkey.address;
        accounts.push(address);
      }
      console.log(tag, 'accounts: ', accounts);
      console.log(tag, method + ' Returning', accounts);
      //TODO preference on which account to return
      return [accounts[0]];
    }
    case 'request_paths': {
      const paths = KEEPKEY_WALLET.paths.find((balance: any) => balance.caip === shortListSymbolToCaip['DOGE']);
      return paths;
    }
    case 'request_balance': {
      //get sum of all pubkeys configured
      const balance = KEEPKEY_WALLET.balances.find((balance: any) => balance.caip === shortListSymbolToCaip['DOGE']);

      //let pubkeys = await KEEPKEY_WALLET.swapKit.getBalance(Chain.Bitcoin);
      console.log(tag, 'balance: ', balance);
      return [balance];
    }
    case 'transfer': {
      //@VERIFY: Xdefi conpatability! missing caip!
      const caip = params[0].caip || shortListSymbolToCaip[params[0].asset.symbol];
      if (!caip) throw Error('Unalbe to determine caip from asset.symbol: ' + params[0].asset.symbol);
      console.log(tag, 'caip: ', caip);
      const networkId = caipToNetworkId(caip);
      console.log(tag, 'networkId: ', networkId);

      requestInfo.id = uuidv4();
      if (!KEEPKEY_WALLET.assetContext) {
        await KEEPKEY_WALLET.setAssetContext({ caip });
      }

      const pubkeys = KEEPKEY_WALLET.pubkeys.filter((e: any) => e.networks.includes(ChainToNetworkId[Chain.Dogecoin]));
      const accounts = pubkeys.map((pubkey: any) => pubkey.master || pubkey.address);
      console.log(tag, 'accounts: ', accounts);
      if (!accounts.length) throw createProviderRpcError(4200, 'No accounts found');
      const assetString = 'DOGE.DOGE';
      await AssetValue.loadStaticAssets();

      const assetValue = await AssetValue.fromString(assetString, parseFloat(params[0].amount.amount) / 100000000);
      const sendPayload = {
        from: accounts[0], // Select preference change address
        assetValue,
        memo: params[0].memo || '',
        recipient: params[0].recipient,
      };

      // Start building the transaction but don't wait for it to finish
      const wallet = await KEEPKEY_WALLET.swapKit.getWallet(Chain.Dogecoin);
      if (!wallet) throw new Error('Failed to init swapkit');
      console.log(tag, '** wallet:', wallet);
      console.log('CHECKPOINT DOGE 1');
      const buildTxPromise = wallet
        .buildTx(sendPayload)
        .then(async unsignedTx => {
          console.log(tag, 'unsignedTx', unsignedTx);
          // Update requestInfo with transaction details after buildTx resolves
          requestInfo.inputs = unsignedTx.inputs;
          requestInfo.outputs = unsignedTx.outputs;
          requestInfo.memo = unsignedTx.memo;

          chrome.runtime.sendMessage({
            action: 'utxo_build_tx',
            unsignedTx: unsignedTx,
          });
          const response = await requestStorage.getEventById(requestInfo.id);
          response.unsignedTx = unsignedTx;
          await requestStorage.updateEventById(requestInfo.id, response);
          // Push an event to the front-end that UTXOs are found
          // This could be something like: sendUpdateToFrontend('UTXOs found', unsignedTx);
        })
        .catch(error => {
          console.error('Error building the transaction:', error);
          // Handle buildTx failure appropriately, such as notifying the user
        });

      // Proceed with requiring approval without waiting for buildTx to resolve
      const result = await requireApproval(networkId, requestInfo, 'dogecoin', method, params[0]);

      // Wait for the buildTx to complete (if not already completed) before signing
      const unsignedTx = await buildTxPromise;

      if (result.success && unsignedTx) {
        const signedTx = await wallet.signTransaction(unsignedTx.psbt, unsignedTx.inputs, unsignedTx.memo);
        const txid = await wallet.broadcastTx(signedTx);
        return txid;
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
