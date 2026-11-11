import { describe, expect, it } from 'vitest';
import {
  APPROVAL_QUEUE_TIMEOUT_MS,
  APPROVAL_TIMEOUT_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  INTERACTIVE_REQUEST_TIMEOUT_MS,
  isInteractiveMethod,
  requestTimeoutFor,
} from '../injected/requestTimeouts';
import { DEVICE_SIGN_TIMEOUT_MS } from './vaultTimeouts';

describe('request timeout budget', () => {
  it('page-side cap outlasts queue wait + on-screen wait + device signing', () => {
    expect(INTERACTIVE_REQUEST_TIMEOUT_MS).toBeGreaterThan(
      APPROVAL_QUEUE_TIMEOUT_MS + APPROVAL_TIMEOUT_MS + DEVICE_SIGN_TIMEOUT_MS,
    );
  });

  it.each([
    'eth_signTypedData_v4',
    'eth_sign',
    'personal_sign',
    'eth_sendTransaction',
    'eth_signTransaction',
    'eth_requestAccounts',
    'wallet_addEthereumChain',
    'signAndSendTransaction',
  ])('%s gets the interactive cap', m => {
    expect(isInteractiveMethod(m)).toBe(true);
    expect(requestTimeoutFor(m)).toBe(INTERACTIVE_REQUEST_TIMEOUT_MS);
  });

  it.each(['eth_chainId', 'eth_call', 'eth_getBalance', 'eth_sendRawTransaction', 'eth_accounts', undefined])(
    '%s keeps the default cap',
    m => expect(requestTimeoutFor(m)).toBe(DEFAULT_REQUEST_TIMEOUT_MS),
  );
});
