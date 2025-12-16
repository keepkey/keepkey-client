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

    //get username from storage
    const keepkeyApiKey = (await keepKeyApiKeyStorage.getApiKey()) || 'key:123';
    let username = await pioneerKeyStorage.getUsername();
    let queryKey = await pioneerKeyStorage.getUsername();
    const spec = (await pioneerKeyStorage.getPioneerSpec()) || 'https://api.keepkey.info/spec/swagger.json';
    const wss = (await pioneerKeyStorage.getPioneerWss()) || 'wss://api.keepkey.info';
    if (!queryKey) {
      queryKey = `key:${uuidv4()}`;
      pioneerKeyStorage.saveQueryKey(queryKey);
    }
    if (!username) {
      username = `user:${uuidv4()}`;
      username = username.substring(0, 13);
      pioneerKeyStorage.saveUsername(username);
    }
    console.log(tag, 'keepkeyApiKey:', keepkeyApiKey);
    console.log(tag, 'username:', username);
    console.log(tag, 'queryKey:', queryKey);
    console.log(tag, 'spec:', spec);
    console.log(tag, 'wss:', wss);
    //let spec = 'https://api.keepkey.info/spec/swagger.json'

    const config: any = {
      appName: 'KeepKey Client',
      appIcon: 'https://api.keepkey.info/coins/keepkey.png',
      username,
      queryKey,
      spec,
      keepkeyApiKey,
      paths,
      blockchains: allByCaip,
      nodes: [],
      pubkeys: [],
      balances: [],
    };

    // AUTO-LOAD: Try to load cached pubkeys for view-only mode
    try {
      const cacheEnabled = await pubkeyStorage.isCacheEnabled();
      if (cacheEnabled) {
        const cached = await pubkeyStorage.loadPubkeys();
        if (cached && cached.pubkeys.length > 0) {
          config.pubkeys = cached.pubkeys;
          console.log('✅ Loaded', cached.pubkeys.length, 'cached pubkeys for view-only mode');
          console.log('ℹ️ Device:', cached.deviceInfo.label, '| Age:', Math.round((Date.now() - cached.timestamp) / 60000), 'min');
        }
      }
    } catch (error) {
      console.warn('⚠️ Could not load cached pubkeys:', error);
      // Continue without cached pubkeys
    }

    const app = new SDK(spec, config);
    await app.init([], {});

    if (app.keepkeyApiKey !== keepkeyApiKey) {
      console.log('SAVING API KEY. ');
      keepKeyApiKeyStorage.saveApiKey(app.keepkeyApiKey);
    }

    return app;
  } catch (e) {
    console.error(e);
    throw e;
  }
};
