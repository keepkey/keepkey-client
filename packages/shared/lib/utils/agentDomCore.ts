/**
 * agentDomCore — the DOM half of the bex_* agent tools, shared by every surface
 * an agent drives: web pages (pages/content agentDom.ts, via the content
 * script) and the KeepKey UI itself (side panel / KeepKey window, bex_ui).
 * One implementation means the agent sees and acts on the wallet's own screens
 * exactly the way it does on a dApp.
 *
 * Design follows the convention Playwright MCP and Chrome DevTools MCP arrived at
 * independently: an accessibility-shaped list of INTERACTIVE elements, each with
 * an opaque `ref` minted here. Refs are re-minted on every snapshot; a stale ref
 * fails loudly rather than hitting the wrong element.
 *
 * ponytail: role/name are approximated from the DOM instead of the real AX tree
 * via chrome.debugger — no `debugger` permission, no infobar. Upgrade path if
 * roles come out wrong: Accessibility.getFullAXTree.
 */

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

export function roleOf(el: Element): string {
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
export function nameOf(el: Element): string {
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

export interface SnapNode {
  ref?: string;
  role: string;
  name: string;
  value?: string;
  disabled?: boolean;
  checked?: boolean;
  level?: number;
  obscured?: boolean;
}

/**
 * Is something else painted over el's centre? That's what a user hits when a
 * sticky header covers a drawer's back button — the element is "visible" by
 * every style check yet unclickable. Only judged on-screen (off-screen elements
 * are scrolled into view before a click). Hit-testing honours pointer-events,
 * and uses el's own root so shadow-DOM kits hit-test inside their shadow tree.
 */
function isObscured(el: Element): boolean {
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return false;
  const root = el.getRootNode() as Document | ShadowRoot;
  const hit = (root.elementFromPoint ?? document.elementFromPoint).call(root, x, y);
  return !!hit && hit !== el && !el.contains(hit) && !hit.contains(el);
}

export function snapshot(): { url: string; title: string; nodes: SnapNode[] } {
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
      if (isObscured(el)) node.obscured = true;
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

export function resolve(ref: string): Element {
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
export function isDisabled(el: Element): boolean {
  return (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true';
}

export function fireClick(el: Element): void {
  // dispatchEvent bypasses the disabled check that stops a native click, so
  // without this guard an agent could fire a handler no user could reach — and
  // "the Swap button is disabled until you enter an amount" is exactly the kind
  // of gating this tool exists to verify. Refusing keeps agent runs honest.
  if (isDisabled(el)) {
    throw Object.assign(new Error(`element is disabled — a user could not click it`), { code: 'element_disabled' });
  }
  el.scrollIntoView({ block: 'center', inline: 'center' });
  // Same honesty rule as disabled: a user's click would land on whatever covers it.
  if (isObscured(el)) {
    throw Object.assign(new Error('element is covered by another element — a user could not click it'), {
      code: 'element_obscured',
    });
  }
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
export function setValue(el: Element, text: string): void {
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

export function readPage(selector: string | undefined, maxChars: number): { text: string; truncated: boolean } {
  const root = selector ? document.querySelector(selector) : (document.querySelector('main') ?? document.body);
  if (!root) throw Object.assign(new Error(`no element matches ${selector}`), { code: 'not_found' });
  const full = ((root as HTMLElement).innerText ?? root.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
  return { text: full.slice(0, maxChars), truncated: full.length > maxChars };
}

/** Snapshot filtered to nodes whose name matches — keeps big pages out of context. */
export function findNodes(text: string, regex?: boolean): { url: string; title: string; nodes: SnapNode[] } {
  const snap = snapshot();
  const re = regex ? new RegExp(text, 'i') : null;
  const hit = (n: SnapNode) => (re ? re.test(n.name) : n.name.toLowerCase().includes(text.toLowerCase()));
  return { url: snap.url, title: snap.title, nodes: snap.nodes.filter(hit) };
}
