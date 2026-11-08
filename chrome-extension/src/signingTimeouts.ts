// Allow ten minutes for BEX review, then ten minutes for Vault/device signing.
// Keep outer bridges alive until both stages can return a result or error.
export const APPROVAL_TIMEOUT_MS = 10 * 60_000;
export const SIGNING_TIMEOUT_MS = 10 * 60_000;
export const WALLET_REQUEST_TIMEOUT_MS = APPROVAL_TIMEOUT_MS + SIGNING_TIMEOUT_MS + 60_000;
export const PROVIDER_CALLBACK_TIMEOUT_MS = WALLET_REQUEST_TIMEOUT_MS + 60_000;
