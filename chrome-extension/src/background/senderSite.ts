/**
 * The site shown on an approval card must come from Chrome, not from the page.
 *
 * requestInfo.siteUrl is built by the MAIN-world injected script from
 * window.location.href and relayed as-is by the content script, whose
 * `event.source === window` / origin checks a page's own postMessage passes.
 * So any page could claim to be https://opensea.io/, or claim
 * 'KeepKey Browser Extension' to get the KeepKey logo and no URL at all.
 * chrome.runtime.MessageSender is filled in by the browser, so the
 * WALLET_REQUEST handler overwrites the page's claim with this.
 *
 * "Is this the extension itself" (the side panel's Transfer page also sends
 * WALLET_REQUEST) is decided ONLY by origin equality. A missing sender.tab is
 * not proof — treating it as such would fail open.
 */
export function siteFromSender(
  sender: { url?: string; origin?: string },
  extensionOrigin: string,
): { siteUrl: string; origin: string | null } {
  let url: URL | null = null;
  try {
    if (sender.url) url = new URL(sender.url);
  } catch {
    // Unparsable — never shown; fall back to sender.origin.
  }
  const raw = sender.origin ?? url?.origin ?? null;
  // Sandboxed documents have an opaque origin, serialized as the string 'null'.
  const origin = raw === 'null' ? null : raw;
  // The side-panel ProjectInfoCard keys the KeepKey-logo rendering off this string.
  if (origin === extensionOrigin) return { siteUrl: 'KeepKey Browser Extension', origin: null };
  // Non-EVM cards show siteUrl verbatim; https://opensea.io@evil.example/ would
  // read as opensea.io, so drop userinfo before it's shown.
  if (url) {
    url.username = '';
    url.password = '';
  }
  return { siteUrl: url?.href || origin || 'Unknown site', origin };
}
