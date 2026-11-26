/**
 * Local Hive signing for the CLIENT posting key: Graphene serialization of the
 * posting-tier operations + secp256k1 over sha256(chain_id ‖ tx).
 *
 * Hard rule: the client key only ever signs posting authority. Any operation
 * that needs active or owner — or posting ops acting for another account — is
 * refused here, in the signer itself, not just in the UI.
 *
 * Serialization is checked against hived's own get_transaction_hex output
 * (hiveTx.test.ts). Assets use the chain's legacy wire symbols: HIVE is
 * written "STEEM", HBD "SBD" (the vault learned this the hard way).
 */
import { SigningKey, hexlify } from 'ethers';
import { sha256 } from '@noble/hashes/sha256';
import { privateKeyToPublicKey } from './hiveKeys';

export const HIVE_CHAIN_ID_HEX = 'beeab0de00000000000000000000000000000000000000000000000000000000';

export type HiveOp = [string, Record<string, any>];
export type HiveTxHeader = { refBlockNum: number; refBlockPrefix: number; expirationUnix: number };

/** Operations the client key may sign: all need only posting authority. */
export const CLIENT_POSTING_OPS = new Set([
  'vote',
  'comment',
  'comment_options',
  'custom_json',
  'delete_comment',
  'claim_reward_balance',
]);

const OP_ID: Record<string, number> = {
  vote: 0,
  comment: 1,
  delete_comment: 17,
  custom_json: 18,
  comment_options: 19,
  claim_reward_balance: 39,
};

class Writer {
  private parts: number[] = [];
  bytes(b: Uint8Array) {
    for (const x of b) this.parts.push(x);
  }
  u8(n: number) {
    this.parts.push(n & 0xff);
  }
  u16(n: number) {
    if (!Number.isInteger(n) || n < 0 || n > 0xffff) throw new Error(`uint16 out of range: ${n}`);
    this.u8(n);
    this.u8(n >>> 8);
  }
  i16(n: number) {
    if (!Number.isInteger(n) || n < -32768 || n > 32767) throw new Error(`int16 out of range: ${n}`);
    this.u16(n & 0xffff);
  }
  u32(n: number) {
    if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new Error(`uint32 out of range: ${n}`);
    for (let i = 0; i < 4; i++) this.u8(Math.floor(n / 2 ** (8 * i)));
  }
  i64(v: bigint) {
    let x = BigInt.asUintN(64, v);
    for (let i = 0; i < 8; i++) {
      this.u8(Number(x & 0xffn));
      x >>= 8n;
    }
  }
  varint(n: number) {
    if (!Number.isInteger(n) || n < 0) throw new Error(`varint out of range: ${n}`);
    do {
      let b = n & 0x7f;
      n = Math.floor(n / 128);
      if (n > 0) b |= 0x80;
      this.u8(b);
    } while (n > 0);
  }
  str(s: unknown) {
    if (typeof s !== 'string') throw new Error('expected a string');
    const b = new TextEncoder().encode(s);
    this.varint(b.length);
    this.bytes(b);
  }
  bool(v: unknown) {
    if (typeof v !== 'boolean') throw new Error('expected a boolean');
    this.u8(v ? 1 : 0);
  }
  asset(s: unknown) {
    const m = /^(-?\d+)(?:\.(\d+))? (HIVE|HBD|VESTS)$/.exec(String(s));
    if (!m) throw new Error(`malformed asset "${s}"`);
    const precision = m[3] === 'VESTS' ? 6 : 3;
    const frac = m[2] ?? '';
    if (frac.length !== precision) throw new Error(`${m[3]} needs ${precision} decimals ("${s}")`);
    this.i64(BigInt(m[1] + frac));
    this.u8(precision);
    const wire = m[3] === 'HIVE' ? 'STEEM' : m[3] === 'HBD' ? 'SBD' : 'VESTS';
    const sym = new Uint8Array(7);
    sym.set(new TextEncoder().encode(wire));
    this.bytes(sym);
  }
  out() {
    return Uint8Array.from(this.parts);
  }
}

function writeOp(w: Writer, [name, p]: HiveOp) {
  const id = OP_ID[name];
  if (id === undefined) throw new Error(`Operation "${name}" is not a posting operation`);
  w.varint(id);
  switch (name) {
    case 'vote':
      w.str(p.voter);
      w.str(p.author);
      w.str(p.permlink);
      w.i16(Number(p.weight));
      return;
    case 'comment':
      w.str(p.parent_author ?? '');
      w.str(p.parent_permlink);
      w.str(p.author);
      w.str(p.permlink);
      w.str(p.title ?? '');
      w.str(p.body ?? '');
      w.str(typeof p.json_metadata === 'string' ? p.json_metadata : JSON.stringify(p.json_metadata ?? {}));
      return;
    case 'delete_comment':
      w.str(p.author);
      w.str(p.permlink);
      return;
    case 'custom_json': {
      const list = (a: unknown) => {
        const arr = Array.isArray(a) ? a : [];
        w.varint(arr.length);
        arr.forEach(x => w.str(x));
      };
      list(p.required_auths);
      list(p.required_posting_auths);
      w.str(p.id);
      w.str(typeof p.json === 'string' ? p.json : JSON.stringify(p.json ?? {}));
      return;
    }
    case 'comment_options': {
      w.str(p.author);
      w.str(p.permlink);
      w.asset(p.max_accepted_payout ?? '1000000.000 HBD');
      w.u16(Number(p.percent_hbd ?? p.percent_steem_dollars ?? 10000));
      w.bool(p.allow_votes ?? true);
      w.bool(p.allow_curation_rewards ?? true);
      const exts: any[] = Array.isArray(p.extensions) ? p.extensions : [];
      w.varint(exts.length);
      for (const ext of exts) {
        if (!Array.isArray(ext) || ext[0] !== 0)
          throw new Error('comment_options: only beneficiaries extensions are supported');
        const bens: any[] = ext[1]?.beneficiaries ?? [];
        w.varint(0);
        w.varint(bens.length);
        for (const b of bens) {
          w.str(b.account);
          w.u16(Number(b.weight));
        }
      }
      return;
    }
    case 'claim_reward_balance':
      w.str(p.account);
      w.asset(p.reward_hive);
      w.asset(p.reward_hbd);
      w.asset(p.reward_vests);
      return;
  }
}

/** Unsigned transaction bytes: the digest preimage (without chain id). */
export function serializeHiveTx(header: HiveTxHeader, ops: HiveOp[]): Uint8Array {
  const w = new Writer();
  w.u16(header.refBlockNum);
  w.u32(header.refBlockPrefix);
  w.u32(header.expirationUnix);
  w.varint(ops.length);
  ops.forEach(op => writeOp(w, op));
  w.varint(0); // extensions
  return w.out();
}

export function hiveTxDigest(txBytes: Uint8Array, chainIdHex = HIVE_CHAIN_ID_HEX): Uint8Array {
  const chain = Uint8Array.from(chainIdHex.match(/../g)!.map(h => parseInt(h, 16)));
  const pre = new Uint8Array(chain.length + txBytes.length);
  pre.set(chain);
  pre.set(txBytes, chain.length);
  return sha256(pre);
}

/**
 * Refuse anything the client key must not sign: non-posting ops, custom_json
 * with active auths, and posting ops acting for an account other than `account`.
 */
export function assertClientCanSign(ops: HiveOp[], account: string): void {
  if (!ops.length) throw new Error('No operations to sign');
  for (const [name, p] of ops) {
    if (!CLIENT_POSTING_OPS.has(name)) {
      throw new Error(`The browser posting key never signs "${name}" — it needs the KeepKey`);
    }
    const actors =
      name === 'vote'
        ? [p.voter]
        : name === 'custom_json'
          ? (p.required_posting_auths ?? [])
          : name === 'claim_reward_balance'
            ? [p.account]
            : [p.author];
    if (name === 'custom_json' && Array.isArray(p.required_auths) && p.required_auths.length > 0) {
      throw new Error('This custom_json needs the active key — the browser posting key never signs it');
    }
    if (!actors.length || actors.some((a: unknown) => a !== account)) {
      throw new Error(`The browser key for @${account} can only act as @${account}`);
    }
  }
}

/** Graphene canonical signature: r and s minimal-length positive (dhive/hived rule). */
export function isCanonicalSignature(sig65: Uint8Array): boolean {
  return (
    !(sig65[1] & 0x80) &&
    !(sig65[1] === 0 && !(sig65[2] & 0x80)) &&
    !(sig65[33] & 0x80) &&
    !(sig65[33] === 0 && !(sig65[34] & 0x80))
  );
}

export type SignedHiveTx = {
  refBlockNum: number;
  refBlockPrefix: number;
  expirationUnix: number;
  /** Hive time string, e.g. "2021-01-14T02:23:28". */
  expiration: string;
  operations: HiveOp[];
  signature: string; // hex, 65 bytes
  digest: string; // hex
};

export const hiveTimeIso = (unix: number) => new Date(unix * 1000).toISOString().replace(/\.\d{3}Z$/, '');

/**
 * Sign posting operations with the client key. RFC 6979 signatures are
 * deterministic, so a non-canonical one is retried by moving the expiration
 * one second forward (a different digest) rather than by custom nonces.
 */
export function signHiveTxWithClientKey(
  header: HiveTxHeader,
  ops: HiveOp[],
  account: string,
  priv: Uint8Array,
  chainIdHex = HIVE_CHAIN_ID_HEX,
): SignedHiveTx {
  assertClientCanSign(ops, account);
  const key = new SigningKey(hexlify(priv));
  const pub = hexlify(privateKeyToPublicKey(priv));
  for (let bump = 0; bump < 32; bump++) {
    const expirationUnix = header.expirationUnix + bump;
    const digest = hiveTxDigest(serializeHiveTx({ ...header, expirationUnix }, ops), chainIdHex);
    const sig = key.sign(digest);
    const recId = sig.v - 27;
    const sig65 = new Uint8Array(65);
    sig65[0] = 27 + 4 + recId;
    sig65.set(
      Uint8Array.from(
        sig.r
          .slice(2)
          .match(/../g)!
          .map(h => parseInt(h, 16)),
      ),
      1,
    );
    sig65.set(
      Uint8Array.from(
        sig.s
          .slice(2)
          .match(/../g)!
          .map(h => parseInt(h, 16)),
      ),
      33,
    );
    if (!isCanonicalSignature(sig65)) continue;
    // Self-check: the signature must recover to this key.
    if (SigningKey.recoverPublicKey(digest, sig) !== SigningKey.computePublicKey(pub, false)) {
      throw new Error('Signature self-check failed');
    }
    return {
      refBlockNum: header.refBlockNum,
      refBlockPrefix: header.refBlockPrefix,
      expirationUnix,
      expiration: hiveTimeIso(expirationUnix),
      operations: ops,
      signature: hexlify(sig65).slice(2),
      digest: hexlify(digest).slice(2),
    };
  }
  throw new Error('Could not produce a canonical signature');
}
