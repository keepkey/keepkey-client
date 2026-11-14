import { requestStorage } from '@extension/storage';
import { v4 as uuidv4 } from 'uuid';
import { Chain, ChainToNetworkId, shortListSymbolToCaip, caipToNetworkId } from '../chainConfig';
import * as wallet from '../wallet';
import { utxoAccountFromPubkeyRow } from '../utxoDerive';
import { createProviderRpcError } from '../utils';
import { broadcastViaPioneer } from '../fetchUtils';
import { buildViaDesktop } from './buildViaDesktop';

export const handleBitcoinCashRequest = async (
  method: string,
  params: any[],
  requestInfo: any,
  ADDRESS: string,
  KEEPKEY_WALLET: any,
  requireApproval: (networkId: string, requestInfo: any, chain: any, method: string, params: any) => Promise<any>,
): Promise<any> => {
  switch (method) {
    case 'request_accounts': {
      const networkId = ChainToNetworkId[Chain.BitcoinCash];
      const pubkeys = wallet.getPubkeys(networkId);
      // Vault batch rows carry the xpub with an empty address — derive the
      // cashaddr locally instead of returning the bare 'bitcoincash:' prefix.
      // Derived cashaddrs already include the prefix; explicit ones may not.
      const accounts = pubkeys
        .map((pubkey: any) => utxoAccountFromPubkeyRow(pubkey, networkId))
        .filter((account): account is string => !!account)
        .map((account: string) => (account.includes(':') ? account : 'bitcoincash:' + account));
      return [accounts[0]];
    }
    case 'request_balance': {
      return [null];
    }
    case 'transfer': {
      const caip = shortListSymbolToCaip['BCH'];
      const networkId = caipToNetworkId(caip);
      requestInfo.id = uuidv4();
      chrome.runtime.sendMessage({ action: 'TRANSACTION_CONTEXT_UPDATED', id: requestInfo.id });

      // KeepKey Desktop builds the tx locally (keys, UTXOs, change, fee) before the
      // approval event exists, so the event always carries what will be signed.
      const build = await buildViaDesktop(wallet.getSdk(), caip, params[0], 'Bitcoin Cash');

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
        chain: 'bitcoincash',
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

      const result = await requireApproval(networkId, requestInfo, 'bitcoincash', method, params[0]);
      const response = await requestStorage.getEventById(requestInfo.id);
      if (!response) throw Error('Failed to load event for signing!');

      if (result.success) {
        const signedTx = await wallet.signViaVault(build.signRoute, build.signBody);
        response.signedTx = signedTx;
        await requestStorage.updateEventById(requestInfo.id, response);

        const txHash: any = await broadcastViaPioneer(caip, signedTx.serializedTx || signedTx);
        response.txid = txHash;
        await requestStorage.updateEventById(requestInfo.id, response);
        chrome.runtime.sendMessage({
          action: 'transaction_complete',
          eventId: requestInfo.id,
          txHash,
          explorerTxLink: 'https://blockchair.com/bitcoin-cash/transaction/',
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
