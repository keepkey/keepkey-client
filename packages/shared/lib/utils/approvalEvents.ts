/**
 * Lifecycle of an approval event in requestStorage (KEEPKEY-192 "ghost
 * approvals"). The side panel shows whatever is in storage, so the stored
 * state — not the card's React state — decides what a (re)opened panel shows:
 *
 *   request  → review card with Approve / Reject       (actionable)
 *   approved → "confirm on your KeepKey" / in progress  (never Approve again)
 *   txid     → success page with the txid              (finished)
 *   failed   → the reason, e.g. a revert               (finished)
 *
 * Without this, an approved or already-broadcast request re-rendered as a
 * fresh card whenever the panel reloaded or a newer request finished — the
 * "same card twice" report.
 */

export type ApprovalPhase = 'actionable' | 'in_progress' | 'finished';

export type ApprovalEventLike = {
  id: string;
  status?: string;
  txid?: string;
  txHash?: string;
  signedTx?: unknown;
  error?: string;
  errorKind?: string;
  timestamp?: string;
  [k: string]: unknown;
};

const FINISHED_STATUSES = new Set(['failed', 'confirmation_unknown', 'broadcasted', 'completed', 'approval']);

export function approvalPhase(ev: ApprovalEventLike): ApprovalPhase {
  if (ev.txid || ev.txHash || (ev.status && FINISHED_STATUSES.has(ev.status))) return 'finished';
  if (ev.status === 'approved' || ev.signedTx) return 'in_progress';
  return 'actionable';
}

export type PendingPick<E extends ApprovalEventLike> = {
  /** The event the panel should show, or null. */
  show: E | null;
  /** Too old: drop from storage. */
  expired: E[];
  /** Finished events that a newer request has replaced: move to history. */
  superseded: E[];
};

/**
 * Which stored event the panel shows. A request still waiting for a decision
 * wins; otherwise the newest of the rest (in progress, or finished) — a
 * finished event only while nothing newer has come in after it; once the page has moved
 * on, its success/error page belongs in history, not back on screen.
 * `events` is in storage (insertion) order, oldest first.
 */
export function pickPendingEvent<E extends ApprovalEventLike>(
  events: E[],
  now: number,
  maxAgeMs: number,
): PendingPick<E> {
  const expired: E[] = [];
  const fresh: E[] = [];
  for (const ev of events) {
    const t = ev.timestamp ? new Date(ev.timestamp).getTime() : now;
    if (Number.isFinite(t) && now - t > maxAgeMs) expired.push(ev);
    else fresh.push(ev);
  }
  const superseded = fresh.filter((ev, i) => approvalPhase(ev) === 'finished' && i < fresh.length - 1);
  const live = fresh.filter(ev => !superseded.includes(ev));
  const newestFirst = [...live].reverse();
  return {
    show:
      newestFirst.find(ev => approvalPhase(ev) === 'actionable') ??
      // Otherwise the newest of in-progress / finished: a send that just
      // completed keeps its success page even while an older one still signs.
      newestFirst[0] ??
      null,
    expired,
    superseded,
  };
}

export type ApprovalView =
  | { mode: 'review' }
  | { mode: 'in_progress' }
  | { mode: 'txid'; txHash: string }
  | { mode: 'failed'; error: string; errorKind?: string; txHash?: string };

/** What the card shows when it (re)mounts for a stored event. */
export function initialApprovalView(ev: ApprovalEventLike): ApprovalView {
  const hash = ev.txid || ev.txHash;
  if (ev.status === 'failed' || ev.status === 'confirmation_unknown' || (ev.error && !hash)) {
    return {
      mode: 'failed',
      error: ev.error || 'This request failed.',
      ...(ev.errorKind ? { errorKind: ev.errorKind } : {}),
      ...(hash ? { txHash: hash } : {}),
    };
  }
  if (hash) return { mode: 'txid', txHash: hash };
  if (approvalPhase(ev) === 'in_progress') return { mode: 'in_progress' };
  return { mode: 'review' };
}

/** Patch for an approved request that then failed; null when nothing to record. */
export function failedEventPatch(
  ev: ApprovalEventLike | null | undefined,
  error: string,
  errorKind?: string,
): Partial<ApprovalEventLike> | null {
  if (!ev || approvalPhase(ev) !== 'in_progress') return null;
  return { status: 'failed', error, ...(errorKind ? { errorKind } : {}) };
}

export const INTERRUPTED_MESSAGE =
  'KeepKey Client restarted before this request finished. Check the site or a block explorer before trying again — it may already have been sent.';

/** On worker start: an approved request whose flow died with the old worker. */
export function interruptedEventPatch(ev: ApprovalEventLike): Partial<ApprovalEventLike> | null {
  return approvalPhase(ev) === 'in_progress'
    ? { status: 'failed', error: INTERRUPTED_MESSAGE, errorKind: 'interrupted' }
    : null;
}

/** Plain-language revert message for the card and the dApp. */
export function isRevertError(e: unknown): boolean {
  const any = e as { code?: unknown; message?: unknown; shortMessage?: unknown; info?: any } | null;
  const text = [any?.message, any?.shortMessage, any?.info?.error?.message].filter(Boolean).join(' ');
  return any?.code === 'CALL_EXCEPTION' || /execution reverted|revert/i.test(text);
}

export function revertReason(e: unknown): string | undefined {
  const any = e as { reason?: unknown; shortMessage?: unknown; message?: unknown } | null;
  const reason = typeof any?.reason === 'string' && any.reason ? any.reason : undefined;
  if (reason) return reason;
  const m = String(any?.shortMessage || any?.message || '').match(
    /reverted(?: with reason string)?:?\s*"?([^"\n(]+)"?/i,
  );
  const r = m?.[1]?.trim();
  return r && !/^\(?unknown/i.test(r) ? r : undefined;
}

export function revertMessage(e: unknown): string {
  const reason = revertReason(e);
  return `This transaction would fail on-chain (execution reverted${reason ? `: ${reason}` : ''}). It was not signed or sent. The site may be waiting for an earlier transaction to confirm — wait for it, then try again from the site.`;
}

/** Card-time version: nothing is signed yet; approving re-checks first. */
export function revertCardMessage(e: unknown): string {
  const reason = revertReason(e);
  return `The network says it would revert${reason ? ` (${reason})` : ''}. If you approve, KeepKey checks again and will not sign it while it still fails. The site may be waiting for an earlier transaction to confirm.`;
}
