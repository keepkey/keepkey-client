/**
 * KEEPKEY-192 "ghost approvals": identical in-flight requests share one card,
 * and stored event state (not card state) decides what a reopened panel shows.
 * Replays the sopa.team/vaults sequence from the vault log.
 */
import { describe, expect, it, vi } from 'vitest';
import { canonicalJson, createInflightRequests, requestKey, shouldDedupe } from './inflightRequests';
import {
  approvalPhase,
  failedEventPatch,
  initialApprovalView,
  interruptedEventPatch,
  isRevertError,
  pickPendingEvent,
  revertCardMessage,
  revertMessage,
} from '@extension/shared';

const ORIGIN = 'https://sopa.team';
const TX = { from: '0xb2c4', to: '0xA083', data: '0x6a761202' + 'ab'.repeat(40), value: '0x0', gas: '0x1b9e01' };

describe('request identity', () => {
  it('same origin + method + params (any key order) → same key', () => {
    const a = requestKey(ORIGIN, 'ethereum', 'eth_sendTransaction', [TX]);
    const b = requestKey(ORIGIN, 'ethereum', 'eth_sendTransaction', [
      { gas: TX.gas, value: TX.value, data: TX.data, to: TX.to, from: TX.from },
    ]);
    expect(a).toBe(b);
    expect(canonicalJson({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}');
  });

  it('different origin, method, calldata or nonce → different key', () => {
    const k = requestKey(ORIGIN, 'ethereum', 'eth_sendTransaction', [TX]);
    expect(requestKey('https://evil.example', 'ethereum', 'eth_sendTransaction', [TX])).not.toBe(k);
    expect(requestKey(ORIGIN, 'ethereum', 'eth_signTransaction', [TX])).not.toBe(k);
    expect(requestKey(ORIGIN, 'ethereum', 'eth_sendTransaction', [{ ...TX, data: TX.data + '00' }])).not.toBe(k);
    expect(requestKey(ORIGIN, 'ethereum', 'eth_sendTransaction', [{ ...TX, nonce: '0x4' }])).not.toBe(k);
  });

  it('two personal_sign messages that differ only in their timestamp are NOT deduplicated (the vault log case)', () => {
    const m1 = 'SOPA · cofre de apoio\nEm: 2026-11-26T18:39:55.283Z';
    const m2 = 'SOPA · cofre de apoio\nEm: 2026-11-26T18:42:25.084Z';
    expect(requestKey(ORIGIN, 'ethereum', 'personal_sign', [m1, '0xb2c4'])).not.toBe(
      requestKey(ORIGIN, 'ethereum', 'personal_sign', [m2, '0xb2c4']),
    );
  });

  it('only approval-opening methods are deduplicated; reads always run', () => {
    for (const m of ['eth_sendTransaction', 'eth_signTransaction', 'personal_sign', 'eth_signTypedData_v4', 'transfer'])
      expect(shouldDedupe(m)).toBe(true);
    for (const m of ['eth_call', 'eth_estimateGas', 'eth_getTransactionCount', 'eth_chainId'])
      expect(shouldDedupe(m)).toBe(false);
  });
});

describe('in-flight dedupe', () => {
  it('an identical second request joins the first: one card, one device prompt, same txid to both', async () => {
    const inflight = createInflightRequests();
    let release!: (v: string) => void;
    const approveAndSend = vi.fn(() => new Promise<string>(r => (release = r)));
    const key = requestKey(ORIGIN, 'ethereum', 'eth_sendTransaction', [TX]);
    const first = inflight.run(key, approveAndSend);
    const second = inflight.run(key, approveAndSend);
    expect(approveAndSend).toHaveBeenCalledTimes(1);
    release('0xhash');
    await expect(first).resolves.toBe('0xhash');
    await expect(second).resolves.toBe('0xhash');
  });

  it('after it settles the key is released: a deliberate repeat gets its own card', async () => {
    const inflight = createInflightRequests();
    const fn = vi.fn(async () => 'ok');
    const key = requestKey(ORIGIN, 'ethereum', 'eth_sendTransaction', [TX]);
    await inflight.run(key, fn);
    await inflight.run(key, fn);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(inflight.size).toBe(0);
  });

  it('a failure (e.g. revert) reaches both callers once and releases the key', async () => {
    const inflight = createInflightRequests();
    let fail!: (e: Error) => void;
    const fn = vi.fn(() => new Promise<string>((_, rej) => (fail = rej)));
    const key = requestKey(ORIGIN, 'ethereum', 'eth_sendTransaction', [TX]);
    const a = inflight.run(key, fn);
    const b = inflight.run(key, fn);
    fail(new Error('execution reverted'));
    await expect(a).rejects.toThrow('execution reverted');
    await expect(b).rejects.toThrow('execution reverted');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(inflight.has(key)).toBe(false);
  });

  it('different requests run independently (nonce 3 and nonce 4 are two cards)', async () => {
    const inflight = createInflightRequests();
    const fn = vi.fn(async () => 'x');
    await Promise.all([
      inflight.run(requestKey(ORIGIN, 'ethereum', 'eth_sendTransaction', [{ ...TX, data: '0x01' }]), fn),
      inflight.run(requestKey(ORIGIN, 'ethereum', 'eth_sendTransaction', [{ ...TX, data: '0x02' }]), fn),
    ]);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

const NOW = Date.parse('2026-11-26T18:45:00Z');
const at = (s: string) => new Date(Date.parse(`2026-11-26T${s}Z`)).toISOString();
const ev = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  status: 'request',
  timestamp: at('18:40:00'),
  ...extra,
});
const MAX = 40 * 60_000;

describe('stored lifecycle decides the panel (ghost approvals)', () => {
  it('phases', () => {
    expect(approvalPhase(ev('a'))).toBe('actionable');
    expect(approvalPhase(ev('a', { status: 'approved' }))).toBe('in_progress');
    expect(approvalPhase(ev('a', { status: 'approved', txid: '0x1' }))).toBe('finished');
    expect(approvalPhase(ev('a', { status: 'failed' }))).toBe('finished');
  });

  it('vault-log replay: a sent tx left on its success page does not come back as a card after the next requests', () => {
    // nonce 2 sent (success page not closed) → page asks personal_sign.
    const n2 = ev('n2', { status: 'approved', txid: '0xn2', timestamp: at('18:39:40') });
    const sign = ev('sign', { type: 'personal_sign', timestamp: at('18:39:55') });
    let pick = pickPendingEvent([n2, sign], NOW, MAX);
    expect(pick.show?.id).toBe('sign');
    expect(pick.superseded.map(e => e.id)).toEqual(['n2']); // moved to history

    // personal_sign done and removed; next tx arrives: it shows, n2 does not.
    const a = ev('txA', { timestamp: at('18:40:05') });
    pick = pickPendingEvent([a], NOW, MAX);
    expect(pick.show?.id).toBe('txA');

    // Without the archive step the old logic (newest-first) would surface n2
    // again once txA settled; with it, nothing stale is left to reappear.
    pick = pickPendingEvent([], NOW, MAX);
    expect(pick.show).toBeNull();
  });

  it('a pending request wins over an older one still signing; the signing one never shows Approve again', () => {
    const signing = ev('a', { status: 'approved', timestamp: at('18:40:00') });
    const next = ev('b', { timestamp: at('18:41:00') });
    expect(pickPendingEvent([signing, next], NOW, MAX).show?.id).toBe('b');
    expect(pickPendingEvent([signing], NOW, MAX).show?.id).toBe('a');
    expect(initialApprovalView(signing).mode).toBe('in_progress');
  });

  it('a just-completed send keeps its success page while it is the newest event', () => {
    const done = ev('a', { status: 'approved', txid: '0xa', timestamp: at('18:41:00') });
    const pick = pickPendingEvent([done], NOW, MAX);
    expect(pick.show?.id).toBe('a');
    expect(pick.superseded).toEqual([]);
    expect(initialApprovalView(done)).toEqual({ mode: 'txid', txHash: '0xa' });
  });

  it('expired events are dropped', () => {
    const old = ev('old', { timestamp: at('17:00:00') });
    expect(pickPendingEvent([old], NOW, MAX)).toMatchObject({ show: null, expired: [old] });
  });

  it('failure after approval is recorded on the event; a never-approved event is left alone', () => {
    expect(failedEventPatch(ev('a', { status: 'approved' }), 'execution reverted', 'reverted')).toEqual({
      status: 'failed',
      error: 'execution reverted',
      errorKind: 'reverted',
    });
    expect(failedEventPatch(ev('a'), 'x')).toBeNull();
    expect(failedEventPatch(null, 'x')).toBeNull();
    expect(initialApprovalView(ev('a', { status: 'failed', error: 'boom' }))).toMatchObject({
      mode: 'failed',
      error: 'boom',
    });
  });

  it('worker restart: an approved-but-unfinished request is marked interrupted, not re-offered', () => {
    expect(interruptedEventPatch(ev('a', { status: 'approved' }))).toMatchObject({
      status: 'failed',
      errorKind: 'interrupted',
    });
    expect(interruptedEventPatch(ev('a'))).toBeNull();
    expect(interruptedEventPatch(ev('a', { status: 'approved', txid: '0x1' }))).toBeNull();
  });
});

describe('revert, said plainly', () => {
  const pioneer422 = new Error('EVM JSON-RPC error 3: execution reverted');
  const ethersRevert = Object.assign(new Error('execution reverted: "GS013"'), {
    code: 'CALL_EXCEPTION',
    reason: 'GS013',
  });

  it('recognizes reverts from ethers and from Pioneer', () => {
    expect(isRevertError(pioneer422)).toBe(true);
    expect(isRevertError(ethersRevert)).toBe(true);
    expect(isRevertError(new Error('network timeout'))).toBe(false);
  });

  it('messages say what happened and what to do, with the reason when there is one', () => {
    expect(revertMessage(ethersRevert)).toContain('execution reverted: GS013');
    expect(revertMessage(ethersRevert)).toContain('not signed or sent');
    expect(revertMessage(pioneer422)).toMatch(/execution reverted\)/);
    expect(revertCardMessage(ethersRevert)).toContain('KeepKey checks again');
  });
});
