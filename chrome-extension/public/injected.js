(function () {
  const TAG = ' | InjectedScript | ';
  const VERSION = '1.0.7';
  console.log('**** KeepKey Injection script ****:', VERSION);

  // Prevent multiple injections
  if (window.keepkeyInjected) {
    console.log(TAG, 'KeepKey is already injected.');
    return;
  }
  window.keepkeyInjected = true;

  const SITE_URL = window.location.href;
  const SOURCE_INFO = {
    siteUrl: SITE_URL,
    scriptSource: 'KeepKey Extension',
    version: VERSION,
    injectedTime: new Date().toISOString(),
  };
  console.log('SOURCE_INFO:', SOURCE_INFO);

  let messageId = 0;
  const callbacks = {};
  const messageQueue = [];

  function processQueue(requestInfo, callback) {
    for (let i = 0; i < messageQueue.length; i++) {
      const queuedMessage = messageQueue[i];
      if (queuedMessage.id === requestInfo.id) {
        callback(null, queuedMessage.result);
        messageQueue.splice(i, 1); // Remove the processed message from the queue
        return true;
      }
    }
    return false;
  }

  function walletRequest(method, params = [], chain, callback) {
    const tag = TAG + ' | walletRequest | ';
    try {
      const requestId = ++messageId;
      const requestInfo = {
        id: requestId,
        method,
        params,
        chain,
        siteUrl: SOURCE_INFO.siteUrl,
        scriptSource: SOURCE_INFO.scriptSource,
        version: SOURCE_INFO.version,
        requestTime: new Date().toISOString(),
        referrer: document.referrer,
        href: window.location.href,
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
      };
      console.log(tag, 'method:', method);
      console.log(tag, 'params:', params);
      console.log(tag, 'chain:', chain);

      callbacks[requestId] = { callback };

      window.postMessage(
        {
          source: 'keepkey-injected',
          type: 'WALLET_REQUEST',
          requestId,
          requestInfo,
        },
        '*',
      );

      // Recheck the queue for any pending matches
      processQueue(requestInfo, callback);
    } catch (error) {
      console.error(tag, `Error in walletRequest:`, error);
      callback(error); // Use callback to return the error
    }
  }

  // Listen for responses from the content script
  window.addEventListener('message', event => {
    const tag = TAG + ' | window.message | ';
    if (event.source !== window) return;
    if (event.data && event.data.source === 'keepkey-content' && event.data.type === 'WALLET_RESPONSE') {
      const { requestId, result, error } = event.data;
      const storedCallback = callbacks[requestId];
      if (storedCallback) {
        if (error) {
          storedCallback.callback(error);
        } else {
          storedCallback.callback(null, result);
        }
        delete callbacks[requestId];
      } else {
        console.warn(tag, 'No callback found for requestId:', requestId);
      }
    }
  });

  function sendRequestAsync(payload, param1, callback) {
    const tag = TAG + ' | sendRequestAsync | ';
    console.log(tag, 'payload:', payload);
    console.log(tag, 'param1:', param1);
    console.log(tag, 'callback:', callback);

    let chain = payload.chain || 'ethereum';

    if (typeof callback === 'function') {
      walletRequest(payload.method, payload.params, chain, (error, result) => {
        if (error) {
          callback(error);
        } else {
          callback(null, { id: payload.id, jsonrpc: '2.0', result });
        }
      });
    } else {
      console.error(tag, 'Callback is not a function:', callback);
    }
  }

  function sendRequestSync(payload, param1) {
    const tag = TAG + ' | sendRequestSync | ';
    console.log(tag, 'wallet.sendSync called with:', payload);
    let params = payload.params || param1;
    let method = payload.method || payload;
    let chain = payload.chain || 'ethereum';
    console.log(tag, 'selected payload:', payload);
    console.log(tag, 'selected params:', params);
    console.log(tag, 'selected chain:', chain);

    return {
      id: payload.id,
      jsonrpc: '2.0',
      result: walletRequest(method, params, chain, () => {}),
    };
  }

  function createWalletObject(chain) {
    console.log('Creating wallet object for chain:', chain);
    let wallet = {
      network: 'mainnet',
      isKeepKey: true,
      isMetaMask: true,
      isConnected: true,
      request: ({ method, params }) => {
        return new Promise((resolve, reject) => {
          walletRequest(method, params, chain, (error, result) => {
            if (error) {
              reject(error);
            } else {
              resolve(result);
            }
          });
        });
      },
      send: (payload, param1, callback) => {
        console.log('send:', { payload, param1, callback });
        if (!payload.chain) {
          payload.chain = chain;
        }
        return callback ? sendRequestAsync(payload, param1, callback) : sendRequestSync(payload, param1);
      },
      sendAsync: (payload, param1, callback) => {
        console.log('sendAsync:', { payload, param1, callback });
        if (!payload.chain) {
          payload.chain = chain;
        }
        return sendRequestAsync(payload, param1, callback);
      },
      on: (event, handler) => {
        console.log('Adding event listener for:', event);
        window.addEventListener(event, handler);
      },
      removeListener: (event, handler) => {
        console.log('Removing event listener for:', event);
        window.removeEventListener(event, handler);
      },
      removeAllListeners: () => {
        console.log('Removing all event listeners');
        // Implement as needed
      },
    };
    if (chain === 'ethereum') {
      wallet.chainId = '0x1';
      wallet.networkVersion = '1';
    }

    return wallet;
  }

  function announceProvider(ethereumProvider) {
    const info = {
      uuid: '350670db-19fa-4704-a166-e52e178b59d4',
      name: 'KeepKey Client',
      icon: 'https://pioneers.dev/coins/keepkey.png',
      rdns: 'com.keepkey',
    };

    const announceEvent = new CustomEvent('eip6963:announceProvider', {
      detail: { info, provider: ethereumProvider },
    });

    console.log(TAG, 'Dispatching provider event with correct detail:', announceEvent);
    window.dispatchEvent(announceEvent);
  }

  function mountWallet() {
    const tag = TAG + ' | window.wallet | ';

    // Create wallet objects for each chain
    const ethereum = createWalletObject('ethereum');
    const xfi = {
      binance: createWalletObject('binance'),
      bitcoin: createWalletObject('bitcoin'),
      bitcoincash: createWalletObject('bitcoincash'),
      dogecoin: createWalletObject('dogecoin'),
      dash: createWalletObject('dash'),
      ethereum: ethereum,
      keplr: createWalletObject('keplr'),
      litecoin: createWalletObject('litecoin'),
      thorchain: createWalletObject('thorchain'),
      mayachain: createWalletObject('mayachain'),
      solana: createWalletObject('solana'),
    };

    const handler = {
      get: function (target, prop, receiver) {
        console.log(tag, `Proxy get handler: ${prop}`);
        return Reflect.get(target, prop, receiver);
      },
      set: function (target, prop, value) {
        console.log(tag, `Proxy set handler: ${prop} = ${value}`);
        return Reflect.set(target, prop, value);
      },
    };

    const proxyEthereum = new Proxy(ethereum, handler);
    const proxyXfi = new Proxy(xfi, handler);

    Object.defineProperty(window, 'ethereum', {
      value: proxyEthereum,
      writable: false,
      configurable: true,
    });

    Object.defineProperty(window, 'xfi', {
      value: proxyXfi,
      writable: false,
      configurable: true,
    });

    console.log(tag, 'window.ethereum and window.xfi have been mounted');

    announceProvider(proxyEthereum);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    mountWallet();
  } else {
    document.addEventListener('DOMContentLoaded', mountWallet);
  }
})();
