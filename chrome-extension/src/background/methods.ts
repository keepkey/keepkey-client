import { caipToNetworkId, shortListNameToCaip } from './chainConfig';

//@ts-ignore
import { v4 as uuidv4 } from 'uuid';
import { handleEthereumRequest } from './chains/ethereumHandler';
import { handleThorchainRequest } from './chains/thorchainHandler';
import { handleBitcoinRequest } from './chains/bitcoinHandler';
import { handleBitcoinCashRequest } from './chains/bitcoinCashHandler';
import { handleDogecoinRequest } from './chains/dogecoinHandler';
import { handleLitecoinRequest } from './chains/litecoinHandler';
import { handleDashRequest } from './chains/dashHandler';
import { handleCosmosRequest } from './chains/cosmosHandler';
import { handleOsmosisRequest } from './chains/osmosisHandler';
import { handleMayaRequest } from './chains/mayaHandler';
import { handleRippleRequest } from './chains/rippleHandler';
import { handleSolanaRequest } from './chains/solanaHandler';
import { handleTronRequest } from './chains/tronHandler';
import { handleTonRequest } from './chains/tonHandler';
import type { ProviderRpcError } from './utils';
import { createProviderRpcError, formatUserError } from './utils';
import { openSidePanel, setApprovalBadge } from './popup';

const TAG = ' | METHODS | ';

// Approval requests are dApp-triggered, which means we're NOT inside a user
// gesture. `chrome.sidePanel.open()` requires a recent user gesture, so the
// call below may be ignored. The fallback path is the action badge plus
// `setPanelBehavior({openPanelOnActionClick: true})` wired in index.ts —
// the user clicks the extension icon (a real user gesture), the sidebar
// opens, and its `requestStorage` subscription picks up the pending event.
//
// Hard timeout on the promise so nothing hangs forever if the user
// ignores the request. Matches the sidebar's event-age eviction window.
const APPROVAL_TIMEOUT_MS = 10 * 60_000;

/*
  "requestInfo": {
    "chain": "ethereum",
    "href": "http://localhost:5173/",
    "id": 1,
    "language": "en-US",
    "method": "personal_sign",
    "params": [
      "Hello, World!",
      null
    ],
    "platform": "MacIntel",
    "referrer": "",
    "requestTime": "2024-09-19T20:33:37.020Z",
    "scriptSource": "KeepKey Extension",
    "siteUrl": "http://localhost:5173/",
    "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "version": "1.0.7"
  },


 */

const requireApproval = async function (
  networkId: string,
  requestInfo: any,
  chain?: any,
  method?: string,
  params?: any,
): Promise<any> {
  const tag = TAG + ' | requireApproval | ';
  try {
    console.log(tag, 'networkId:', networkId);

    //if chain is ethereum, use current context for networkId

    //chain to networkId
    // const networkId = caipToNetworkId(shortListNameToCaip[chain]);
    // if (!networkId) throw Error('unhandled chain ' + chain);
    // console.log(tag, 'NetworkId:', networkId);

    //if evm set from address

    //if token transfer, set assetContext to token

    //set assetContext

    // const event = {
    //   id: requestInfo.id || uuidv4(),
    //   networkId,
    //   chain,
    //   href: requestInfo.href,
    //   language: requestInfo.language,
    //   platform: requestInfo.platform,
    //   referrer: requestInfo.referrer,
    //   requestTime: requestInfo.requestTime,
    //   scriptSource: requestInfo.scriptSource,
    //   siteUrl: requestInfo.siteUrl,
    //   userAgent: requestInfo.userAgent,
    //   injectScriptVersion: requestInfo.version,
    //   requestInfo,
    //   unsignedTx: requestInfo.transaction,
    //   type: method,
    //   request: params,
    //   status: 'request',
    //   timestamp: new Date().toISOString(),
    // };
    // console.log(tag, 'Requesting approval for event:', event);
    // //@ts-expect-error
    // const eventSaved = await requestStorage.addEvent(event);
    // if (eventSaved) {
    //   chrome.runtime.sendMessage({
    //     action: 'TRANSACTION_CONTEXT_UPDATED',
    //     id: event.id,
    //   });
    //   console.log(tag, 'Event saved:', event);
    // } else {
    //   throw new Error('Event not saved');
    // }

    setApprovalBadge(true);
    await openSidePanel(requestInfo);

    // Wait for user's decision. Resolves on ANY of:
    //   - user approves/rejects in sidebar (eth_sign_response arrives)
    //   - APPROVAL_TIMEOUT_MS elapses without a response (treated as reject)
    return new Promise(resolve => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        chrome.runtime.onMessage.removeListener(listener);
        if (timer != null) clearTimeout(timer);
        setApprovalBadge(false);
      };

      const listener = (message: any) => {
        if (message?.action === 'eth_sign_response' && message?.response?.eventId === requestInfo.id) {
          if (settled) return;
          settled = true;
          console.log(tag, 'Received eth_sign_response for event:', message.response.eventId);
          cleanup();
          resolve({ success: message.response.decision === 'accept' });
        }
      };
      chrome.runtime.onMessage.addListener(listener);

      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        console.log(tag, 'Approval timed out, rejecting for event:', requestInfo.id);
        cleanup();
        resolve({ success: false });
      }, APPROVAL_TIMEOUT_MS);
    });
  } catch (e) {
    console.error(tag, e);
    return { success: false }; // Return failure in case of error
  }
};

export const handleWalletRequest = async (
  requestInfo: any,
  chain: string,
  method: string,
  params: any[],
  __KEEPKEY_WALLET: any,
  ADDRESS: string,
): Promise<any> => {
  const tag = ' | handleWalletRequest | ';
  try {
    console.log(tag, 'id:', requestInfo.id);
    console.log(tag, 'chain:', chain);
    console.log(tag, 'method:', method);
    if (!chain) throw Error('Chain not provided!');
    if (!requestInfo) throw Error('Cannot validate request! Refusing to proceed.');

    switch (chain) {
      case 'ethereum': {
        return await handleEthereumRequest(method, params, requestInfo, ADDRESS, __KEEPKEY_WALLET, requireApproval);
        break;
      }
      case 'bitcoin': {
        return await handleBitcoinRequest(method, params, requestInfo, ADDRESS, __KEEPKEY_WALLET, requireApproval);
        break;
      }
      case 'bitcoincash': {
        return await handleBitcoinCashRequest(method, params, requestInfo, ADDRESS, __KEEPKEY_WALLET, requireApproval);
        break;
      }
      case 'dogecoin': {
        console.log(tag, 'checkpoint handle doge');
        return await handleDogecoinRequest(method, params, requestInfo, ADDRESS, __KEEPKEY_WALLET, requireApproval);
        break;
      }
      case 'litecoin': {
        console.log(tag, 'checkpoint handle litecoin');
        return await handleLitecoinRequest(method, params, requestInfo, ADDRESS, __KEEPKEY_WALLET, requireApproval);
        break;
      }
      case 'dash': {
        return await handleDashRequest(method, params, requestInfo, ADDRESS, __KEEPKEY_WALLET, requireApproval);
        break;
      }
      case 'thorchain': {
        return await handleThorchainRequest(method, params, requestInfo, ADDRESS, __KEEPKEY_WALLET, requireApproval);
        break;
      }
      case 'osmosis': {
        return await handleOsmosisRequest(method, params, requestInfo, ADDRESS, __KEEPKEY_WALLET, requireApproval);
        break;
      }
      case 'cosmos': {
        return await handleCosmosRequest(method, params, requestInfo, ADDRESS, __KEEPKEY_WALLET, requireApproval);
        break;
      }
      case 'ripple': {
        return await handleRippleRequest(method, params, requestInfo, ADDRESS, __KEEPKEY_WALLET, requireApproval);
        break;
      }
      case 'mayachain': {
        return await handleMayaRequest(method, params, requestInfo, ADDRESS, __KEEPKEY_WALLET, requireApproval);
        break;
      }
      case 'solana': {
        return await handleSolanaRequest(method, params, requestInfo, ADDRESS, __KEEPKEY_WALLET, requireApproval);
        break;
      }
      case 'tron':
      case 'trx': {
        return await handleTronRequest(method, params, requestInfo, ADDRESS, __KEEPKEY_WALLET, requireApproval);
        break;
      }
      case 'ton': {
        return await handleTonRequest(method, params, requestInfo, ADDRESS, __KEEPKEY_WALLET, requireApproval);
        break;
      }
      default: {
        console.log(tag, `Chain ${chain} not supported`);
        throw createProviderRpcError(4200, `Chain ${chain} not supported`);
      }
    }
  } catch (error) {
    console.error(tag, `Error processing method ${method}:`, error);

    // Extract error message - prefer structured error message over JSON stringification
    let errorMessage: string;
    if ((error as ProviderRpcError).message) {
      errorMessage = (error as ProviderRpcError).message;
    } else if (error instanceof Error) {
      errorMessage = error.message;
    } else {
      errorMessage = JSON.stringify(error);
    }

    // Legacy fallback for any errors that slip through chain handlers
    if (errorMessage.indexOf('unrecognized address') >= 0) {
      errorMessage = 'Please restart KeepKey Desktop, invalid state';
    }

    // Translate "No device connected" SdkError into user-facing message
    errorMessage = formatUserError({ message: errorMessage });

    //push error to the popup
    chrome.runtime.sendMessage({
      action: 'transaction_error',
      eventId: requestInfo?.id,
      error: errorMessage,
    });

    if ((error as ProviderRpcError).code && (error as ProviderRpcError).message) {
      throw error;
    } else {
      throw createProviderRpcError(4000, `Unexpected error processing method ${method}`, error);
    }
  }
};
