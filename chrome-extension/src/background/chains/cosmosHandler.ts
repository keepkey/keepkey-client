const TAG = ' | cosmosHandler | ';
import { JsonRpcProvider } from 'ethers';
import { Chain } from '@coinmasters/types';
import { AssetValue } from '@pioneer-platform/helpers';
import { requestStorage, web3ProviderStorage, assetContextStorage } from '@extension/storage';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error
import { ChainToNetworkId, shortListSymbolToCaip, caipToNetworkId } from '@pioneer-platform/pioneer-caip';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error
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

export const handleCosmosRequest = async (
  method: string,
  params: any[],
  requestInfo: any,
  ADDRESS: string,
  KEEPKEY_WALLET: any,
  requireApproval: (networkId: string, requestInfo: any, chain: any, method: string, params: any) => Promise<void>,
): Promise<any> => {
  const tag = TAG + ' | handleCosmosRequest | ';
  console.log(tag, 'method:', method);
  console.log(tag, 'params:', params);
  switch (method) {
    case 'request_accounts': {
      //Unsigned TX
      const pubkeys = KEEPKEY_WALLET.pubkeys.filter((e: any) => e.networks.includes(ChainToNetworkId[Chain.Cosmos]));
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
    case 'request_balance': {
      //get sum of all pubkeys configured
      console.log(tag, 'KEEPKEY_WALLET: ', KEEPKEY_WALLET);
      console.log(tag, 'KEEPKEY_WALLET.swapKit: ', KEEPKEY_WALLET.swapKit);
      console.log(tag, 'KEEPKEY_WALLET.swapKit: ', KEEPKEY_WALLET.balances);
      const balance = KEEPKEY_WALLET.balances.find((balance: any) => balance.caip === shortListSymbolToCaip['ATOM']);

      //let pubkeys = await KEEPKEY_WALLET.swapKit.getBalance(Chain.Bitcoin);
      console.log(tag, 'balance: ', balance);
      return [balance];
    }
    case 'transfer': {
      const caip = shortListSymbolToCaip['ATOM'];
      console.log(tag, 'caip: ', caip);
      await KEEPKEY_WALLET.setAssetContext({ caip });
      const networkId = caipToNetworkId(caip);
      requestInfo.id = uuidv4();
      console.log(tag, 'requestInfo: ', requestInfo);
      //push event to ux
      chrome.runtime.sendMessage({
        action: 'TRANSACTION_CONTEXT_UPDATED',
        id: requestInfo.id,
      });

      const sendPayload = {
        caip,
        isMax: params[0].isMax,
        to: params[0].recipient,
        amount: params[0].amount.amount,
        feeLevel: 5, // Options
      };
      console.log(tag, 'Send Payload:', sendPayload);

      // Start building the transaction asynchronously
      const unsignedTx = await KEEPKEY_WALLET.buildTx(sendPayload);
      console.log(tag, 'unsignedTx:', unsignedTx);

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
        chain: 'cosmos', //TODO I dont like this
        requestInfo,
        unsignedTx,
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

      // Require user approval
      const result = await requireApproval(networkId, requestInfo, 'cosmos', method, params[0]);
      console.log(tag, 'result:', result);
      //send tx
      console.log(tag, 'params[0]: ', params[0]);

      requestInfo = await requestStorage.getEventById(requestInfo.id);
      console.log(tag, 'requestInfo: ', requestInfo);

      if (result.success && requestInfo.unsignedTx) {
        //send tx
        // Sign the transaction
        const signedTx = await KEEPKEY_WALLET.signTx({
          caip,
          unsignedTx: requestInfo.unsignedTx,
        });
        console.log(tag, 'signedTx:', signedTx);

        // Update storage with signed transaction
        requestInfo.signedTx = signedTx;
        await requestStorage.updateEventById(requestInfo.id, requestInfo);

        // Broadcast the transaction
        const txid = await KEEPKEY_WALLET.broadcastTx(caip, signedTx);
        console.log(tag, 'txid:', txid);

        // Update storage with transaction hash
        requestInfo.txid = txid;
        await requestStorage.updateEventById(requestInfo.id, requestInfo);

        // Notify transaction completion
        chrome.runtime.sendMessage({
          action: 'transaction_complete',
          txHash: txid,
        });

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
