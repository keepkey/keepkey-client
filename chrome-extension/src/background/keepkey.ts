/*
    KeepKey Wallet
 */
import { ChainToNetworkId, getChainEnumValue } from '@pioneer-platform/pioneer-caip';
import { getPaths } from '@pioneer-platform/pioneer-coins';
import { keepKeyApiKeyStorage, pioneerKeyStorage, pubkeyStorage } from '@extension/storage'; // Re-import the storage
// @ts-ignore
import { SDK } from '@pioneer-platform/pioneer-sdk';
import { v4 as uuidv4 } from 'uuid';
// import assert from 'assert';

const TAG = ' | KeepKey | ';
// interface KeepKeyWallet {
//   type: string;
//   icon: string;
//   chains: string[];
//   wallet: any;
//   status: string;
//   isConnected: boolean;
// }
//
// const connectKeepKey = async function () {
//   try {
//   } catch (e) {
//     console.error(e);
//   }
// };

export const onStartKeepkey = async function () {
  const tag = TAG + ' | onStartKeepkey | ';
  try {
    const chains = [
      'ARB',
      'AVAX',
      'BSC',
      'BTC',
      'BCH',
      'GAIA',
      'OSMO',
      'XRP',
      'DOGE',
      'DASH',
      'ETH',
      'LTC',
      'MATIC',
      'THOR',
      'MAYA',
      // 'GNO',
      'BASE',
      'OP',
    ];

    const allByCaip = chains.map(chainStr => {
      const chain = getChainEnumValue(chainStr);
      if (chain) {
        return ChainToNetworkId[chain];
      }
      return undefined;
    });
    console.log(tag, 'allByCaip: ', allByCaip);

    //if chains undefined, default to all!
    //Rules must always be at least 1 chain enabled, else it defaults to all

    const paths = getPaths(allByCaip);

    //add paths to keepkey
    //add account 0 p2sh segwit
    paths.push({
      note: 'Bitcoin account 0 segwit (p2sh)',
      networks: ['bip122:000000000019d6689c085ae165831e93'],
      script_type: 'p2sh-p2wpkh',
      available_scripts_types: ['p2pkh', 'p2sh', 'p2wpkh', 'p2sh-p2wpkh'],
      type: 'xpub',
      addressNList: [0x80000000 + 49, 0x80000000 + 0, 0x80000000 + 0],
      addressNListMaster: [0x80000000 + 49, 0x80000000 + 0, 0x80000000 + 0, 0, 0],
      curve: 'secp256k1',
      showDisplay: false, // Not supported by TrezorConnect or Ledger, but KeepKey should do it
    });

    //add account1
    paths.push({
      note: 'Bitcoin account 0 Native Segwit (Bech32)',
      blockchain: 'bitcoin',
      symbol: 'BTC',
      symbolSwapKit: 'BTC',
      networks: ['bip122:000000000019d6689c085ae165831e93'],
      script_type: 'p2wpkh', //bech32
      available_scripts_types: ['p2pkh', 'p2sh', 'p2wpkh', 'p2sh-p2wpkh'],
      type: 'zpub',
      addressNList: [0x80000000 + 84, 0x80000000 + 0, 0x80000000 + 1],
      addressNListMaster: [0x80000000 + 84, 0x80000000 + 0, 0x80000000 + 1, 0, 0],
      curve: 'secp256k1',
      showDisplay: false, // Not supported by TrezorConnect or Ledger, but KeepKey should do it
    });

    paths.push({
      note: 'Bitcoin account 1 legacy',
      networks: ['bip122:000000000019d6689c085ae165831e93'],
      script_type: 'p2pkh',
      available_scripts_types: ['p2pkh', 'p2sh', 'p2wpkh', 'p2sh-p2wpkh'],
      type: 'xpub',
      addressNList: [0x80000000 + 44, 0x80000000 + 0, 0x80000000 + 1],
      addressNListMaster: [0x80000000 + 44, 0x80000000 + 0, 0x80000000 + 1, 0, 0],
      curve: 'secp256k1',
      showDisplay: false, // Not supported by TrezorConnect or Ledger, but KeepKey should do it
    });

    //add account1
    paths.push({
      note: 'Bitcoin account 1 Native Segwit (Bech32)',
      blockchain: 'bitcoin',
      symbol: 'BTC',
      symbolSwapKit: 'BTC',
      networks: ['bip122:000000000019d6689c085ae165831e93'],
      script_type: 'p2wpkh', //bech32
      available_scripts_types: ['p2pkh', 'p2sh', 'p2wpkh', 'p2sh-p2wpkh'],
      type: 'zpub',
      addressNList: [0x80000000 + 84, 0x80000000 + 0, 0x80000000 + 1],
      addressNListMaster: [0x80000000 + 84, 0x80000000 + 0, 0x80000000 + 1, 0, 0],
      curve: 'secp256k1',
      showDisplay: false, // Not supported by TrezorConnect or Ledger, but KeepKey should do it
    });

    paths.push({
      note: 'Bitcoin account 1 legacy',
      networks: ['bip122:000000000019d6689c085ae165831e93'],
      script_type: 'p2pkh',
      available_scripts_types: ['p2pkh', 'p2sh', 'p2wpkh', 'p2sh-p2wpkh'],
      type: 'xpub',
      addressNList: [0x80000000 + 44, 0x80000000 + 0, 0x80000000 + 2],
      addressNListMaster: [0x80000000 + 44, 0x80000000 + 0, 0x80000000 + 2, 0, 0],
      curve: 'secp256k1',
      showDisplay: false, // Not supported by TrezorConnect or Ledger, but KeepKey should do it
    });

    //add account3
    paths.push({
      note: 'Bitcoin account 1 Native Segwit (Bech32)',
      blockchain: 'bitcoin',
      symbol: 'BTC',
      symbolSwapKit: 'BTC',
      networks: ['bip122:000000000019d6689c085ae165831e93'],
      script_type: 'p2wpkh', //bech32
      available_scripts_types: ['p2pkh', 'p2sh', 'p2wpkh', 'p2sh-p2wpkh'],
      type: 'zpub',
      addressNList: [0x80000000 + 84, 0x80000000 + 0, 0x80000000 + 1],
      addressNListMaster: [0x80000000 + 84, 0x80000000 + 0, 0x80000000 + 1, 0, 0],
      curve: 'secp256k1',
      showDisplay: false, // Not supported by TrezorConnect or Ledger, but KeepKey should do it
    });

    paths.push({
      note: 'Bitcoin account 3 legacy',
      blockchain: 'bitcoin',
      symbol: 'BTC',
      symbolSwapKit: 'BTC',
      networks: ['bip122:000000000019d6689c085ae165831e93'],
      script_type: 'p2pkh',
      available_scripts_types: ['p2pkh', 'p2sh', 'p2wpkh', 'p2sh-p2wpkh'],
      type: 'xpub',
      addressNList: [0x80000000 + 44, 0x80000000 + 0, 0x80000000 + 3],
      addressNListMaster: [0x80000000 + 44, 0x80000000 + 0, 0x80000000 + 3, 0, 0],
      curve: 'secp256k1',
      showDisplay: false, // Not supported by TrezorConnect or Ledger, but KeepKey should do it
    });

    // Ethereum account 1 - m/44'/60'/1'/0/0
    paths.push({
      note: 'Ethereum account 1',
      networks: ['eip155:1'],
      script_type: 'ethereum',
      type: 'address',
      addressNList: [0x80000000 + 44, 0x80000000 + 60, 0x80000000 + 1, 0, 0],
      addressNListMaster: [0x80000000 + 44, 0x80000000 + 60, 0x80000000 + 1, 0, 0],
      curve: 'secp256k1',
      showDisplay: false,
    });

    // Ethereum account 2 - m/44'/60'/2'/0/0
    paths.push({
      note: 'Ethereum account 2',
      networks: ['eip155:1'],
      script_type: 'ethereum',
      type: 'address',
      addressNList: [0x80000000 + 44, 0x80000000 + 60, 0x80000000 + 2, 0, 0],
      addressNListMaster: [0x80000000 + 44, 0x80000000 + 60, 0x80000000 + 2, 0, 0],
      curve: 'secp256k1',
      showDisplay: false,
    });

    //get credentials from storage
    const keepkeyApiKey = (await keepKeyApiKeyStorage.getApiKey()) || 'key:123';
    const spec = (await pioneerKeyStorage.getPioneerSpec()) || 'https://api.keepkey.info/spec/swagger.json';
    const wss = (await pioneerKeyStorage.getPioneerWss()) || 'wss://api.keepkey.info';

    // Generate fresh credentials helper
    function generateCredentials() {
      const id = uuidv4().substring(0, 8);
      return {
        username: `user:${id}`,
        queryKey: `key:${uuidv4()}`,
      };
    }

    // Load cached pubkeys once
    let cachedPubkeys: any[] = [];
    try {
      const cacheEnabled = await pubkeyStorage.isCacheEnabled();
      if (cacheEnabled) {
        const cached = await pubkeyStorage.loadPubkeys();
        if (cached && cached.pubkeys.length > 0) {
          cachedPubkeys = cached.pubkeys;
          console.log('✅ Loaded', cached.pubkeys.length, 'cached pubkeys for view-only mode');
          console.log(
            'ℹ️ Device:',
            cached.deviceInfo.label,
            '| Age:',
            Math.round((Date.now() - cached.timestamp) / 60000),
            'min',
          );
        }
      }
    } catch (error) {
      console.warn('⚠️ Could not load cached pubkeys:', error);
    }

    // Try init with stored credentials first, then cycle with fresh ones
    const MAX_RETRIES = 3;
    let lastError: any = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      let username: string;
      let queryKey: string;

      if (attempt === 0) {
        // First attempt: use stored credentials
        username = (await pioneerKeyStorage.getUsername()) || generateCredentials().username;
        queryKey = `key:${uuidv4()}`; // Always fresh queryKey
      } else {
        // Subsequent attempts: generate completely fresh credentials
        const fresh = generateCredentials();
        username = fresh.username;
        queryKey = fresh.queryKey;
        console.log(tag, `Attempt ${attempt + 1}: cycling to fresh credentials`, username);
      }

      // Save credentials
      await pioneerKeyStorage.saveUsername(username);
      await pioneerKeyStorage.saveQueryKey(queryKey);

      console.log(tag, 'keepkeyApiKey:', keepkeyApiKey);
      console.log(tag, 'username:', username);
      console.log(tag, 'queryKey:', queryKey);
      console.log(tag, 'spec:', spec);
      console.log(tag, 'wss:', wss);

      const config: any = {
        appName: 'KeepKey Client',
        appIcon: 'https://api.keepkey.info/coins/keepkey.png',
        username,
        queryKey,
        spec,
        wss,
        keepkeyApiKey,
        keepkeyEndpoint: 'http://localhost:1646',
        paths,
        blockchains: allByCaip,
        nodes: [],
        pubkeys: cachedPubkeys.length > 0 ? [...cachedPubkeys] : [],
        balances: [],
        transactions: [],
      };

      try {
        const app = new SDK(spec, config);
        await app.init({}, { skipSync: false });

        if (app.keepkeyApiKey !== keepkeyApiKey) {
          console.log('SAVING API KEY.');
          keepKeyApiKeyStorage.saveApiKey(app.keepkeyApiKey);
        }

        return app;
      } catch (initError: any) {
        lastError = initError;
        console.warn(tag, `Init attempt ${attempt + 1} failed:`, initError?.message || initError);
        // If it's a registration error, cycle credentials and retry
        if (initError?.message?.includes('register') || initError?.message?.includes('Registration')) {
          continue;
        }
        // For other errors, don't retry
        throw initError;
      }
    }

    throw lastError || new Error('Failed to initialize after max retries');
  } catch (e) {
    console.error(e);
    throw e;
  }
};
