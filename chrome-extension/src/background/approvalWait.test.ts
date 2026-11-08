import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APPROVAL_QUEUE_TIMEOUT_MS, APPROVAL_TIMEOUT_MS } from '../injected/requestTimeouts';
import { waitForApprovalDecision } from './approvalWait';

type Listener = (message: any) => void;
let listeners: Set<Listener>;
const send = (message: any) => [...listeners].forEach(l => l(message));

beforeEach(() => {
  vi.useFakeTimers();
  listeners = new Set();
  vi.stubGlobal('chrome', {
    runtime: {
      onMessage: {
        addListener: (l: Listener) => listeners.add(l),
        removeListener: (l: Listener) => listeners.delete(l),
      },
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const settledState = (p: Promise<{ success: boolean }>) => {
  const state: { value?: { success: boolean } } = {};
  void p.then(v => (state.value = v));
  return state;
};

describe('waitForApprovalDecision', () => {
  it('resolves with the user decision and cleans up', async () => {
    const onSettle = vi.fn();
    const p = waitForApprovalDecision('a', { onSettle });
    send({ action: 'eth_sign_response', response: { eventId: 'a', decision: 'accept' } });
    await expect(p).resolves.toEqual({ success: true });
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });

  it('ignores responses for other events', async () => {
    const p = settledState(waitForApprovalDecision('a'));
    send({ action: 'eth_sign_response', response: { eventId: 'b', decision: 'accept' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(p.value).toBeUndefined();
  });

  it('Safe-style queue: request 2 survives while request 1 is on screen past the old 10 min limit', async () => {
    const first = settledState(waitForApprovalDecision('one'));
    const second = settledState(waitForApprovalDecision('two'));
    send({ action: 'approval_shown', eventId: 'one' });

    // The user takes 9 minutes on request 1, then the device takes 3 more
    // minutes before request 2 reaches the screen.
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    send({ action: 'eth_sign_response', response: { eventId: 'one', decision: 'accept' } });
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(first.value).toEqual({ success: true });
    expect(second.value).toBeUndefined(); // the old enqueue-based clock had already fired at 10 min

    // Request 2 now gets its own full on-screen window.
    send({ action: 'approval_shown', eventId: 'two' });
    await vi.advanceTimersByTimeAsync(APPROVAL_TIMEOUT_MS - 1);
    expect(second.value).toBeUndefined();
    send({ action: 'eth_sign_response', response: { eventId: 'two', decision: 'accept' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(second.value).toEqual({ success: true });
  });

  it('rejects APPROVAL_TIMEOUT_MS after being shown, and a repeat show does not extend it', async () => {
    const p = settledState(waitForApprovalDecision('a'));
    send({ action: 'approval_shown', eventId: 'a' });
    await vi.advanceTimersByTimeAsync(APPROVAL_TIMEOUT_MS - 60_000);
    send({ action: 'approval_shown', eventId: 'a' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(p.value).toEqual({ success: false });
  });

  it('rejects after APPROVAL_QUEUE_TIMEOUT_MS when never shown', async () => {
    const p = settledState(waitForApprovalDecision('a'));
    await vi.advanceTimersByTimeAsync(APPROVAL_QUEUE_TIMEOUT_MS - 1);
    expect(p.value).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(p.value).toEqual({ success: false });
    expect(listeners.size).toBe(0);
  });
});

it('agent decision uses the same one-use settle path and removes the listener', async () => {
  const onSettle = vi.fn();
  let decide!: (ok: boolean) => void;
  const p = waitForApprovalDecision('agent', {
    onReady: d => {
      decide = d;
    },
    onSettle,
  });
  decide(false);
  decide(true);
  await expect(p).resolves.toEqual({ success: false });
  expect(onSettle).toHaveBeenCalledTimes(1);
  expect(listeners.size).toBe(0);
  await vi.runAllTimersAsync();
  expect(onSettle).toHaveBeenCalledTimes(1);
});
