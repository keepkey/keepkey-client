import { requestStorage } from '@extension/storage/dist/lib';

const TAG = ' | bitcoinHandler | ';
import { Chain } from '@coinmasters/types';
import { AssetValue } from '@pioneer-platform/helpers';
import { ChainToNetworkId, shortListSymbolToCaip, caipToNetworkId } from '@pioneer-platform/pioneer-caip';
//@ts-ignore
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

      return [accounts]; // Return preference account
    }

    case 'request_balance': {
      const balance = KEEPKEY_WALLET.balances.find((balance: any) => balance.caip === shortListSymbolToCaip['BTC']);
      return [balance];
    }

    //TODO: add paths

    case 'request_paths': {
      const paths = KEEPKEY_WALLET.paths.find((balance: any) => balance.caip === shortListSymbolToCaip['BTC']);
      return paths;
    }

    //list unspent
    case 'list_unspent': {
      const wallet = await KEEPKEY_WALLET.swapKit.getWallet(Chain.Bitcoin);
      if (!wallet) throw new Error('Failed to init swapkit');
      const xpub = params[0];
      if (!xpub) throw Error('param Xpub requered!');
      const unspent = await wallet.listUnspent(xpub);
      return unspent;
    }

    case 'request_pubkeys': {
      const pubkeys = KEEPKEY_WALLET.pubkeys.find((balance: any) => balance.caip === shortListSymbolToCaip['BTC']);
      return pubkeys;
    }

    case 'transfer': {
      const caip = shortListSymbolToCaip['BTC'];
      const networkId = caipToNetworkId(caip);
      requestInfo.id = uuidv4();
      if (!KEEPKEY_WALLET.assetContext) {
        await KEEPKEY_WALLET.setAssetContext({ caip });
      }

      const pubkeys = KEEPKEY_WALLET.pubkeys.filter((e: any) => e.networks.includes(ChainToNetworkId[Chain.Bitcoin]));
      const accounts = pubkeys.map((pubkey: any) => pubkey.master || pubkey.address);

      const assetString = 'BTC.BTC';
      await AssetValue.loadStaticAssets();

      const assetValue = await AssetValue.fromString(assetString, parseFloat(params[0].amount.amount) / 100000000);
      const sendPayload = {
        from: accounts[0], // Select preference change address
        assetValue,
        memo: params[0].memo || '',
        recipient: params[0].recipient,
      };

      // Start building the transaction but don't wait for it to finish
      const wallet = await KEEPKEY_WALLET.swapKit.getWallet(Chain.Bitcoin);
      if (!wallet) throw new Error('Failed to init swapkit');

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
      const result = await requireApproval(networkId, requestInfo, 'bitcoin', method, params[0]);

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
      throw createProviderRpcError(4200, `Method ${method} not supported`);
    }
  }
};
