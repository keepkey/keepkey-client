/**
 * agentDom — the page-side half of the browser-driving MCP tools.
 *
 * The background (mcpBridge → browserTools.ts) sends BEX_AGENT_DOM messages here
 * and we answer with a snapshot / click / type / read result.
 *
 * Design follows the convention Playwright MCP and Chrome DevTools MCP arrived at
 * independently: expose an accessibility-shaped list of INTERACTIVE elements, each
 * with an opaque `ref` handle minted here, and have the agent act on refs. The
 * agent never invents a CSS selector and never clicks a pixel coordinate — both
 * are the classic flake sources. Refs live in `refs` below and are re-minted on
 * every snapshot; a stale ref fails loudly rather than hitting the wrong element.
 *
 * ponytail: this computes a role/name approximation from the DOM instead of asking
 * Chrome for the real AX tree via chrome.debugger. Costs us nothing (no `debugger`
 * permission, no "extension is debugging this browser" infobar, no conflict with a
 * DevTools window) and sidesteps the ignored-node bloat that makes the real AX tree
 * ~50% dead weight. Upgrade path if a page's roles come out wrong: add the
 * `debugger` permission and swap snapshot() for Accessibility.getFullAXTree.
 */

import { getPageConsole } from './consoleBridge';
import { pullObs } from './obsBridge';
import { overlayAct, overlayAnnounce, overlayEndSession, overlaySetVisible } from './agentOverlay';
import { panelShow, panelHide, panelLog, panelStatus } from './agentPanel';
import { findNodes, fireClick, nameOf, readPage, resolve, setValue, snapshot } from '@extension/shared';

const TAG = ' | agentDom | ';

// Let the pointer/highlight land before the action fires, so the user sees WHAT
// is being acted on. Hardware-wallet flows are slow anyway, so this is free.
const SHOW_MS = 420;
const showThen = (kind: string, el: Element, detail: string) => {
  overlayAct(kind, el, detail);
  panelLog(detail ? `${kind}: ${detail}` : kind);
  return new Promise<void>(r => setTimeout(r, SHOW_MS));
};

const STORAGE_MAX_KEYS = 200;
const STORAGE_VALUE_CLIP = 1000;

/**
 * Read-only dump of the top-frame origin's persisted state (bex_storage). Runs
 * in the ISOLATED world — web storage is origin-scoped and shared with the page,
 * so no main-world hop is needed. Only invokes read APIs (Storage iteration,
 * a document.cookie read, readonly IndexedDB transactions); never writes.
 * HttpOnly cookies are invisible to document.cookie by design.
 */
async function readStorage(): Promise<any> {
  const dumpWebStorage = (s: Storage) => {
    const out: Record<string, string> = {};
    const n = Math.min(s.length, STORAGE_MAX_KEYS);
    for (let i = 0; i < n; i++) {
      const k = s.key(i);
      if (k == null) continue;
      const v = s.getItem(k) ?? '';
      out[k] = v.length > STORAGE_VALUE_CLIP ? v.slice(0, STORAGE_VALUE_CLIP) + '…' : v;
    }
    return { keys: s.length, truncated: s.length > STORAGE_MAX_KEYS, values: out };
  };

  const cookies = (document.cookie || '')
    .split('; ')
    .filter(Boolean)
    .map(c => c.split('=')[0]);

  let indexedDb: any = { supported: false };
  try {
    if ((indexedDB as any).databases) {
      const dbs = await (indexedDB as any).databases();
      indexedDb = {
        supported: true,
        databases: await Promise.all(
          dbs.slice(0, 20).map(
            (d: any) =>
              new Promise(res => {
                // Bound the open — a concurrent versionchange elsewhere can block
                // it indefinitely, and this path isn't behind the pull timeout.
                const guard = setTimeout(() => res({ name: d.name, version: d.version, objectStores: [] }), 1000);
                // Open with no version → never fires upgradeneeded, never mutates.
                const req = indexedDB.open(d.name);
                req.onsuccess = () => {
                  clearTimeout(guard);
                  const db = req.result;
                  const stores = Array.from(db.objectStoreNames);
                  db.close();
                  res({ name: d.name, version: d.version, objectStores: stores });
                };
                req.onerror = () => {
                  clearTimeout(guard);
                  res({ name: d.name, version: d.version, objectStores: [] });
                };
              }),
          ),
        ),
      };
    }
  } catch {
    indexedDb = { supported: false };
  }

  let cacheStorage: any = { supported: false };
  try {
    if (typeof caches !== 'undefined') cacheStorage = { supported: true, names: await caches.keys() };
  } catch {
    cacheStorage = { supported: false };
  }

  return {
    origin: location.origin,
    localStorage: dumpWebStorage(localStorage),
    sessionStorage: dumpWebStorage(sessionStorage),
    cookieNames: cookies,
    cookieNote: 'Names only; HttpOnly cookies (usually the session/auth ones) are invisible to JavaScript.',
    indexedDb,
    cacheStorage,
  };
}

async function handle(msg: any): Promise<any> {
  switch (msg.op) {
    case 'snapshot':
      return snapshot();

    case 'click': {
      const el = resolve(msg.ref);
      await showThen('clicking', el, nameOf(el));
      fireClick(el);
      return { clicked: msg.ref };
    }

    case 'type': {
      const el = resolve(msg.ref);
      await showThen('typing', el, String(msg.text ?? '').slice(0, 40));
      setValue(el, String(msg.text ?? ''));
      if (msg.submit) {
        const key = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, composed: true };
        const notCancelled = el.dispatchEvent(new KeyboardEvent('keydown', { ...key, cancelable: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', key));
        // Mirror the browser's own implicit-submission rule: submit the form
        // only if nothing cancelled the keydown. An app that handles Enter
        // itself (and preventDefaults) would otherwise fire twice.
        if (notCancelled) (el as HTMLInputElement).form?.requestSubmit?.();
      }
      return { typed: msg.ref, submitted: !!msg.submit };
    }

    case 'select': {
      const el = resolve(msg.ref) as HTMLSelectElement;
      if (!(el instanceof HTMLSelectElement)) {
        throw Object.assign(new Error('element is not a <select>'), { code: 'not_editable' });
      }
      await showThen('selecting', el, String(msg.value ?? '').slice(0, 40));
      el.value = String(msg.value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { selected: msg.value };
    }

    case 'read':
      return readPage(msg.selector, Number(msg.maxChars) || 10_000);

    case 'console':
      // Page console/errors are captured MAIN-world side; pull them over the
      // injected-script bridge (bex_console).
      return getPageConsole({ level: msg.level, pattern: msg.pattern, since: msg.since, limit: msg.limit });

    case 'network':
      return pullObs('network', { pattern: msg.pattern, since: msg.since, limit: msg.limit, status: msg.status });

    case 'perf':
      return pullObs('perf', {});

    case 'storage':
      return readStorage();

    case 'overlay':
      await overlaySetVisible(msg.show !== false);
      return { overlay: msg.show !== false };

    // The transparency floor: the background announces every page-touching tool
    // here BEFORE running it, so reads and captures are as visible as clicks.
    case 'announce':
      overlayAnnounce(String(msg.kind ?? 'working'), String(msg.detail ?? ''));
      panelLog(msg.detail ? `${msg.kind}: ${msg.detail}` : String(msg.kind ?? 'working'));
      return { announced: msg.kind ?? 'working' };

    case 'panel': {
      if (msg.action === 'hide') {
        overlayEndSession();
        panelHide();
        return { panel: 'hidden' };
      }
      if (msg.message != null || msg.level) {
        panelStatus(String(msg.message ?? ''), msg.level ?? 'info');
        // 'done' is the agent saying it has stopped driving — drop the banner
        // now rather than leaving it up until the safety timer expires.
        if (msg.level === 'done') overlayEndSession();
      } else panelShow();
      return { panel: 'shown' };
    }

    case 'find':
      // Search the snapshot page-side and return only the hits, so the agent can
      // locate one button without pulling the whole tree into context.
      return findNodes(String(msg.text ?? ''), !!msg.regex);

    default:
      throw Object.assign(new Error(`unknown dom op: ${msg.op}`), { code: 'unknown_op' });
  }
}

export function installAgentDom(): void {
  chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
    if (msg?.type !== 'BEX_AGENT_DOM') return;
    handle(msg)
      .then(data => sendResponse({ ok: true, data }))
      .catch(e => sendResponse({ ok: false, code: e?.code ?? 'dom_error', message: e?.message || String(e) }));
    return true; // async sendResponse
  });
  console.log(TAG, 'agent DOM listener installed');
}
