/**
 * The approval card's only readable view of a Solana transaction before the
 * device (which shows nothing but "Sign unverified Solana transaction?" for an
 * app program). A wrong decode here misleads the user, so every branch is
 * pinned — including a real dApp transaction captured live (SoltoshiDICE
 * blackjack "Approve & take seat": 0.002 SOL to a session key + an opaque
 * program call that grants a SDICE allowance).
 */
import { describe, it, expect } from 'vitest';
import { base58, lamportsToSol, summarizeSolanaTx } from './solanaTxSummary';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const unb58 = (s: string): Uint8Array => {
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt(B58.indexOf(c));
  const out: number[] = [];
  while (n > 0n) {
    out.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const c of s) {
    if (c !== '1') break;
    out.unshift(0);
  }
  while (out.length < 32) out.unshift(0);
  return Uint8Array.from(out);
};
const u32 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
const u64 = (v: bigint) => Array.from({ length: 8 }, (_, i) => Number((v >> BigInt(8 * i)) & 0xffn));

const ME = 'Gu83nVMD8qh948D1vqe8UPoUHaFuSwcHrvNHetcM4Xux';
const OTHER = 'BqtZ8PRQywD9Z5xXeB5112wtPG3xtj7TqF56hroicGjX';
const SYSTEM = '11111111111111111111111111111111';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const CB = 'ComputeBudget111111111111111111111111111111';
const APP = 'CuTLp7pDmNGkFgi4aoh8Ef1YSjc2BzECQRLzYqaoVWBR';

/** Minimal wire-format builder: 1 signer, given keys, instructions [programIdx, accountIdxs, data]. */
function tx(keys: string[], ixs: Array<[number, number[], number[]]>, opts: { v0?: boolean; luts?: number } = {}) {
  const b: number[] = [1, ...new Array(64).fill(0)];
  if (opts.v0) b.push(0x80);
  b.push(1, 0, keys.length - 1 > 0 ? 1 : 0, keys.length);
  for (const k of keys) b.push(...unb58(k));
  b.push(...new Array(32).fill(7));
  b.push(ixs.length);
  for (const [p, a, d] of ixs) b.push(p, a.length, ...a, d.length, ...d);
  if (opts.v0) {
    b.push(opts.luts ?? 0);
    for (let i = 0; i < (opts.luts ?? 0); i++) b.push(...unb58(OTHER), 1, 5, 0);
  }
  return Uint8Array.from(b);
}

describe('summarizeSolanaTx', () => {
  it('decodes the live SoltoshiDICE sit-down: SOL to the session key + opaque app code', () => {
    const raw = Uint8Array.from(
      Buffer.from(
        '01000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100060dec3979a4dc6b401bd045171a189f26856fab9eab75560214f972b2edc164300f209892e406a5c1bf530d7721f4634090040c3fbe35df3834a2e80d97bee0620e635230d0ec6d2689ed9f0bf1da57e147ac13babc4430c5af1ade2e40c9cf3ee577e4b4511f351e94a764bde876019ec3523510049d3b50b3a8c70fd38b6007f9847d3c28e2cbbff9e7c4f7cb6d6d71e5bc16d50aa6ed4ffe3aeae6a0d6c6eaa4a11b0a513ec5310074c9de56117aad169ab339ec9a544b3c4cf33a74d0cc37c6fc4da258d76a62aa6a0c641d34cefc33c97f0b9424c1678e26ee25b4c49b7bda000000000000000000000000000000000000000000000000000000000000000038278241da03c70dd0fc885f7ad2123bad32b33a5402340739af8ae5d84cacef8b673cda2e293e0220ab3e01d2b58ed055c9c1b2762dd515612b10cacd6e34360306466fe5211732ffecadba72c39be7bc8ce5bbc5f7126b2c439b3a40000000b0e08af4a4fcfad13ef8fcfd9dc70975eb6fc2e04a7c76611540a51cd5db9ed006ddf6e1ee758fde18425dbce46ccddab61afc4d83b90d27febdf928d8a18bfcf9adfb23cba734d5c630dc94ffe9bc6964e347bd3af8c3afb795b849cab5d927030a000502400d0300070200050c0200000080841e00000000000b090002040803010c060952515600000000000000d4030000000000000100ca9a3b00000000a11b0a513ec5310074c9de56117aad169ab339ec9a544b3c4cf33a74d0cc37c6100e00000000000000ca9a3b0000000000ca9a3b00000000',
        'hex',
      ),
    );
    const s = summarizeSolanaTx(raw, ME);
    expect(s.version).toBe('legacy');
    expect(s.feePayer).toBe(ME);
    expect(s.instructions.map(i => i.title)).toEqual(['Set compute limit', 'Send SOL', 'App code KeepKey can’t read']);
    expect(s.instructions[1].fields).toContainEqual({ label: 'Amount', value: '0.002 SOL' });
    expect(s.instructions[1].fields).toContainEqual({ label: 'To', value: OTHER });
    expect(s.instructions[2].program).toBe(APP);
    expect(s.solOutLamports).toBe('2000000');
    expect(s.warnings[0].code).toBe('UNKNOWN_PROGRAM');
    expect(s.warnings[0].severity).toBe('danger');
    expect(s.warnings[0].text).toContain(APP);
  });

  it('counts only SOL leaving the signer', () => {
    const s = summarizeSolanaTx(
      tx(
        [ME, OTHER, SYSTEM],
        [
          [2, [0, 1], [...u32(2), ...u64(1_500_000_000n)]],
          [2, [1, 0], [...u32(2), ...u64(9n)]],
        ],
      ),
      ME,
    );
    expect(s.solOutLamports).toBe('1500000000');
    expect(s.warnings).toEqual([]);
  });

  it('flags a token delegate approval as danger, amount in base units (decimals never guessed)', () => {
    const s = summarizeSolanaTx(tx([ME, OTHER, TOKEN], [[2, [1, 1, 0], [4, ...u64(1_000_000_000n)]]]), ME);
    expect(s.instructions[0].title).toBe('Approve token spender');
    expect(s.instructions[0].fields).toContainEqual({ label: 'Up to', value: '1000000000 (base units)' });
    expect(s.warnings.map(w => w.code)).toEqual(['TOKEN_DELEGATE']);
  });

  it('uses the decimals a checked instruction carries', () => {
    const s = summarizeSolanaTx(tx([ME, OTHER, TOKEN], [[2, [1, 1, 1, 0], [12, ...u64(2500n), 6]]]), ME);
    expect(s.instructions[0].fields[0]).toEqual({ label: 'Amount', value: '2500 (6 decimals)' });
  });

  it('computes the priority fee ceiling from limit × price', () => {
    const s = summarizeSolanaTx(
      tx(
        [ME, CB],
        [
          [1, [], [2, ...u32(200_000)]],
          [1, [], [3, ...u64(5_000n)]],
        ],
      ),
      ME,
    );
    expect(s.priorityFeeLamports).toBe('1000'); // 200k units × 5000 µ-lamports = 1000 lamports
  });

  it('labels lookup-table accounts and warns about v0 lookup tables', () => {
    const s = summarizeSolanaTx(tx([ME, SYSTEM], [[1, [0, 2], [...u32(2), ...u64(1n)]]], { v0: true, luts: 1 }), ME);
    expect(s.version).toBe('v0');
    expect(s.instructions[0].fields).toContainEqual({ label: 'To', value: 'lookup-table account #1' });
    expect(s.warnings.map(w => w.code)).toContain('LOOKUP_TABLES');
  });

  it('warns when the wallet is not a signer', () => {
    const s = summarizeSolanaTx(tx([OTHER, SYSTEM], []), ME);
    expect(s.warnings.map(w => w.code)).toEqual(['NOT_SIGNER']);
  });

  it('throws on a truncated transaction instead of guessing', () => {
    expect(() => summarizeSolanaTx(Uint8Array.from([1, 0, 0]), ME)).toThrow(/truncated/);
  });

  it('is JSON-safe (stored in chrome.storage)', () => {
    const raw = Uint8Array.from(
      Buffer.from(
        '01000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100060dec3979a4dc6b401bd045171a189f26856fab9eab75560214f972b2edc164300f209892e406a5c1bf530d7721f4634090040c3fbe35df3834a2e80d97bee0620e635230d0ec6d2689ed9f0bf1da57e147ac13babc4430c5af1ade2e40c9cf3ee577e4b4511f351e94a764bde876019ec3523510049d3b50b3a8c70fd38b6007f9847d3c28e2cbbff9e7c4f7cb6d6d71e5bc16d50aa6ed4ffe3aeae6a0d6c6eaa4a11b0a513ec5310074c9de56117aad169ab339ec9a544b3c4cf33a74d0cc37c6fc4da258d76a62aa6a0c641d34cefc33c97f0b9424c1678e26ee25b4c49b7bda000000000000000000000000000000000000000000000000000000000000000038278241da03c70dd0fc885f7ad2123bad32b33a5402340739af8ae5d84cacef8b673cda2e293e0220ab3e01d2b58ed055c9c1b2762dd515612b10cacd6e34360306466fe5211732ffecadba72c39be7bc8ce5bbc5f7126b2c439b3a40000000b0e08af4a4fcfad13ef8fcfd9dc70975eb6fc2e04a7c76611540a51cd5db9ed006ddf6e1ee758fde18425dbce46ccddab61afc4d83b90d27febdf928d8a18bfcf9adfb23cba734d5c630dc94ffe9bc6964e347bd3af8c3afb795b849cab5d927030a000502400d0300070200050c0200000080841e00000000000b090002040803010c060952515600000000000000d4030000000000000100ca9a3b00000000a11b0a513ec5310074c9de56117aad169ab339ec9a544b3c4cf33a74d0cc37c6100e00000000000000ca9a3b0000000000ca9a3b00000000',
        'hex',
      ),
    );
    const s = summarizeSolanaTx(raw, ME);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('base58 / lamports helpers', () => {
    expect(base58(unb58(ME))).toBe(ME);
    expect(base58(new Uint8Array(32))).toBe(SYSTEM);
    expect(lamportsToSol(2_000_000n)).toBe('0.002');
    expect(lamportsToSol(1_000_000_000n)).toBe('1');
  });
});
