/**
 * agentPanel — a persistent, MCP-controllable status drawer mounted in the page
 * (isolated world). Unlike the transient overlay (pointer/box), this stays put
 * and shows:
 *   - a live log of what the agent is doing (fed from every click/type/select),
 *   - a device-action alert the MCP raises when a KeepKey button-press is needed,
 *   - a hint for opening the real wallet side panel — which Chrome won't let the
 *     MCP auto-open (sidePanel.open needs a user gesture the MCP doesn't have),
 *     so we point the user at the toolbar icon instead.
 *
 * ponytail: pure DOM + CSS, no deps. The MCP sets the device-action message
 * itself (bex_panel) rather than us plumbing live device state through the
 * background — the agent driving the sign already knows the moment it happens.
 */

const PANEL_ID = '__bex_agent_panel';
const GOLD = '#d29929';
const MAX_LOG = 8;

let panel: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let logEl: HTMLElement | null = null;
const logLines: string[] = [];

function css(n: HTMLElement, styles: Partial<CSSStyleDeclaration>): HTMLElement {
  Object.assign(n.style, styles);
  return n;
}
function mk(tag: string, styles: Partial<CSSStyleDeclaration> = {}): HTMLElement {
  return css(document.createElement(tag), styles);
}

/** The KeepKey toolbar icon, redrawn small so the hint shows what to click. */
const KK_ICON =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none">' +
  '<rect x="2" y="2" width="20" height="20" rx="5" fill="#0d1117"/>' +
  '<path d="M8 6v12M8 12l6-6M8 12l6 6" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<circle cx="18" cy="18" r="3" fill="#3fb950" stroke="#0d1117" stroke-width="1.4"/>' +
  '</svg>';

function ensurePanel(): boolean {
  if (panel && panel.isConnected) return true;
  const host = document.body || document.documentElement;
  if (!host) return false;

  panel = mk('div', {
    position: 'fixed',
    top: '48px',
    right: '0',
    width: '248px',
    maxHeight: '70vh',
    display: 'flex',
    flexDirection: 'column',
    background: '#161b22',
    color: '#e6edf3',
    font: '13px/1.45 -apple-system,system-ui,sans-serif',
    border: '1px solid #30363d',
    borderRight: 'none',
    borderRadius: '10px 0 0 10px',
    boxShadow: '0 6px 24px rgba(0,0,0,.4)',
    zIndex: '2147483646', // just under the transient overlay
    transform: 'translateX(110%)',
    transition: 'transform .28s cubic-bezier(.22,.61,.36,1)',
    overflow: 'hidden',
  });

  const header = mk('div', {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '9px 12px',
    fontWeight: '700',
    background: `linear-gradient(90deg,${GOLD},#b8801f)`,
    color: '#fff',
  });
  header.innerHTML = '<span>🤖 KeepKey MCP</span>';
  const close = css(mk('button'), {
    marginLeft: 'auto',
    cursor: 'pointer',
    border: 'none',
    background: 'transparent',
    color: '#fff',
    font: '700 16px/1 sans-serif',
    padding: '0 2px',
  });
  close.textContent = '×';
  close.setAttribute('aria-label', 'Hide MCP panel');
  close.addEventListener('click', panelHide);
  header.appendChild(close);

  statusEl = mk('div', { display: 'none', padding: '10px 12px', fontWeight: '600' });

  logEl = mk('div', {
    padding: '8px 12px',
    overflowY: 'auto',
    flex: '1',
    fontVariantNumeric: 'tabular-nums',
    color: '#9aa4b2',
  });

  const hint = mk('div', {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '9px 12px',
    borderTop: '1px solid #30363d',
    background: '#0d1117',
    color: '#9aa4b2',
    fontSize: '12px',
  });
  hint.innerHTML =
    `<span style="flex:0 0 auto">${KK_ICON}</span>` +
    '<span>Open the full wallet: click the KeepKey icon in your toolbar <b style="color:#e6edf3">↗</b></span>';

  panel.append(header, statusEl, logEl, hint);
  host.appendChild(panel);
  return true;
}

export function panelShow(): void {
  try {
    if (ensurePanel() && panel) panel.style.transform = 'translateX(0)';
  } catch {
    /* never break an action */
  }
}

export function panelHide(): void {
  try {
    if (panel) panel.style.transform = 'translateX(110%)';
  } catch {
    /* ignore */
  }
}

/** Append one action line to the log and reveal the panel. */
export function panelLog(line: string): void {
  try {
    if (!ensurePanel() || !logEl) return;
    logLines.push(line);
    while (logLines.length > MAX_LOG) logLines.shift();
    logEl.textContent = '';
    for (const l of logLines) {
      const row = mk('div', { padding: '1px 0' });
      row.textContent = `• ${l}`;
      logEl.appendChild(row);
    }
    logEl.scrollTop = logEl.scrollHeight;
    panelShow();
  } catch {
    /* ignore */
  }
}

/** Raise a prominent status line — used for "confirm on your KeepKey". */
export function panelStatus(message: string, level: 'info' | 'action-needed' | 'done'): void {
  try {
    if (!ensurePanel() || !statusEl) return;
    if (!message) {
      statusEl.style.display = 'none';
      return;
    }
    const style: Record<string, { bg: string; fg: string; icon: string }> = {
      info: { bg: '#1f2937', fg: '#9aa4b2', icon: 'ℹ️' },
      'action-needed': { bg: 'rgba(210,153,41,.18)', fg: GOLD, icon: '👆' },
      done: { bg: 'rgba(63,185,80,.15)', fg: '#3fb950', icon: '✓' },
    };
    const s = style[level] ?? style.info;
    css(statusEl, { display: 'block', background: s.bg, color: s.fg });
    statusEl.textContent = `${s.icon} ${message}`;
    panelShow();
  } catch {
    /* ignore */
  }
}
