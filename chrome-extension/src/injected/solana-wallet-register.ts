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
  // Per the wallet-standard spec, the app provides an API object
  // `{ register, on, ... }` and the wallet's callback pulls `register` off it.
  // This same callback is used by BOTH paths below (register-wallet dispatch
  // and app-ready), so the shape it receives must be that API object.
  const callback = ({ register }: { register: (w: any) => void }) => {
    register(wallet);
  };

  // Layer 1: Push callback into navigator.wallets array (legacy queue pattern,
  // pre-spec). Harmless for modern apps that ignore it; helps very old ones.
  try {
    const nav = window.navigator as any;
    if (!nav.wallets) {
      nav.wallets = [];
    }
    if (Array.isArray(nav.wallets)) {
      nav.wallets.push(callback);
    } else if (typeof nav.wallets.register === 'function') {
      nav.wallets.register(wallet);
    }
  } catch {
    // ignore — continue with event-based fallback
  }

  // Layer 2: Announce to apps already listening for `register-wallet`. Apps
  // that loaded before us have their persistent listener attached and catch
  // this immediately. Re-announced on a short delay because heavy SPAs
  // (Uniswap) attach their listener AFTER our document_start dispatch. Apps
  // dedupe by wallet-object reference, so re-dispatching the same instance is
  // a no-op for those that already have it.
  const announce = () => {
    try {
      window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: callback }));
    } catch {
      // ignore
    }
  };
  announce();
  setTimeout(announce, 100);
  setTimeout(announce, 1000);

  // Layer 3: Late-loading apps dispatch `wallet-standard:app-ready` with their
  // API object as `event.detail`. Per spec the wallet calls `callback(detail)`
  // — detail IS the `{ register, on }` API, NOT a function. (The previous
  // `typeof detail === 'function'` check inverted this and never fired for
  // spec-compliant apps like Uniswap, so the wallet was never registered with
  // dApps that initialize after injection.)
  window.addEventListener('wallet-standard:app-ready', (event: Event) => {
    const api = (event as CustomEvent).detail;
    try {
      if (api && typeof api.register === 'function') {
        callback(api);
      } else if (typeof api === 'function') {
        // Tolerate a non-standard shape where detail is itself the callback.
        api(callback);
      }
    } catch {
      // ignore
    }
  });
}
