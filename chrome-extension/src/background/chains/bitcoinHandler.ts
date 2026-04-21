import { requestStorage } from '@extension/storage';
import { v4 as uuidv4 } from 'uuid';
import { Chain, ChainToNetworkId, shortListSymbolToCaip, caipToNetworkId } from '../chainConfig';
import * as wallet from '../wallet';
import { createProviderRpcError } from '../utils';

const TAG = ' | bitcoinHandler | ';

export const handleBitcoinRequest = async (
  method: string,
  params: any[],
  requestInfo: any,
  ADDRESS: string,
  KEEPKEY_WALLET: any,
  requireApproval: (networkId: string, requestInfo: any, chain: any, method: string, params: any) => Promise<any>,
): Promise<any> => {
  const tag = `${TAG} | handleBitcoinRequest | `;

  switch (method) {
    case 'request_accounts': {
      const pubkeys = wallet.getPubkeys(ChainToNetworkId[Chain.Bitcoin]);
      const accounts = pubkeys.map((pubkey: any) => pubkey.master || pubkey.address);
      return [accounts];
    }

    case 'request_balance': {
      // Return balance from pubkeys (balance fetching is now separate)
      return [null]; // Balance fetching deferred to Pioneer API HTTP calls
    }

    case 'request_paths': {
      const paths = wallet.getPaths().filter((p: any) => p.networks.includes(ChainToNetworkId[Chain.Bitcoin]));
      return paths;
    }

    case 'request_pubkeys': {
      const pubkeys = wallet.getPubkeys(ChainToNetworkId[Chain.Bitcoin]);
      return pubkeys;
    }

    case 'transfer': {
      const caip = shortListSymbolToCaip['BTC'];
      console.log(tag, 'caip: ', caip);
      const networkId = caipToNetworkId(caip);

      requestInfo.id = uuidv4();
      chrome.runtime.sendMessage({
        action: 'TRANSACTION_CONTEXT_UPDATED',
        id: requestInfo.id,
      });

      const pubkeys = wallet.getPubkeys(ChainToNetworkId[Chain.Bitcoin]);
      console.log(tag, 'pubkeys: ', pubkeys);
      if (!pubkeys || pubkeys.length === 0) throw Error('Failed to locate pubkeys for Bitcoin');

      const sendPayload = {
        caip,
        to: params[0].recipient,
        amount: params[0].amount.amount,
        feeLevel: 5,
        isMax: params[0].isMax,
      };
      console.log(tag, 'Send Payload: ', sendPayload);

      // Build UTXO transaction via Pioneer API HTTP call
      const buildTx = async function () {
        try {
          const buildResponse = await fetch('https://api.keepkey.info/api/v1/buildTx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...sendPayload, pubkeys }),
          });
          const unsignedTx = await buildResponse.json();
          console.log(tag, 'unsignedTx: ', unsignedTx);

          const storedEvent = await requestStorage.getEventById(requestInfo.id);
          storedEvent.unsignedTx = unsignedTx;
          await requestStorage.updateEventById(requestInfo.id, storedEvent);

          chrome.runtime.sendMessage({
            action: 'utxo_build_tx',
            unsignedTx: requestInfo,
          });
        } catch (e) {
          console.error(e);
          chrome.runtime.sendMessage({
            action: 'transaction_error',
            eventId: requestInfo.id,
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
        chain: 'bitcoin',
        requestInfo,
        type: 'transfer',
        request: params,
        status: 'request',
        timestamp: new Date().toISOString(),
      };
      console.log(tag, 'Requesting approval for event:', event);
      // @ts-expect-error
      const eventSaved = await requestStorage.addEvent(event);
      if (!eventSaved) throw Error('Failed to create event!');

      const result = await requireApproval(networkId, requestInfo, 'bitcoin', method, params[0]);
      console.log(tag, 'result:', result);

      const response = await requestStorage.getEventById(requestInfo.id);

      if (result.success && response.unsignedTx) {
        // Sign using vault SDK
        const sdk = wallet.getSdk();
        const signedTx = await sdk.btc.btcSignTransaction(response.unsignedTx);
        console.log(tag, 'signedTx: ', signedTx);

        response.signedTx = signedTx;
        await requestStorage.updateEventById(requestInfo.id, response);

        try {
          // Broadcast via Pioneer API
          const broadcastResponse = await fetch('https://api.keepkey.info/api/v1/broadcastTx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ caip, signedTx: signedTx.serializedTx || signedTx }),
          });
          let txHash = await broadcastResponse.json();
          if (txHash.txHash) txHash = txHash.txHash;
          if (txHash.txid) txHash = txHash.txid;

          response.txid = txHash;
          await requestStorage.updateEventById(requestInfo.id, response);

          chrome.runtime.sendMessage({
            action: 'transaction_complete',
            eventId: requestInfo.id,
            txHash: txHash,
            explorerTxLink: 'https://mempool.space/tx/',
          });
          return txHash;
        } catch (e) {
          console.error(tag, e);
          chrome.runtime.sendMessage({
            action: 'transaction_error',
            eventId: requestInfo.id,
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
