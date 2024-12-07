import { bip32ToAddressNList } from '@pioneer-platform/pioneer-coins';

const TAG = ' | dogecoinHandler | ';
import type { JsonRpcProvider } from 'ethers';
import { Chain, DerivationPath } from '@coinmasters/types';
import { AssetValue } from '@pioneer-platform/helpers';
// @ts-ignore
import { ChainToNetworkId, shortListSymbolToCaip, caipToNetworkId } from '@pioneer-platform/pioneer-caip';
// @ts-ignore
import { v4 as uuidv4 } from 'uuid';
import { requestStorage } from '@extension/storage/dist/lib';
// @ts-ignore
import * as coinSelect from 'coinselect';
//@ts-ignore
import * as coinSelectSplit from 'coinselect/split';

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

      //let pubkeys = await KEEPKEY_WALLET.swapKit.getBalance(Chain.Doge);
      console.log(tag, 'balance: ', balance);
      return [balance];
    }
    case 'transfer': {
      const caip = shortListSymbolToCaip['DOGE'];
      console.log(tag, 'caip: ', caip);
      const networkId = caipToNetworkId(caip);
      await KEEPKEY_WALLET.setAssetContext({ caip, networkId });
      chrome.runtime.sendMessage({ type: 'ASSET_CONTEXT_UPDATED', assetContext: KEEPKEY_WALLET.assetContext });

      requestInfo.id = uuidv4();
      console.log(tag, 'requestInfo: ', requestInfo);
      //push event to ux
      chrome.runtime.sendMessage({
        action: 'TRANSACTION_CONTEXT_UPDATED',
        id: requestInfo.id,
      });
      const pubkeys = KEEPKEY_WALLET.pubkeys.filter((e: any) => e.networks.includes(ChainToNetworkId[Chain.Dogecoin]));
      console.log(tag, 'pubkeys: ', pubkeys);
      if (!pubkeys || pubkeys.length === 0) throw Error('Failed to locate pubkeys for chain ' + Chain.Dogecoin);

      const sendPayload = {
        caip,
        to: params[0].recipient,
        amount: params[0].amount.amount,
        feeLevel: 5, //@TODO Options
      };
      console.log(tag, 'Send Payload: ', sendPayload);

      const buildTx = async function () {
        const tag = TAG + ' | buildTx | ';
        try {
          //test as BEX (multi-set)
          const unsignedTx = await KEEPKEY_WALLET.buildTx(sendPayload);
          console.log(tag, 'unsignedTx: ', unsignedTx);

          const storedEvent = await requestStorage.getEventById(requestInfo.id);
          console.log(tag, 'storedEvent: ', storedEvent);
          storedEvent.assetContext = KEEPKEY_WALLET.assetContext;
          storedEvent.unsignedTx = unsignedTx;
          console.log(tag, 'storedEvent: ', storedEvent);
          console.log(tag, 'requestInfo.id: ', requestInfo.id);
          await requestStorage.updateEventById(requestInfo.id, storedEvent);

          chrome.runtime.sendMessage({
            action: 'utxo_build_tx',
            unsignedTx: requestInfo,
          });
        } catch (e) {
          console.error(e);
          chrome.runtime.sendMessage({
            action: 'utxo_build_tx_error',
            error: 'coinselect failed to find a solution. (OUT OF INPUTS) try a lower amount',
          });
          throw e;
        }
      };
      buildTx();

      const event = {
        id: requestInfo.id,
        networkId,
        href: requestInfo.href,
        language: requestInfo.language,
        platform: requestInfo.platform,
        referrer: requestInfo.referrer,
        requestTime: requestInfo.requestTime,
        scriptSource: requestInfo.scriptSource,
        siteUrl: requestInfo.siteUrl,
        userAgent: requestInfo.userAgent,
        injectScriptVersion: requestInfo.version,
        chain: 'dogecoin', //TODO I dont like this
        requestInfo,
        // unsignedTx,
        type: 'transfer',
        request: params,
        status: 'request',
        timestamp: new Date().toISOString(),
      };
      console.log(tag, 'Requesting approval for event:', event);
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      //@ts-expect-error
      const eventSaved = await requestStorage.addEvent(event);
      console.log(tag, 'eventSaved:', eventSaved);
      if (!eventSaved) throw Error('Failed to create event!');

      // Proceed with requiring approval without waiting for buildTx to resolve
      const result = await requireApproval(networkId, requestInfo, 'dogecoin', method, params[0]);
      console.log(tag, 'result:', result);

      const response = await requestStorage.getEventById(requestInfo.id);
      console.log(tag, 'response: ', response);

      if (result.success && response.unsignedTx) {
        const signedTx = await KEEPKEY_WALLET.signTx({ caip, unsignedTx: response.unsignedTx });
        console.log(tag, 'signedTx: ', signedTx);

        response.signedTx = signedTx;
        await requestStorage.updateEventById(requestInfo.id, response);

        const txHash = await KEEPKEY_WALLET.broadcastTx(networkId, signedTx);

        response.txid = txHash;
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
    }
    default: {
      console.log(tag, `Method ${method} not supported`);
      throw createProviderRpcError(4200, `Method ${method} not supported`);
    }
  }
};
