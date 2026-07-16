import { requestStorage } from '@extension/storage';
import { v4 as uuidv4 } from 'uuid';
import { Chain, ChainToNetworkId, shortListSymbolToCaip, caipToNetworkId } from '../chainConfig';
import * as wallet from '../wallet';
import { utxoAccountFromPubkeyRow } from '../utxoDerive';
import { createProviderRpcError } from '../utils';
import { fetchJsonWithTimeout } from '../fetchUtils';

const TAG = ' | dogecoinHandler | ';

export const handleDogecoinRequest = async (
  method: string,
  params: any[],
  requestInfo: any,
  ADDRESS: string,
  KEEPKEY_WALLET: any,
  requireApproval: (networkId: string, requestInfo: any, chain: any, method: string, params: any) => Promise<any>,
): Promise<any> => {
  const tag = TAG + ' | handleDogecoinRequest | ';
  switch (method) {
    case 'request_accounts': {
      const networkId = ChainToNetworkId[Chain.Dogecoin];
      const pubkeys = wallet.getPubkeys(networkId);
      // Vault batch rows carry the xpub with an empty address — derive the
      // receive address locally instead of handing dApps empty strings.
      const accounts = pubkeys.map((pubkey: any) => utxoAccountFromPubkeyRow(pubkey, networkId)).filter(Boolean);
      return [accounts];
    }
    case 'request_paths': {
      return wallet.getPaths().filter((p: any) => p.networks.includes(ChainToNetworkId[Chain.Dogecoin]));
    }
    case 'request_balance': {
      return [null];
    }
    case 'transfer': {
      const caip = shortListSymbolToCaip['DOGE'];
      const networkId = caipToNetworkId(caip);
      requestInfo.id = uuidv4();
      chrome.runtime.sendMessage({ action: 'TRANSACTION_CONTEXT_UPDATED', id: requestInfo.id });

      const pubkeys = wallet.getSendPubkeys(ChainToNetworkId[Chain.Dogecoin], params[0]?.accountIndex);
      if (!pubkeys || pubkeys.length === 0) throw Error('Failed to locate pubkeys for Dogecoin');

      const sendPayload = {
        caip,
        to: params[0].recipient,
        amount: params[0].amount.amount,
        feeLevel: 5,
        isMax: params[0].isMax,
      };

      // Build before approval — see bitcoinHandler for the race rationale.
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
        chain: 'dogecoin',
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

      const result = await requireApproval(networkId, requestInfo, 'dogecoin', method, params[0]);
      const response = await requestStorage.getEventById(requestInfo.id);
      if (!response) throw Error('Failed to load event for signing!');

      if (result.success && response.unsignedTx) {
        const sdk = wallet.getSdk();
        const signedTx = await sdk.btc.btcSignTransaction({ ...response.unsignedTx, coin: 'Dogecoin' });
        response.signedTx = signedTx;
        await requestStorage.updateEventById(requestInfo.id, response);

        let txHash: any = await fetchJsonWithTimeout<any>(
          'https://api.keepkey.info/api/v1/broadcastTx',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ caip, signedTx: signedTx.serializedTx || signedTx }),
          },
          { timeoutMs: 15000, retries: 1 },
        );
        if (txHash.txHash) txHash = txHash.txHash;
        if (txHash.txid) txHash = txHash.txid;
        response.txid = txHash;
        await requestStorage.updateEventById(requestInfo.id, response);
        chrome.runtime.sendMessage({
          action: 'transaction_complete',
          eventId: requestInfo.id,
          txHash,
          explorerTxLink: 'https://blockchair.com/dogecoin/transaction/',
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
