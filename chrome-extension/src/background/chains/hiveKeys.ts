/**
 * Hive key formats for the client posting key (KEEPKEY: posting key in the
 * client, vault in the KeepKey). Pure — no chrome.*, no network, no logging:
 * nothing here may ever print a private key.
 *
 *   WIF  = base58( 0x80 ‖ priv32 ‖ sha256(sha256(0x80 ‖ priv32))[0..4] )
 *   STM  = "STM" + base58( pub33 ‖ ripemd160(pub33)[0..4] )
 */
import { SigningKey, decodeBase58, encodeBase58, getBytes, hexlify, toBeArray } from 'ethers';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';

const SECP256K1_N = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');

const eqBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** base58 → exactly `len` bytes (leading zero bytes are '1's). */
function base58ToBytes(s: string, len: number): Uint8Array {
  const zeros = s.match(/^1*/)?.[0].length ?? 0;
  const body = toBeArray(decodeBase58(s));
  const out = new Uint8Array(len);
  if (zeros + body.length !== len) throw new Error('Invalid key length');
  out.set(body, len - body.length);
  return out;
}

export function isValidPrivateKey(priv: Uint8Array): boolean {
  if (priv.length !== 32) return false;
  const k = BigInt(hexlify(priv));
  return k > 0n && k < SECP256K1_N;
}

/** A fresh secp256k1 private key from the platform CSPRNG. */
export function generatePrivateKey(
  random: (n: number) => Uint8Array = n => crypto.getRandomValues(new Uint8Array(n)),
): Uint8Array {
  for (let i = 0; i < 16; i++) {
    const k = random(32);
    if (isValidPrivateKey(k)) return k;
  }
  throw new Error('Could not generate a valid key');
}

export function privateKeyToWif(priv: Uint8Array): string {
  if (!isValidPrivateKey(priv)) throw new Error('Invalid private key');
  const payload = new Uint8Array(33);
  payload[0] = 0x80;
  payload.set(priv, 1);
  const check = sha256(sha256(payload)).slice(0, 4);
  const full = new Uint8Array(37);
  full.set(payload);
  full.set(check, 33);
  return encodeBase58(full);
}

/** WIF → private key; throws on a bad checksum, version or length. */
export function wifToPrivateKey(wif: string): Uint8Array {
  const s = String(wif ?? '').trim();
  if (!/^5[1-9A-HJ-NP-Za-km-z]{50}$/.test(s)) throw new Error('Not a Hive private key (WIF)');
  const full = base58ToBytes(s, 37);
  if (full[0] !== 0x80) throw new Error('Not a Hive private key (WIF)');
  const check = sha256(sha256(full.slice(0, 33))).slice(0, 4);
  if (!eqBytes(check, full.slice(33))) throw new Error('Private key checksum does not match');
  const priv = full.slice(1, 33);
  if (!isValidPrivateKey(priv)) throw new Error('Invalid private key');
  return priv;
}

export function publicKeyToStm(pub33: Uint8Array): string {
  if (pub33.length !== 33 || (pub33[0] !== 2 && pub33[0] !== 3)) throw new Error('Invalid public key');
  const full = new Uint8Array(37);
  full.set(pub33);
  full.set(ripemd160(pub33).slice(0, 4), 33);
  return 'STM' + encodeBase58(full);
}

/** STM… → 33-byte compressed public key; throws on a bad checksum. */
export function stmToPublicKey(stm: string): Uint8Array {
  const s = String(stm ?? '').trim();
  if (!/^STM[1-9A-HJ-NP-Za-km-z]{48,52}$/.test(s)) throw new Error('Not a Hive public key');
  const full = base58ToBytes(s.slice(3), 37);
  const pub = full.slice(0, 33);
  if (!eqBytes(ripemd160(pub).slice(0, 4), full.slice(33))) throw new Error('Public key checksum does not match');
  if (pub[0] !== 2 && pub[0] !== 3) throw new Error('Invalid public key');
  return pub;
}

export function privateKeyToPublicKey(priv: Uint8Array): Uint8Array {
  return getBytes(SigningKey.computePublicKey(hexlify(priv), true));
}

export const privateKeyToStm = (priv: Uint8Array) => publicKeyToStm(privateKeyToPublicKey(priv));

export const isValidStm = (stm: string) => {
  try {
    stmToPublicKey(stm);
    return true;
  } catch {
    return false;
  }
};

/** hived orders key_auths by the compressed key bytes, not the STM string. */
export function compareStmKeys(a: string, b: string): number {
  const x = stmToPublicKey(a);
  const y = stmToPublicKey(b);
  for (let i = 0; i < 33; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}
