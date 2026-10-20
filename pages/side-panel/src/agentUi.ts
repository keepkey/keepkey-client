/**
 * agentUi — lets the MCP agent see the KeepKey UI itself (bex_ui).
 *
 * The page tools (bex_snapshot/click/…) reach web pages through the content
 * script, which Chrome never injects into extension pages — so without this the
 * agent was blind to the one surface that matters most: the approval card. Each
 * open KeepKey UI (side panel, or a KeepKey window from bex_ui open) holds a
 * named port to the background and announces where it lives. The background
 * routes each bex_ui call to exactly one UI over that port — never a broadcast,
 * where whichever UI answered first would win.
 *
 * Read-only by design: the agent DECIDES requests through bex_request (the same
 * event record this UI edits), never by clicking here. This view exists so the
 * agent can check what the user was shown — the clear-sign question. Same DOM
 * core as the page tools, so [disabled] / [obscured] mean the same thing here.
 */
import { findNodes, readPage, snapshot } from '@extension/shared';

const PORT_NAME = 'keepkey-agent-ui';
const BANNER_MS = 4000;

// Transparency: the agent reading or acting in the wallet's own UI shows a
// banner, exactly as a web page shows the agent overlay.
let bannerTimer: ReturnType<typeof setTimeout> | undefined;
function banner(textContent: string): void {
  let el = document.getElementById('kk-agent-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'kk-agent-banner';
    el.setAttribute('role', 'status');
    // aria-hidden keeps the banner itself out of the agent's own snapshots.
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText =
      'position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483647;padding:6px 10px;border-radius:6px;' +
      'background:#d29929;color:#000;font:600 12px/1.3 system-ui,sans-serif;pointer-events:none;text-align:center';
    document.body.appendChild(el);
  }
  el.textContent = `Agent ${textContent}`;
  el.style.display = 'block';
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el!.style.setProperty('display', 'none'), BANNER_MS);
}

async function handle(msg: any): Promise<any> {
  switch (msg.op) {
    case 'status':
      return {
        url: location.href,
        title: document.title,
        // Headings are the cheapest "which screen is this" signal: the approval
        // card, a drawer and the dashboard each lead with their own.
        headings: snapshot()
          .nodes.filter(n => n.role === 'heading')
          .map(n => n.name)
          .slice(0, 12),
      };
    case 'snapshot':
      banner('reading KeepKey');
      return snapshot();
    case 'find':
      banner('searching KeepKey');
      return findNodes(String(msg.text ?? ''), !!msg.regex);
    case 'read':
      banner('reading KeepKey');
      return readPage(msg.selector, Number(msg.maxChars) || 10_000);
    default:
      throw Object.assign(new Error(`unknown ui op: ${msg.op}`), { code: 'unknown_op' });
  }
}

export async function installAgentUi(): Promise<void> {
  // Side panel: chrome.tabs.getCurrent() is undefined and the window is the
  // browser window hosting it. KeepKey window / tab: we are a tab.
  const [win, tab] = await Promise.all([chrome.windows.getCurrent(), chrome.tabs.getCurrent()]);
  const surface = !tab ? 'side_panel' : win.type === 'popup' ? 'window' : 'tab';

  const connect = () => {
    const port = chrome.runtime.connect({ name: PORT_NAME });
    port.postMessage({ type: 'hello', windowId: win.id, surface, tabId: tab?.id ?? null, url: location.href });
    port.onMessage.addListener(async (msg: any) => {
      if (msg?.type !== 'call') return;
      try {
        port.postMessage({ type: 'result', id: msg.id, ok: true, data: await handle(msg) });
      } catch (e: any) {
        port.postMessage({ type: 'result', id: msg.id, ok: false, code: e?.code ?? 'ui_error', message: e?.message });
      }
    });
    // The MV3 service worker restarts drop the port; reconnect so the agent
    // never loses sight of an open UI.
    port.onDisconnect.addListener(() => setTimeout(connect, 1000));
  };
  connect();
}
