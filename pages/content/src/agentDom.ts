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

const TAG = ' | agentDom | ';

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

/** ref → element, re-minted per snapshot. Stale refs fail with stale_ref. */
const refs = new Map<string, Element>();
let refSeq = 0;

// Elements a user can actually act on. Kept explicit rather than a broad
// `[role]` sweep, which drags in every role="presentation" wrapper.
const INTERACTIVE = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="tab"]',
  '[role="switch"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="combobox"]',
  '[role="textbox"]',
  '[role="searchbox"]',
  '[role="slider"]',
].join(',');

// Non-interactive elements worth keeping for orientation — without these a
// snapshot is a pile of buttons with no indication of what page you're on.
const CONTEXT = 'h1,h2,h3,h4,h5,h6,[role="heading"]';

const INPUT_ROLES: Record<string, string> = {
  checkbox: 'checkbox',
  radio: 'radio',
  button: 'button',
  submit: 'button',
  reset: 'button',
  image: 'button',
  range: 'slider',
  file: 'file',
  search: 'searchbox',
};

/**
 * Walk element children AND open shadow roots. Web3 UI kits (web3modal's
 * <w3m-modal>, most Lit-based connect flows) put their whole tree in shadow DOM,
 * so a plain querySelectorAll returns nothing for exactly the dialogs an agent
 * most needs to drive. Closed roots stay invisible — nothing we can do there.
 */
function deepQuery(root: ParentNode, selector: string, out: Element[] = []): Element[] {
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (el.matches(selector)) out.push(el);
    const sr = (el as HTMLElement).shadowRoot;
    if (sr) deepQuery(sr, selector, out);
  }
  return out;
}

function isVisible(el: Element): boolean {
  const style = window.getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  if (el.closest('[aria-hidden="true"]')) return false;
  return true;
}

function roleOf(el: Element): string {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') return 'link';
  if (tag === 'button' || tag === 'summary') return 'button';
  if (tag === 'select') return 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'input') {
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
    return INPUT_ROLES[type] ?? 'textbox';
  }
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (el.hasAttribute('contenteditable')) return 'textbox';
  return 'generic';
}

/**
 * Accessible-name approximation, in roughly the precedence order the real
 * accname spec uses. Not spec-complete (no aria-describedby fallback, no
 * text-alternative recursion) — good enough to name a button.
 */
function nameOf(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria?.trim()) return aria.trim();

  // Resolve id references against the element's own root, not ownerDocument:
  // ids inside a shadow root are scoped to it, so ownerDocument would miss them
  // entirely — or, worse, find an unrelated same-id element in the main
  // document and mislabel the field.
  const root = el.getRootNode() as Document | ShadowRoot;

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map(id => root.getElementById?.(id)?.textContent ?? '')
      .join(' ')
      .trim();
    if (text) return text;
  }

  if (el.id) {
    const label = root.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }
  const wrapping = el.closest('label');
  if (wrapping?.textContent?.trim()) return wrapping.textContent.trim();

  for (const attr of ['placeholder', 'alt', 'title', 'name']) {
    const v = el.getAttribute(attr);
    if (v?.trim()) return v.trim();
  }

  const text = (el as HTMLElement).innerText ?? el.textContent ?? '';
  return text.trim();
}

const clip = (s: string, max = 120) => (s.length > max ? `${s.slice(0, max)}…` : s);

interface SnapNode {
  ref?: string;
  role: string;
  name: string;
  value?: string;
  disabled?: boolean;
  checked?: boolean;
  level?: number;
}

function snapshot(): { url: string; title: string; nodes: SnapNode[] } {
  refs.clear();
  refSeq = 0;

  const found = deepQuery(document, `${INTERACTIVE},${CONTEXT}`);
  const nodes: SnapNode[] = [];

  for (const el of found) {
    if (!isVisible(el)) continue;
    const role = roleOf(el);
    const name = clip(nameOf(el).replace(/\s+/g, ' '));
    const isContext = el.matches(CONTEXT);

    // An unnamed heading is noise; an unnamed BUTTON is still clickable and the
    // agent may need it (icon-only close buttons are the common case), so it
    // stays with an empty name.
    if (isContext && !name) continue;

    const node: SnapNode = { role, name };

    if (isContext) {
      const lvl = Number(el.getAttribute('aria-level') ?? el.tagName.slice(1));
      if (Number.isFinite(lvl)) node.level = lvl;
    } else {
      const ref = `e${++refSeq}`;
      refs.set(ref, el);
      node.ref = ref;
      const input = el as HTMLInputElement;
      if (input.value != null && typeof input.value === 'string' && input.value) node.value = clip(input.value, 60);
      if (isDisabled(el)) node.disabled = true;
      // aria-checked first: dApp toggles are usually a styled div with a role,
      // not a real <input>, so .checked would silently miss them.
      const ariaChecked = el.getAttribute('aria-checked');
      if (ariaChecked === 'true' || ariaChecked === 'false') node.checked = ariaChecked === 'true';
      else if (typeof input.checked === 'boolean' && (role === 'checkbox' || role === 'radio'))
        node.checked = input.checked;
    }

    nodes.push(node);
  }

  return { url: location.href, title: document.title, nodes };
}

function resolve(ref: string): Element {
  const el = refs.get(ref);
  if (!el) {
    throw Object.assign(new Error(`ref ${ref} is not in the current snapshot — take a fresh bex_snapshot`), {
      code: 'stale_ref',
    });
  }
  if (!el.isConnected) {
    throw Object.assign(new Error(`ref ${ref} has been removed from the page — take a fresh bex_snapshot`), {
      code: 'stale_ref',
    });
  }
  return el;
}

/**
 * Dispatch a full pointer sequence, not just el.click(). Radix, Headless UI and
 * most modern dialog kits (i.e. every wallet-connect modal worth testing) listen
 * on pointerdown/mousedown and never see a bare click().
 *
 * ponytail: these events are isTrusted=false. React/Vue/Radix don't care, so
 * this covers the dApp surface we test. A site that explicitly gates on
 * isTrusted needs the `debugger` permission and Input.dispatchMouseEvent.
 */
function isDisabled(el: Element): boolean {
  return (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true';
}

function fireClick(el: Element): void {
  // dispatchEvent bypasses the disabled check that stops a native click, so
  // without this guard an agent could fire a handler no user could reach — and
  // "the Swap button is disabled until you enter an amount" is exactly the kind
  // of gating this tool exists to verify. Refusing keeps agent runs honest.
  if (isDisabled(el)) {
    throw Object.assign(new Error(`element is disabled — a user could not click it`), { code: 'element_disabled' });
  }
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const rect = el.getBoundingClientRect();
  const base = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  };
  const pointer = { ...base, pointerId: 1, isPrimary: true, pointerType: 'mouse' };
  el.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, button: 0, buttons: 1 }));
  el.dispatchEvent(new MouseEvent('mousedown', { ...base, button: 0, buttons: 1 }));
  (el as HTMLElement).focus?.();
  el.dispatchEvent(new PointerEvent('pointerup', { ...pointer, button: 0, buttons: 0 }));
  el.dispatchEvent(new MouseEvent('mouseup', { ...base, button: 0, buttons: 0 }));
  el.dispatchEvent(new MouseEvent('click', { ...base, button: 0, buttons: 0, detail: 1 }));
}

/**
 * Set a value the way a user would, as far as a framework can tell. Assigning
 * .value directly is invisible to React — it tracks the last value it wrote on
 * the node and dedupes, so the input event looks like a no-op. Going through the
 * prototype's native setter defeats that tracker. Well-worn trick; not ours.
 */
function setValue(el: Element, text: string): void {
  if (isDisabled(el) || (el as HTMLInputElement).readOnly) {
    throw Object.assign(new Error('field is disabled or read-only — a user could not type here'), {
      code: 'element_disabled',
    });
  }
  (el as HTMLElement).focus?.();
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, text);
    else el.value = text;
  } else if (el.hasAttribute('contenteditable')) {
    (el as HTMLElement).innerText = text;
  } else {
    throw Object.assign(new Error(`element is a ${roleOf(el)}, not a text field`), { code: 'not_editable' });
  }
  el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
}

function readPage(selector: string | undefined, maxChars: number): { text: string; truncated: boolean } {
  const root = selector ? document.querySelector(selector) : (document.querySelector('main') ?? document.body);
  if (!root) throw Object.assign(new Error(`no element matches ${selector}`), { code: 'not_found' });
  const full = ((root as HTMLElement).innerText ?? root.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
  return { text: full.slice(0, maxChars), truncated: full.length > maxChars };
}

async function handle(msg: any): Promise<any> {
  switch (msg.op) {
    case 'snapshot':
      return snapshot();

    case 'click':
      fireClick(resolve(msg.ref));
      return { clicked: msg.ref };

    case 'type': {
      const el = resolve(msg.ref);
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

    case 'find': {
      // Search the snapshot page-side and return only the hits, so the agent can
      // locate one button without pulling the whole tree into context.
      const snap = snapshot();
      const needle = String(msg.text ?? '');
      const re = msg.regex ? new RegExp(needle, 'i') : null;
      const hit = (n: SnapNode) => (re ? re.test(n.name) : n.name.toLowerCase().includes(needle.toLowerCase()));
      return { url: snap.url, title: snap.title, nodes: snap.nodes.filter(hit) };
    }

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
