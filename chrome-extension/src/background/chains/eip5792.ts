/**
 * EIP-5792 (wallet call batching) — the parts KeepKey answers.
 *
 * We implement no wallet_sendCalls, and per the final spec a chain without an
 * `atomic` capability means "no batching", so wallet_getCapabilities truthfully
 * returns `{}` (as MetaMask does for hardware-keyring accounts). The old
 * early-draft shape was keyed by address, which viem parsed as chain ids.
 *
 * No 4100 or chainIds checks: `{}` is the same for every address, so there is
 * nothing to protect, and the background ADDRESS drifts (account 0 after an SW
 * restart, asset browsing without accountsChanged) — 4100 would be spurious.
 */

import { createProviderRpcError } from '../utils';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export const walletGetCapabilities = (params: unknown): Record<string, never> => {
  const address = Array.isArray(params) ? params[0] : undefined;
  if (typeof address !== 'string' || !ADDRESS_RE.test(address)) {
    throw createProviderRpcError(-32602, 'Invalid params: expected [address, chainIds?]');
  }
  return {};
};

/**
 * MetaMask json-rpc-engine wording for an unknown method. viem's sendCalls
 * `experimental_fallback` matches this substring, so wallet_sendCalls & co.
 * fall back to one eth_sendTransaction per call instead of failing. No viem
 * version stops after a rejected or failed call, and older viem (≤2.45) also
 * skips awaiting each while the side panel shows the newest request first, so
 * dependent calls (approve->swap) can still be sent after call 1 fails, or
 * approved out of order. Used only for the three batching methods: ethers v6
 * also matches this wording and would turn a rejected eth_newFilter into
 * per-block eth_getLogs polling, which we reject too.
 */
export const methodNotAvailableMessage = (method: string): string =>
  `The method "${method}" does not exist / is not available.`;
