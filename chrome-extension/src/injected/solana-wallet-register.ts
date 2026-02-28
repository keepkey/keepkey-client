/**
 * Register a Solana Wallet Standard wallet.
 *
 * CRITICAL: The event detail MUST be a callback function, NOT an object.
 * dApps call  event.detail({ register })  where register is provided by the
 * wallet-adapter framework.
 *
 * See: https://github.com/wallet-standard/wallet-standard
 */

export function registerSolanaWallet(wallet: any): void {
  const callback = ({ register }: { register: (w: any) => void }) => {
    register(wallet);
  };

  // For adapters that use navigator.wallets
  try {
    (window.navigator as any).wallets?.register?.(wallet);
  } catch {
    // ignore
  }

  // Dispatch the standard registration event
  window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: callback }));

  // Also handle late-loading dApps that request wallets after registration
  window.addEventListener('wallet-standard:app-ready', (event: Event) => {
    const appReadyEvent = event as CustomEvent;
    try {
      appReadyEvent.detail?.({ register: (registerFn: any) => registerFn?.(wallet) });
    } catch {
      // ignore
    }
  });
}
