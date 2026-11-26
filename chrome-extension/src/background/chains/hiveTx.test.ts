/**
 * Client posting key: key formats and local Graphene signing.
 *
 * Serialization vectors are hived's own output (condenser_api.get_transaction_hex
 * on api.hive.blog, 2026-11-26, header ref 4660 / 0xdeadbeef / 2021-01-14T02:23:28).
 * get_transaction_hex ends with the signatures count; the digest preimage
 * stops before it, so the trailing "00" is dropped.
 */
import { describe, expect, it } from 'vitest';
import { SigningKey, hexlify } from 'ethers';
import {
  compareStmKeys,
  generatePrivateKey,
  isValidStm,
  privateKeyToStm,
  privateKeyToWif,
  stmToPublicKey,
  wifToPrivateKey,
  privateKeyToPublicKey,
} from './hiveKeys';
import {
  assertClientCanSign,
  hiveTxDigest,
  isCanonicalSignature,
  serializeHiveTx,
  signHiveTxWithClientKey,
  type HiveOp,
} from './hiveTx';

const HEADER = {
  refBlockNum: 4660,
  refBlockPrefix: 0xdeadbeef,
  expirationUnix: Date.UTC(2021, 0, 14, 2, 23, 28) / 1000,
};
const golden = (hex: string) => hex.slice(0, -2);

const GOLDEN: Record<string, { ops: HiveOp[]; hex: string }> = {
  vote: {
    ops: [['vote', { voter: 'alice', author: 'bob', permlink: 'a-post', weight: -2500 }]],
    hex: '3412efbeadde20abff5f010005616c69636503626f6206612d706f73743cf60000',
  },
  comment: {
    ops: [
      [
        'comment',
        {
          parent_author: 'peak.snaps',
          parent_permlink: 'snap-container',
          author: 'alice',
          permlink: 're-peaksnaps-tp48oc',
          title: '',
          body: 'gm 🔑 ünïcode',
          json_metadata: '{"app":"peakd/2026.11.4","tags":["snaps"]}',
        },
      ],
    ],
    hex: '3412efbeadde20abff5f01010a7065616b2e736e6170730e736e61702d636f6e7461696e657205616c6963651372652d7065616b736e6170732d747034386f630011676d20f09f949120c3bc6ec3af636f64652a7b22617070223a227065616b642f323032362e31312e34222c2274616773223a5b22736e617073225d7d0000',
  },
  postWithOptions: {
    ops: [
      [
        'comment',
        {
          parent_author: '',
          parent_permlink: 'hive-163772',
          author: 'alice',
          permlink: 'hello',
          title: 'Hello',
          body: 'Body',
          json_metadata: '{}',
        },
      ],
      [
        'comment_options',
        {
          author: 'alice',
          permlink: 'hello',
          max_accepted_payout: '1000000.000 HBD',
          percent_hbd: 0,
          allow_votes: true,
          allow_curation_rewards: false,
          extensions: [
            [
              0,
              {
                beneficiaries: [
                  { account: 'keepkey', weight: 500 },
                  { account: 'peakd', weight: 300 },
                ],
              },
            ],
          ],
        },
      ],
    ],
    hex: '3412efbeadde20abff5f0201000b686976652d31363337373205616c6963650568656c6c6f0548656c6c6f04426f6479027b7d1305616c6963650568656c6c6f00ca9a3b00000000035342440000000000000100010002076b6565706b6579f401057065616b642c010000',
  },
  customJson: {
    ops: [
      [
        'custom_json',
        {
          required_auths: [],
          required_posting_auths: ['alice'],
          id: 'follow',
          json: '["follow",{"follower":"alice","following":"bob","what":["blog"]}]',
        },
      ],
    ],
    hex: '3412efbeadde20abff5f0112000105616c69636506666f6c6c6f77415b22666f6c6c6f77222c7b22666f6c6c6f776572223a22616c696365222c22666f6c6c6f77696e67223a22626f62222c2277686174223a5b22626c6f67225d7d5d0000',
  },
  deleteComment: {
    ops: [['delete_comment', { author: 'alice', permlink: 'hello' }]],
    hex: '3412efbeadde20abff5f011105616c6963650568656c6c6f0000',
  },
  claim: {
    ops: [
      [
        'claim_reward_balance',
        { account: 'alice', reward_hive: '1.000 HIVE', reward_hbd: '2.000 HBD', reward_vests: '3.000000 VESTS' },
      ],
    ],
    hex: '3412efbeadde20abff5f012705616c696365e80300000000000003535445454d0000d0070000000000000353424400000000c0c62d000000000006564553545300000000',
  },
};

describe('hiveKeys', () => {
  // Classic WIF vector (same format on Hive and Bitcoin).
  const PRIV = '0c28fca386c7a227600b2fe50b7cae11ec86d3bf1fbe471be89827e19d72aa1d';
  const WIF = '5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ';
  const bytes = (h: string) => Uint8Array.from(h.match(/../g)!.map(x => parseInt(x, 16)));

  it('WIF round-trips the reference vector', () => {
    expect(privateKeyToWif(bytes(PRIV))).toBe(WIF);
    expect(hexlify(wifToPrivateKey(WIF)).slice(2)).toBe(PRIV);
  });

  it('public key matches the known point; STM round-trips with checksum', () => {
    expect(hexlify(privateKeyToPublicKey(bytes(PRIV))).slice(2)).toBe(
      '02d0de0aaeaefad02b8bdc8a01a1b8b11c696bd3d66a2c5f10780d95b7df42645c',
    );
    const stm = privateKeyToStm(bytes(PRIV));
    expect(stm.startsWith('STM')).toBe(true);
    expect(hexlify(stmToPublicKey(stm)).slice(2)).toBe(
      '02d0de0aaeaefad02b8bdc8a01a1b8b11c696bd3d66a2c5f10780d95b7df42645c',
    );
    expect(isValidStm(stm)).toBe(true);
    expect(isValidStm(stm.slice(0, -1) + (stm.endsWith('1') ? '2' : '1'))).toBe(false);
  });

  it('rejects a WIF with a bad checksum or a non-WIF string', () => {
    expect(() => wifToPrivateKey(WIF.slice(0, -1) + (WIF.endsWith('J') ? 'K' : 'J'))).toThrow();
    expect(() => wifToPrivateKey('STM5abc')).toThrow('Not a Hive private key (WIF)');
  });

  it('generates valid keys from the CSPRNG, retrying out-of-range draws', () => {
    const k = generatePrivateKey();
    expect(k.length).toBe(32);
    expect(wifToPrivateKey(privateKeyToWif(k))).toEqual(k);
    let calls = 0;
    const rnd = (n: number) => (calls++ === 0 ? new Uint8Array(n) : new Uint8Array(n).fill(7));
    expect(generatePrivateKey(rnd)).toEqual(new Uint8Array(32).fill(7));
  });

  it('orders keys by compressed bytes', () => {
    const a = privateKeyToStm(new Uint8Array(32).fill(1));
    const b = privateKeyToStm(new Uint8Array(32).fill(2));
    const order = compareStmKeys(a, b);
    const pa = stmToPublicKey(a);
    const pb = stmToPublicKey(b);
    const byBytes = pa.findIndex((v, i) => v !== pb[i]);
    expect(Math.sign(order)).toBe(Math.sign(pa[byBytes] - pb[byBytes]));
  });
});

describe('serializeHiveTx matches hived byte for byte', () => {
  for (const [name, { ops, hex }] of Object.entries(GOLDEN)) {
    it(name, () => {
      expect(hexlify(serializeHiveTx(HEADER, ops)).slice(2)).toBe(golden(hex));
    });
  }

  it('a long peakd post (3167 bytes, over the KeepKey limit) serializes fine for the client key', () => {
    const body = 'x'.repeat(3100);
    const bytes = serializeHiveTx(HEADER, [['comment', { ...GOLDEN.postWithOptions.ops[0][1], body }]]);
    expect(bytes.length).toBeGreaterThan(3100);
  });
});

describe('signHiveTxWithClientKey', () => {
  const priv = new Uint8Array(32).fill(9);
  const pubUncompressed = SigningKey.computePublicKey(hexlify(priv), false);

  it('produces a canonical signature that recovers to the client key over sha256(chain_id ‖ tx)', () => {
    const ops = GOLDEN.vote.ops.map(([n, p]) => [n, { ...p, voter: 'sopadevs' }]) as HiveOp[];
    const signed = signHiveTxWithClientKey(HEADER, ops, 'sopadevs', priv);
    const sig = Uint8Array.from(signed.signature.match(/../g)!.map(h => parseInt(h, 16)));
    expect(sig.length).toBe(65);
    expect(sig[0] >= 31 && sig[0] <= 34).toBe(true);
    expect(isCanonicalSignature(sig)).toBe(true);
    const digest = hiveTxDigest(serializeHiveTx({ ...HEADER, expirationUnix: signed.expirationUnix }, ops));
    expect(signed.digest).toBe(hexlify(digest).slice(2));
    const recovered = SigningKey.recoverPublicKey(digest, {
      r: '0x' + signed.signature.slice(2, 66),
      s: '0x' + signed.signature.slice(66, 130),
      v: sig[0] - 4,
    });
    expect(recovered).toBe(pubUncompressed);
    expect(signed.expirationUnix - HEADER.expirationUnix).toBeLessThan(32);
    expect(signed.expiration).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/);
  });

  it('canonical across many keys (retry by expiration bump)', () => {
    for (let i = 1; i <= 20; i++) {
      const k = new Uint8Array(32).fill(i);
      const ops: HiveOp[] = [['vote', { voter: 'a-b', author: 'x', permlink: `p${i}`, weight: 10000 }]];
      const s = signHiveTxWithClientKey(HEADER, ops, 'a-b', k);
      expect(isCanonicalSignature(Uint8Array.from(s.signature.match(/../g)!.map(h => parseInt(h, 16))))).toBe(true);
    }
  });
});

describe('the client key NEVER signs active/owner operations', () => {
  const priv = new Uint8Array(32).fill(9);
  const refuse = (ops: HiveOp[], account = 'sopadevs') =>
    expect(() => signHiveTxWithClientKey(HEADER, ops, account, priv)).toThrow();

  it('refuses transfers, power ups, delegations, authority changes, savings, orders', () => {
    refuse([['transfer', { from: 'sopadevs', to: 'x', amount: '1.000 HIVE', memo: '' }]]);
    refuse([['transfer_to_vesting', { from: 'sopadevs', to: 'sopadevs', amount: '1.000 HIVE' }]]);
    refuse([['delegate_vesting_shares', { delegator: 'sopadevs', delegatee: 'x', vesting_shares: '1.000000 VESTS' }]]);
    refuse([['account_update', { account: 'sopadevs' }]]);
    refuse([['account_update2', { account: 'sopadevs', posting_json_metadata: '{}' }]]);
    refuse([['transfer_to_savings', { from: 'sopadevs', to: 'sopadevs', amount: '1.000 HBD', memo: '' }]]);
    refuse([['limit_order_create', { owner: 'sopadevs' }]]);
  });

  it('refuses custom_json with active auths (e.g. Hive Engine transfers)', () => {
    refuse([
      ['custom_json', { required_auths: ['sopadevs'], required_posting_auths: [], id: 'ssc-mainnet-hive', json: '{}' }],
    ]);
  });

  it('refuses a posting op acting for another account, and a mix with an active op', () => {
    refuse([['vote', { voter: 'someone-else', author: 'a', permlink: 'p', weight: 100 }]]);
    refuse([
      [
        'comment',
        {
          parent_author: '',
          parent_permlink: 'x',
          author: 'other',
          permlink: 'p',
          title: '',
          body: '',
          json_metadata: '{}',
        },
      ],
    ]);
    refuse([
      ['vote', { voter: 'sopadevs', author: 'a', permlink: 'p', weight: 100 }],
      ['transfer', { from: 'sopadevs', to: 'x', amount: '1.000 HIVE', memo: '' }],
    ]);
  });

  it('assertClientCanSign passes a pure posting batch for the right account', () => {
    expect(() =>
      assertClientCanSign(
        [
          ['comment', { author: 'sopadevs' }],
          ['comment_options', { author: 'sopadevs' }],
        ],
        'sopadevs',
      ),
    ).not.toThrow();
  });
});
