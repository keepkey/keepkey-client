import { requestStorage } from '@extension/storage';
import { v4 as uuidv4 } from 'uuid';
import { Chain, ChainToNetworkId, shortListSymbolToCaip, caipToNetworkId } from '../chainConfig';
import * as wallet from '../wallet';
import { createProviderRpcError } from '../utils';
import { fetchJsonWithTimeout, broadcastViaPioneer } from '../fetchUtils';

const TAG = ' | osmosisHandler | ';

export const handleOsmosisRequest = async (
  method: string,
  params: any[],
  requestInfo: any,
  ADDRESS: string,
  KEEPKEY_WALLET: any,
  requireApproval: (networkId: string, requestInfo: any, chain: any, method: string, params: any) => Promise<any>,
): Promise<any> => {
  const tag = TAG + ' | handleOsmosisRequest | ';
  switch (method) {
    case 'request_accounts': {
      const pubkeys = wallet.getPubkeys(ChainToNetworkId[Chain.Osmosis]);
      const accounts = pubkeys.map((pubkey: any) => pubkey.master || pubkey.address);
      return [accounts];
    }
    case 'request_balance': {
      return [null];
    }
    case 'transfer': {
      const caip = shortListSymbolToCaip['OSMO'];
      const networkId = caipToNetworkId(caip);
      requestInfo.id = uuidv4();
      chrome.runtime.sendMessage({ action: 'TRANSACTION_CONTEXT_UPDATED', id: requestInfo.id });

      const pubkeys = wallet.getSendPubkeys(ChainToNetworkId[Chain.Osmosis], params[0]?.accountIndex);
      if (!pubkeys || pubkeys.length === 0) throw Error('Failed to locate pubkeys for Osmosis');

      const sendPayload = {
        caip,
        to: params[0].recipient,
        amount: params[0].amount.amount,
        feeLevel: 5,
        isMax: params[0].isMax,
      };

      let unsignedTx: any;
      try {
        unsignedTx = await fetchJsonWithTimeout<any>(
          'https://api.keepkey.info/api/v1/buildTx',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...sendPayload, pubkeys }),
          },
          { timeoutMs: 15000, retries: 1 },
        );
        console.log(tag, 'unsignedTx: ', unsignedTx);
      } catch (e) {
        console.error(tag, 'buildTx failed:', e);
        throw createProviderRpcError(4000, `Failed to build transaction: ${(e as Error)?.message || e}`);
      }

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
        chain: 'osmosis',
        requestInfo,
        unsignedTx,
        type: 'transfer',
        request: params,
        status: 'request',
        timestamp: new Date().toISOString(),
      };
      // @ts-expect-error
      const eventSaved = await requestStorage.addEvent(event);
      if (!eventSaved) throw Error('Failed to create event!');

      const result = await requireApproval(networkId, requestInfo, 'osmosis', method, params[0]);
      const response = await requestStorage.getEventById(requestInfo.id);
      if (!response) throw Error('Failed to load event for signing!');

      if (result.success && response.unsignedTx) {
        const sdk = wallet.getSdk();
        const signedTx = await sdk.osmosis.osmosisSignAmino(response.unsignedTx);
        console.log(tag, 'signedTx: ', signedTx);

        response.signedTx = signedTx;
        await requestStorage.updateEventById(requestInfo.id, response);

        const txHash: any = await broadcastViaPioneer(caip, signedTx.serializedTx || signedTx);

        response.txid = txHash;
        await requestStorage.updateEventById(requestInfo.id, response);
        chrome.runtime.sendMessage({
          action: 'transaction_complete',
          eventId: requestInfo.id,
          txHash,
          explorerTxLink: 'https://www.mintscan.io/osmosis/tx/',
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
