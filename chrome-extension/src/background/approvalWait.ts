import { APPROVAL_QUEUE_TIMEOUT_MS, APPROVAL_TIMEOUT_MS } from '../injected/requestTimeouts';

/**
 * Wait for the user's decision on one approval card.
 *
 * Resolves on ANY of:
 *   - eth_sign_response for this event (approve or reject in the side panel)
 *   - APPROVAL_TIMEOUT_MS after the side panel first reports `approval_shown`
 *   - APPROVAL_QUEUE_TIMEOUT_MS from enqueue when the card is never shown
 * Both timeouts resolve as a reject.
 *
 * The on-screen clock used to start at enqueue. When a dApp queued several
 * requests (Safe{Wallet} add-owner), requests 2..N expired while the user was
 * still working through request 1.
 */
export function waitForApprovalDecision(
  eventId: string,
  opts: { onSettle?: () => void; log?: (...args: any[]) => void } = {},
): Promise<{ success: boolean }> {
  const log = opts.log ?? (() => {});
  return new Promise(resolve => {
    let settled = false;
    let shown = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (success: boolean) => {
      settled = true;
      chrome.runtime.onMessage.removeListener(listener);
      if (timer != null) clearTimeout(timer);
      opts.onSettle?.();
      resolve({ success });
    };

    const arm = (ms: number, reason: string) => {
      if (timer != null) clearTimeout(timer);
      timer = setTimeout(() => {
        if (settled) return;
        log(`Approval timed out (${reason}), rejecting for event:`, eventId);
        finish(false);
      }, ms);
    };

    const listener = (message: any) => {
      if (settled) return;
      if (message?.action === 'approval_shown' && message?.eventId === eventId) {
        if (shown) return;
        shown = true;
        arm(APPROVAL_TIMEOUT_MS, 'not answered after being shown');
        return;
      }
      if (message?.action === 'eth_sign_response' && message?.response?.eventId === eventId) {
        log('Received eth_sign_response for event:', eventId);
        finish(message.response.decision === 'accept');
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    arm(APPROVAL_QUEUE_TIMEOUT_MS, 'never shown');
  });
}
