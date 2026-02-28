/**
 * Register a Solana Wallet Standard wallet.
 *
 * Follows the wallet-standard spec:
 * https://github.com/wallet-standard/wallet-standard
 *
 * Registration strategy (3 layers for maximum compatibility):
 * 1. Push registration callback into navigator.wallets array (queue pattern)
 * 2. Dispatch 'wallet-standard:register-wallet' event for already-listening apps
 * 3. Listen for 'wallet-standard:app-ready' for late-loading dApps
 *
 * The array-push approach is critical: wallet-standard creates
 * window.navigator.wallets as an array. Wallets push callbacks into it.
 * When the framework loads, it drains the array and calls each callback
 * with { register }. This works regardless of load order.
 */

export function registerSolanaWallet(wallet: any): void {
  const callback = ({ register }: { register: (w: any) => void }) => {
    register(wallet);
  };

  // Layer 1: Push callback into navigator.wallets array (queue pattern)
  // This is the PRIMARY registration method per the wallet-standard spec.
  // If the array doesn't exist yet, create it so wallets registered before
  // the framework loads are queued and drained when it initializes.
  try {
    const nav = window.navigator as any;
    if (!nav.wallets) {
      nav.wallets = [];
    }

    if (Array.isArray(nav.wallets)) {
      // Spec: push the registration callback, framework will drain it
      nav.wallets.push(callback);
    } else if (typeof nav.wallets.register === 'function') {
      // Framework already loaded and replaced the array with a registry object
      nav.wallets.register(wallet);
    }
  } catch {
    // ignore — continue with event-based fallback
  }

  // Layer 2: Dispatch event for frameworks already listening
  try {
    window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: callback }));
  } catch {
    // ignore
  }

  // Layer 3: Handle late-loading dApps that fire app-ready after us
  window.addEventListener('wallet-standard:app-ready', (event: Event) => {
    const appReadyEvent = event as CustomEvent;
    try {
      if (typeof appReadyEvent.detail === 'function') {
        appReadyEvent.detail(callback);
      }
    } catch {
      // ignore
    }
  });
}
