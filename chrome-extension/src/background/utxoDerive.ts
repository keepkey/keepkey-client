/**
 * Local UTXO receive-address derivation from an extended pubkey.
 *
 * Replaces the old GET_UTXO_ADDRESS round-trip to the device — pubkey →
 * address is pure BIP32 + script-type encoding, no signing involved, so
 * the device isn't needed. Lets the Receive page render even in
 * view-only mode (cached pubkeys, no device attached).
 */
import { HDKey } from '@scure/bip32';
import { base58check, bech32 } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2';
import { ripemd160 } from '@noble/hashes/legacy';

const bs58check = base58check(sha256);

interface CoinParams {
  p2pkhVersion: number;
  p2shVersion: number;
  bech32Hrp?: string;
  cashaddrPrefix?: string;
}

// Keyed by the `chain` portion of the bip122 networkId (block hash of genesis).
const COIN_BY_GENESIS: Record<string, CoinParams> = {
  // Bitcoin
  '000000000019d6689c085ae165831e93': { p2pkhVersion: 0x00, p2shVersion: 0x05, bech32Hrp: 'bc' },
  // Bitcoin Cash
  '000000000000000000651ef99cb9fcbe': { p2pkhVersion: 0x00, p2shVersion: 0x05, cashaddrPrefix: 'bitcoincash' },
  // Litecoin
  '12a765e31ffd4059bada1e25190f6e98': { p2pkhVersion: 0x30, p2shVersion: 0x32, bech32Hrp: 'ltc' },
  // Dogecoin
  '00000000001a91e3dace36e2be3bf030': { p2pkhVersion: 0x1e, p2shVersion: 0x16 },
  // Dash
  '000007d91d1254d60e2dd1ae58038307': { p2pkhVersion: 0x4c, p2shVersion: 0x10 },
};

function paramsForNetwork(networkId: string): CoinParams {
  // bip122:<genesis>/slip44:<n>
  const m = /^bip122:([0-9a-f]+)/i.exec(networkId);
  const genesis = m?.[1];
  const params = genesis ? COIN_BY_GENESIS[genesis] : undefined;
  if (!params) throw new Error(`Unsupported UTXO networkId: ${networkId}`);
  return params;
}

function hash160(pubkey: Uint8Array): Uint8Array {
  return ripemd160(sha256(pubkey));
}

// @scure/bip32 only parses the canonical xpub version (0x0488B21E). Vault
// returns ypub/zpub/Ltub/Mtub for BIP49/84 paths — same payload, different
// version bytes. Rewrite to xpub bytes so HDKey can parse, then derive.
const XPUB_VERSION = Uint8Array.from([0x04, 0x88, 0xb2, 0x1e]);

function normalizeToXpub(extKey: string): string {
  const decoded = bs58check.decode(extKey);
  if (decoded.length !== 78) throw new Error(`Invalid extended key length: ${decoded.length}`);
  decoded.set(XPUB_VERSION, 0);
  return bs58check.encode(decoded);
}

function deriveReceiveChildPubkey(extKey: string): Uint8Array {
  const hd = HDKey.fromExtendedKey(normalizeToXpub(extKey));
  const child = hd.derive('m/0/0');
  if (!child.publicKey) throw new Error('Derivation produced no public key');
  return child.publicKey;
}

function encodeP2PKH(pubkey: Uint8Array, version: number): string {
  const payload = new Uint8Array(21);
  payload[0] = version;
  payload.set(hash160(pubkey), 1);
  return bs58check.encode(payload);
}

function encodeP2SHP2WPKH(pubkey: Uint8Array, p2shVersion: number): string {
  // redeemScript = OP_0 <0x14> <hash160(pubkey)>
  const h = hash160(pubkey);
  const redeem = new Uint8Array(22);
  redeem[0] = 0x00;
  redeem[1] = 0x14;
  redeem.set(h, 2);
  const payload = new Uint8Array(21);
  payload[0] = p2shVersion;
  payload.set(hash160(redeem), 1);
  return bs58check.encode(payload);
}

function encodeP2WPKH(pubkey: Uint8Array, hrp: string): string {
  const program = hash160(pubkey);
  const words = bech32.toWords(program);
  return bech32.encode(hrp, [0, ...words], 90);
}

// CashAddr — BCH's bech32-variant address format.
// Spec: https://github.com/bitcoincashorg/bitcoincash.org/blob/master/spec/cashaddr.md
const CASHADDR_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const CASHADDR_GENERATORS: bigint[] = [
  BigInt('0x98f2bc8e61'),
  BigInt('0x79b76d99e2'),
  BigInt('0xf33e5fb3c4'),
  BigInt('0xae2eabe2a8'),
  BigInt('0x1e4f43e470'),
];

const ONE = BigInt(1);
const SHIFT_5 = BigInt(5);
const SHIFT_35 = BigInt(35);
const MASK_35 = BigInt('0x07ffffffff');

function cashaddrPolymod(values: number[]): bigint {
  let chk = ONE;
  for (const v of values) {
    const top = chk >> SHIFT_35;
    chk = ((chk & MASK_35) << SHIFT_5) ^ BigInt(v);
    for (let i = 0; i < 5; i++) {
      if (((top >> BigInt(i)) & ONE) === ONE) chk ^= CASHADDR_GENERATORS[i];
    }
  }
  return chk ^ ONE;
}

function cashaddrPrefixToValues(prefix: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < prefix.length; i++) out.push(prefix.charCodeAt(i) & 0x1f);
  return out;
}

function cashaddrConvertBits(data: Uint8Array | number[], from: number, to: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;
  for (const value of data) {
    if (value < 0 || value >> from !== 0) throw new Error('Invalid value for convertBits');
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad && bits > 0) out.push((acc << (to - bits)) & maxv);
  return out;
}

function encodeCashAddr(pubkey: Uint8Array, prefix: string): string {
  const h = hash160(pubkey);
  // P2KH = type 0; size bits for 20-byte hash = 0
  const versionByte = (0 << 3) | 0;
  const payload = [versionByte, ...h];
  const data = cashaddrConvertBits(payload, 8, 5, true);
  const checksumValues = [...cashaddrPrefixToValues(prefix), 0, ...data, 0, 0, 0, 0, 0, 0, 0, 0];
  const checksum = cashaddrPolymod(checksumValues);
  const checksumChars: number[] = [];
  const MASK_5 = BigInt(0x1f);
  for (let i = 0; i < 8; i++) {
    checksumChars.push(Number((checksum >> BigInt(5 * (7 - i))) & MASK_5));
  }
  let body = '';
  for (const v of [...data, ...checksumChars]) body += CASHADDR_CHARSET[v];
  return `${prefix}:${body}`;
}

export interface DeriveArgs {
  xpub: string;
  scriptType?: string;
  networkId: string;
}

export function deriveUtxoAddress({ xpub, scriptType, networkId }: DeriveArgs): string {
  const params = paramsForNetwork(networkId);
  const pubkey = deriveReceiveChildPubkey(xpub);

  // BCH always returns cashaddr — keepkey firmware does the same, and a
  // base58 "1..." legacy BCH address looks like a BTC address to users.
  if (params.cashaddrPrefix) {
    return encodeCashAddr(pubkey, params.cashaddrPrefix);
  }

  const st = (scriptType || 'p2pkh').toLowerCase();
  switch (st) {
    case 'p2pkh':
      return encodeP2PKH(pubkey, params.p2pkhVersion);
    case 'p2sh-p2wpkh':
      return encodeP2SHP2WPKH(pubkey, params.p2shVersion);
    case 'p2wpkh': {
      if (!params.bech32Hrp) throw new Error(`No bech32 HRP for network ${networkId}`);
      return encodeP2WPKH(pubkey, params.bech32Hrp);
    }
    default:
      throw new Error(`Unsupported script type: ${scriptType}`);
  }
}
