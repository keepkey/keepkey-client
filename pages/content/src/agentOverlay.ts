/**
 * agentOverlay — a real-time visual layer so the user can WATCH the MCP agent
 * work: an animated pointer glides to each target, the target is outlined, a
 * caption names the action, and a top banner shows the tab is being driven.
 *
 * Isolated-world DOM, `pointer-events:none` throughout — it never intercepts the
 * agent's clicks or the user's, and never changes layout (everything is
 * position:fixed). The agent acts in discrete steps, so this highlights each
 * action as it happens rather than mirroring a continuous cursor.
 *
 * ponytail: pure DOM + CSS transitions, no deps, no new permissions. All draws
 * are wrapped in try/catch — a broken overlay must never break a wallet action.
 */

const ROOT_ID = '__bex_agent_overlay';
const Z = 2147483647; // max z-index — sit above everything the page draws
const HIGHLIGHT_MS = 1100; // how long the box + label linger after an action
const BANNER_IDLE_MS = 8000; // hide the "driving" banner after this much quiet
const GOLD = '#d29929'; // brand token

let root: HTMLElement | null = null;
let box: HTMLElement | null = null;
let label: HTMLElement | null = null;
let cursor: HTMLElement | null = null;
let banner: HTMLElement | null = null;
let fadeTimer: ReturnType<typeof setTimeout> | undefined;
let bannerTimer: ReturnType<typeof setTimeout> | undefined;

function el(styles: Partial<CSSStyleDeclaration>): HTMLElement {
  const n = document.createElement('div');
  Object.assign(n.style, styles);
  return n;
}

function ensureRoot(): boolean {
  if (root && root.isConnected) return true;
  const host = document.body || document.documentElement;
  if (!host) return false;

  root = el({ position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: String(Z) });

  banner = el({
    position: 'fixed',
    top: '0',
    left: '0',
    right: '0',
    height: '28px',
    display: 'none',
    alignItems: 'center',
    padding: '0 12px',
    font: '600 13px/28px -apple-system,system-ui,sans-serif',
    color: '#fff',
    background: `linear-gradient(90deg,${GOLD},#b8801f)`,
    boxShadow: '0 1px 6px rgba(0,0,0,.3)',
    pointerEvents: 'none',
  });
  banner.textContent = '🤖 MCP is driving this tab';

  box = el({
    position: 'fixed',
    border: `2px solid ${GOLD}`,
    borderRadius: '4px',
    boxShadow: `0 0 0 2px rgba(210,153,41,.35), 0 0 14px rgba(210,153,41,.55)`,
    transition: 'all .18s ease-out',
    opacity: '0',
    pointerEvents: 'none',
  });

  label = el({
    position: 'fixed',
    padding: '2px 8px',
    borderRadius: '4px',
    font: '600 12px/1.5 -apple-system,system-ui,sans-serif',
    color: '#fff',
    background: GOLD,
    whiteSpace: 'nowrap',
    maxWidth: '60vw',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    opacity: '0',
    transition: 'opacity .18s ease-out',
    boxShadow: '0 1px 4px rgba(0,0,0,.3)',
    pointerEvents: 'none',
  });

  cursor = el({
    position: 'fixed',
    left: '0',
    top: '0',
    width: '24px',
    height: '24px',
    transform: 'translate(-100px,-100px)',
    transition: 'transform .4s cubic-bezier(.22,.61,.36,1)',
    opacity: '0',
    pointerEvents: 'none',
    filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.4))',
  });
  cursor.innerHTML =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none">' +
    `<path d="M5 3l14 7-6 1.5L10 18 5 3z" fill="${GOLD}" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/>` +
    '</svg>';

  root.append(banner, box, label, cursor);
  host.appendChild(root);
  return true;
}

function showBanner(): void {
  if (!banner) return;
  banner.style.display = 'flex';
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => {
    if (banner) banner.style.display = 'none';
    if (cursor) cursor.style.opacity = '0';
  }, BANNER_IDLE_MS);
}

/** Point at + outline `target` and caption the action. Best-effort, never throws. */
export function overlayAct(kind: string, target: Element, detail: string): void {
  try {
    if (!ensureRoot() || !box || !label || !cursor) return;
    const r = target.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return; // off-screen / detached — nothing to point at

    Object.assign(box.style, {
      left: `${r.left - 3}px`,
      top: `${r.top - 3}px`,
      width: `${r.width + 6}px`,
      height: `${r.height + 6}px`,
      opacity: '1',
    });

    // Caption above the target, or below if there's no room at the top.
    const above = r.top - 26 > 30;
    Object.assign(label.style, {
      left: `${Math.max(4, r.left)}px`,
      top: `${above ? r.top - 26 : r.bottom + 6}px`,
      opacity: '1',
    });
    label.textContent = detail ? `${kind}: ${detail}` : kind;

    // Pointer glides to the target's centre (the .4s CSS transition animates it).
    cursor.style.transform = `translate(${r.left + r.width / 2 - 4}px,${r.top + r.height / 2 - 2}px)`;
    cursor.style.opacity = '1';

    showBanner();

    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => {
      if (box) box.style.opacity = '0';
      if (label) label.style.opacity = '0';
    }, HIGHLIGHT_MS);
  } catch {
    /* overlay must never break an action */
  }
}

/**
 * Hide/show the whole overlay. Used to keep bex_screenshot captures clean.
 * When hiding, resolves only after a painted frame so the capture sees it gone.
 */
export function overlaySetVisible(show: boolean): Promise<void> {
  try {
    if (root) root.style.visibility = show ? 'visible' : 'hidden';
  } catch {
    /* ignore */
  }
  if (show) return Promise.resolve();
  return new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => res())));
}
