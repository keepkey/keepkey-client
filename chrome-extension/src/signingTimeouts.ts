import { APPROVAL_TIMEOUT_MS, INTERACTIVE_REQUEST_TIMEOUT_MS } from './injected/requestTimeouts';
export { APPROVAL_TIMEOUT_MS };
export const SIGNING_TIMEOUT_MS = 10 * 60_000;
// Legacy consumers use the same queue + review + signing cap as both bridges.
export const WALLET_REQUEST_TIMEOUT_MS = INTERACTIVE_REQUEST_TIMEOUT_MS;
export const PROVIDER_CALLBACK_TIMEOUT_MS = INTERACTIVE_REQUEST_TIMEOUT_MS + 60_000;
