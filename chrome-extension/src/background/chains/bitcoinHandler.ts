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
      const networkId = caipToNetworkId(caip);
      requestInfo.id = uuidv4();
      //push event to ux
      chrome.runtime.sendMessage({
        action: 'TRANSACTION_CONTEXT_UPDATED',
        id: requestInfo.id,
      });
      // eslint-disable-next-line no-constant-condition
      if (!KEEPKEY_WALLET.assetContext) {
        // Set context to the chain, defaults to ETH
        await KEEPKEY_WALLET.setAssetContext({ caip });
      }
      const pubkeys = KEEPKEY_WALLET.pubkeys.filter((e: any) => e.networks.includes(ChainToNetworkId[Chain.Bitcoin]));
      console.log(tag, 'pubkeys: ', pubkeys);
      if (!pubkeys || pubkeys.length === 0) throw Error('Failed to locate pubkeys for chain ' + Chain.Bitcoin);

      const wallet = await KEEPKEY_WALLET.swapKit.getWallet(Chain.Bitcoin);
      if (!wallet) throw new Error('Failed to init swapkit');
      const walletAddress = await wallet.getAddress();
      console.log(tag, 'walletAddress: ', walletAddress);

      const buildTx = async function () {
        try {
          const utxos = [];
          for (let i = 0; i < pubkeys.length; i++) {
            const pubkey = pubkeys[i];
            let utxosResp = await KEEPKEY_WALLET.pioneer.ListUnspent({ network: 'BTC', xpub: pubkey.pubkey });
            utxosResp = utxosResp.data;
            console.log('utxosResp: ', utxosResp);
            utxos.push(...utxosResp);
          }
          console.log(tag, 'utxos: ', utxos);

          //get new change address
          let changeAddressIndex = await KEEPKEY_WALLET.pioneer.GetChangeAddress({
            network: 'BTC',
            xpub: pubkeys[0].pubkey || pubkeys[0].xpub,
          });
          changeAddressIndex = changeAddressIndex.data.changeIndex;
          console.log(tag, 'changeAddressIndex: ', changeAddressIndex);

          const path = DerivationPath['BTC'].replace('/0/0', `/1/${changeAddressIndex}`);
          console.log(tag, 'path: ', path);
          const customAddressInfo = {
            coin: 'Bitcoin',
            script_type: 'p2pkh',
            address_n: bip32ToAddressNList(path),
          };
          const address = await wallet.getAddress(customAddressInfo);
          console.log('address: ', address);
          const changeAddress = {
            address: address,
            path: path,
            index: changeAddressIndex,
            addressNList: bip32ToAddressNList(path),
          };

          for (let i = 0; i < utxos.length; i++) {
            const utxo = utxos[i];
            //@ts-ignore
            utxo.value = Number(utxo.value);
          }
          console.log('utxos: ', utxos);

          const amountOut: number = Math.floor(Number(params[0].amount.amount) * 1e8);

          console.log(tag, 'amountOut: ', amountOut);
          const effectiveFeeRate = 10;
          console.log('utxos: ', utxos);
          let { inputs, outputs, fee } = coinSelect.default(
            utxos,
            [{ address: params[0].recipient, value: amountOut }],
            effectiveFeeRate,
          );
          if (!inputs || !outputs) {
            ({ inputs, outputs, fee } = coinSelectSplit.default(
              utxos,
              [{ address: params[0].recipient }], // No 'value' field for send-max
              effectiveFeeRate,
            ));
          }
          if (!inputs || !outputs || !fee) {
            chrome.runtime.sendMessage({
              action: 'utxo_build_tx_error',
              error: 'coinselect failed to find a solution. (OUT OF INPUTS) try a lower amount',
            });
          }
          console.log('inputs: ', inputs);
          console.log('outputs: ', outputs);
          console.log('fee: ', fee);

          const unsignedTx = await wallet.buildTx({
            inputs,
            outputs,
            memo: params[0].memo || '',
            changeAddress,
          });
          //push to front

          chrome.runtime.sendMessage({
            action: 'utxo_build_tx',
            unsignedTx: requestInfo,
          });

          const storedEvent = await requestStorage.getEventById(requestInfo.id);
          console.log(tag, 'storedEvent: ', storedEvent);
          storedEvent.utxos = utxos;
          storedEvent.changeAddress = changeAddress;
          storedEvent.unsignedTx = unsignedTx;
          await requestStorage.updateEventById(requestInfo.id, storedEvent);
        } catch (e) {
          console.error(e);
        }
      };

      buildTx();

      // Proceed with requiring approval without waiting for buildTx to resolve
      const result = await requireApproval(networkId, requestInfo, 'bitcoin', method, params[0]);
      console.log(tag, 'result:', result);

      const response = await requestStorage.getEventById(requestInfo.id);
      console.log(tag, 'response: ', response);

      if (result.success && response.unsignedTx) {
        const signedTx = await wallet.signTx(
          response.unsignedTx.inputs,
          response.unsignedTx.outputs,
          response.unsignedTx.memo,
        );

        response.signedTx = signedTx;
        await requestStorage.updateEventById(requestInfo.id, response);

        const txHash = await wallet.broadcastTx(signedTx);

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
      throw createProviderRpcError(4200, `Method ${method} not supported`);
    }
  }
};
