import { requestStorage } from '@extension/storage/dist/lib';

const TAG = ' | bitcoinHandler | ';
import { Chain, DerivationPath } from '@coinmasters/types';
import { AssetValue } from '@pioneer-platform/helpers';
import { ChainToNetworkId, shortListSymbolToCaip, caipToNetworkId } from '@pioneer-platform/pioneer-caip';
//@ts-ignore
import { v4 as uuidv4 } from 'uuid';
import { bip32ToAddressNList } from '@pioneer-platform/pioneer-coins';
//@ts-ignore
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
      console.log(tag, 'caip: ', caip);
      await KEEPKEY_WALLET.setAssetContext({ caip });
      chrome.runtime.sendMessage({ type: 'ASSET_CONTEXT_UPDATED', assetContext: KEEPKEY_WALLET.assetContext });
      const networkId = caipToNetworkId(caip);
      //push event
      requestInfo.id = uuidv4();
      //push event to ux
      chrome.runtime.sendMessage({
        action: 'TRANSACTION_CONTEXT_UPDATED',
        id: requestInfo.id,
      });
      const pubkeys = KEEPKEY_WALLET.pubkeys.filter((e: any) => e.networks.includes(ChainToNetworkId[Chain.Bitcoin]));
      console.log(tag, 'pubkeys: ', pubkeys);
      if (!pubkeys || pubkeys.length === 0) throw Error('Failed to locate pubkeys for chain ' + Chain.Bitcoin);

      const sendPayload = {
        caip,
        to: params[0].recipient,
        amount: params[0].amount.amount,
        feeLevel: 5, //@TODO Options
        isMax: params[0].isMax,
      };
      console.log(tag, 'Send Payload: ', sendPayload);

      const buildTx = async function () {
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
            action: 'transaction_error',
            error: JSON.stringify(e),
          });
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
        chain: 'bitcoin', //TODO I dont like this
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
      const result = await requireApproval(networkId, requestInfo, 'bitcoin', method, params[0]);
      console.log(tag, 'result:', result);

      const response = await requestStorage.getEventById(requestInfo.id);
      console.log(tag, 'response: ', response);

      if (result.success && response.unsignedTx) {
        const signedTx = await KEEPKEY_WALLET.signTx({ caip, unsignedTx: response.unsignedTx });
        console.log(tag, 'signedTx: ', signedTx);

        response.signedTx = signedTx;
        await requestStorage.updateEventById(requestInfo.id, response);

        try {
          let txHash = await KEEPKEY_WALLET.broadcastTx(caip, signedTx);
          console.log(tag, 'txHash: ', txHash);
          if (txHash.txHash) txHash = txHash.txHash;
          if (txHash.txid) txHash = txHash.txid;
          response.txid = txHash;
          await requestStorage.updateEventById(requestInfo.id, response);

          //push event
          chrome.runtime.sendMessage({
            action: 'transaction_complete',
            txHash: txHash,
          });
          return txHash;
        } catch (e) {
          console.error(tag, e);
          chrome.runtime.sendMessage({
            action: 'transaction_error',
            error: JSON.stringify(e),
          });
        }
      } else {
        throw createProviderRpcError(4200, 'User denied transaction');
      }
    }
    default: {
      throw createProviderRpcError(4200, `Method ${method} not supported`);
    }
  }
};
