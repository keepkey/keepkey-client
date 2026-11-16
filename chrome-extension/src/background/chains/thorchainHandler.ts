import { requestStorage } from '@extension/storage';
import { v4 as uuidv4 } from 'uuid';
import { Chain, ChainToNetworkId, shortListSymbolToCaip, caipToNetworkId } from '../chainConfig';
import * as wallet from '../wallet';
import { createProviderRpcError } from '../utils';
import { broadcastViaPioneer, cosmosSignedSerialized } from '../fetchUtils';
import { buildViaDesktop } from './buildViaDesktop';

const TAG = ' | thorchainHandler | ';

export const handleThorchainRequest = async (
  method: string,
  params: any[],
  requestInfo: any,
  ADDRESS: string,
  KEEPKEY_WALLET: any,
  requireApproval: (networkId: string, requestInfo: any, chain: any, method: string, params: any) => Promise<any>,
): Promise<any> => {
  const tag = TAG + ' | handleThorchainRequest | ';
  switch (method) {
    case 'request_accounts': {
      const pubkeys = wallet.getPubkeys(ChainToNetworkId[Chain.THORChain]);
      const accounts = pubkeys.map((pubkey: any) => pubkey.master || pubkey.address);
      return [accounts];
    }
    case 'request_balance': {
      return [null];
    }
    case 'transfer': {
      const caip = shortListSymbolToCaip['RUNE'];
      const networkId = caipToNetworkId(caip);
      requestInfo.id = uuidv4();
      chrome.runtime.sendMessage({ action: 'TRANSACTION_CONTEXT_UPDATED', id: requestInfo.id });

      // KeepKey Desktop builds the tx locally (keys, UTXOs, change, fee) before the
      // approval event exists, so the event always carries what will be signed.
      const build = await buildViaDesktop(wallet.getSdk(), caip, params[0], 'THORChain');

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
        chain: 'thorchain',
        requestInfo,
        unsignedTx: build.signBody,
        summary: build.summary,
        type: 'transfer',
        request: params,
        status: 'request',
        timestamp: new Date().toISOString(),
      };
      // @ts-expect-error
      const eventSaved = await requestStorage.addEvent(event);
      if (!eventSaved) throw Error('Failed to create event!');

      const result = await requireApproval(networkId, requestInfo, 'thorchain', method, params[0]);
      const response = await requestStorage.getEventById(requestInfo.id);
      if (!response) throw Error('Failed to load event for signing!');

      if (result.success) {
        const sdk = wallet.getSdk();
        const signedTx = await wallet.signViaVault(build.signRoute, build.signBody);
        console.log(tag, 'signedTx: ', signedTx);

        response.signedTx = signedTx;
        await requestStorage.updateEventById(requestInfo.id, response);

        // Broadcast via Pioneer API.
        const txHash: any = await broadcastViaPioneer(caip, cosmosSignedSerialized(signedTx));

        response.txid = txHash;
        await requestStorage.updateEventById(requestInfo.id, response);
        chrome.runtime.sendMessage({
          action: 'transaction_complete',
          eventId: requestInfo.id,
          txHash,
          explorerTxLink: 'https://runescan.io/tx/',
        });
        return txHash;
      } else {
        throw createProviderRpcError(4200, 'User denied transaction');
      }
    }
    default:
      throw createProviderRpcError(4200, `Method ${method} not supported`);
  }
};
