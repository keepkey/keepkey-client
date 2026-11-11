/**
 * Request deadlines along the dApp → injected → content → background path.
 *
 * Shared by the injected provider, the content-script relay and the
 * background so the layers agree. The rule: an outer layer must never give
 * up before the inner layers can finish. Otherwise the dApp sees "Request
 * timeout" while the request is still queued in the side panel or on the device.
 *
 * Budget for a user-interactive request (worst case, all clocks per request):
 *   APPROVAL_QUEUE_TIMEOUT_MS  waiting behind other requests, not yet on screen
 * + APPROVAL_TIMEOUT_MS        on screen, waiting for Approve / Reject
 * + device signing             vault call, see background/vaultTimeouts.ts (10 min)
 * < INTERACTIVE_REQUEST_TIMEOUT_MS  page-side cap (injected + content script)
 */

/** Once an approval card is shown, the user has this long to approve or reject. */
export const APPROVAL_TIMEOUT_MS = 10 * 60_000;

/**
 * Upper bound for a request that is queued but never shown (for example,
 * Safe{Wallet} fires several signatures and the user works through them one at
 * a time). Its APPROVAL_TIMEOUT_MS clock only starts when it reaches the screen.
 */
export const APPROVAL_QUEUE_TIMEOUT_MS = 30 * 60_000;

/** Page-side cap for requests that can wait on the user or the device. */
export const INTERACTIVE_REQUEST_TIMEOUT_MS = 60 * 60_000;

/** Page-side cap for everything else (RPC reads, chain id, ...). */
export const DEFAULT_REQUEST_TIMEOUT_MS = 5 * 60_000;

/**
 * Methods that can block on the approval card or the device. Prefix match on
 * `eth_sign*` / `*_sign*` covers personal_sign, eth_signTypedData_v4 and the
 * non-EVM providers' sign methods.
 */
const INTERACTIVE_METHODS = new Set([
  'eth_sendTransaction',
  'eth_requestAccounts',
  'request_accounts',
  'wallet_addEthereumChain',
  'wallet_switchEthereumChain',
  'wallet_requestPermissions',
  'transfer',
]);

export const isInteractiveMethod = (method: unknown): boolean =>
  typeof method === 'string' && (INTERACTIVE_METHODS.has(method) || /sign/i.test(method) || /^send/i.test(method));

export const requestTimeoutFor = (method: unknown): number =>
  isInteractiveMethod(method) ? INTERACTIVE_REQUEST_TIMEOUT_MS : DEFAULT_REQUEST_TIMEOUT_MS;
