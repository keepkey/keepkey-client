import { requestStorage } from '@extension/storage';
import { v4 as uuidv4 } from 'uuid';
import { Chain, ChainToNetworkId, shortListSymbolToCaip, caipToNetworkId } from '../chainConfig';
import * as wallet from '../wallet';
import { utxoAccountFromPubkeyRow } from '../utxoDerive';
import { createProviderRpcError } from '../utils';
import { fetchJsonWithTimeout, broadcastViaPioneer } from '../fetchUtils';

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
      const networkId = ChainToNetworkId[Chain.Bitcoin];
      const pubkeys = wallet.getPubkeys(networkId);
      // Vault batch rows carry the xpub with an empty address — derive the
      // receive address locally instead of handing dApps empty strings.
      const accounts = pubkeys.map((pubkey: any) => utxoAccountFromPubkeyRow(pubkey, networkId)).filter(Boolean);
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

      const pubkeys = wallet.getSendPubkeys(ChainToNetworkId[Chain.Bitcoin], params[0]?.accountIndex);
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

      // Build the unsigned tx BEFORE creating the approval event so the
      // event always carries an unsignedTx the moment the user sees it.
      // The previous fire-and-forget pattern raced: if the user approved
      // before buildTx resolved, response.unsignedTx was undefined; if
      // buildTx finished before addEvent, getEventById returned null.
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
        chain: 'bitcoin',
        requestInfo,
        unsignedTx,
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
      if (!response) throw Error('Failed to load event for signing!');

      if (result.success && response.unsignedTx) {
        // Sign using vault SDK
        const sdk = wallet.getSdk();
        const signedTx = await sdk.btc.btcSignTransaction(response.unsignedTx);
        console.log(tag, 'signedTx: ', signedTx);

        response.signedTx = signedTx;
        await requestStorage.updateEventById(requestInfo.id, response);

        try {
          // Broadcast via Pioneer API. fetchJsonWithTimeout enforces an
          // explicit response.ok check + retry on 5xx — without that,
          // a transient Pioneer hiccup (e.g. node failover) would either
          // hang the dApp or surface as a malformed JSON error from the
          // raw `await response.json()` below.
          const txHash: any = await broadcastViaPioneer(caip, signedTx.serializedTx || signedTx);

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
          // Re-throw so the dApp sees the actual broadcast error. Without
          // this the case falls through to `default:` below and the dApp
          // gets "Method transfer not supported" instead of the real
          // failure (timeout, HTTP 5xx, etc.).
          throw e instanceof Error ? e : createProviderRpcError(4000, `Broadcast failed: ${String(e)}`);
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
