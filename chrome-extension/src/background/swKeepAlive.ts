/**
 * Keep the MV3 service worker alive while a wallet request is in flight.
 *
 * Chrome stops an idle extension service worker after about 30s, and calling
 * an extension API resets that idle timer. A signing request can wait minutes
 * on the approval card and then on the device: an in-flight vault fetch alone
 * is not reliably counted as activity. If the worker stopped, the pending
 * promise, its approval listener and the page's sendResponse would all be lost.
 *
 * Reference-counted: the heartbeat runs while at least one hold is open.
 */

export const KEEPALIVE_INTERVAL_MS = 20_000;

let holds = 0;
let heartbeat: ReturnType<typeof setInterval> | null = null;

const ping = () => {
  try {
    // Cheap extension API call; any call resets the idle timer.
    void chrome.runtime.getPlatformInfo().catch(() => {});
  } catch {
    /* chrome.* unavailable (tests) */
  }
};

/** Open a hold. Call the returned function once, when the request finishes. */
export function holdServiceWorker(): () => void {
  holds++;
  if (heartbeat == null) heartbeat = setInterval(ping, KEEPALIVE_INTERVAL_MS);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds = Math.max(0, holds - 1);
    if (holds === 0 && heartbeat != null) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };
}

/** For tests. */
export const activeHolds = () => holds;
