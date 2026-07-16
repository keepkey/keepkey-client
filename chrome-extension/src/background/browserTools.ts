/**
 * browserTools — the `bex_*` browser-driving MCP tools.
 *
 * Why these live in the extension rather than in a Playwright/Puppeteer MCP: the
 * whole point of this extension is the wallet, and a launched-fresh browser has
 * no wallet in it. Driving the user's REAL Chrome means the agent tests the dApp
 * against the real extension, the real vault pairing and the real device — and
 * the existing bex_pending_requests / bex_logs tools observe the same session
 * from the inside. That combination is the thing no general-purpose browser MCP
 * can do, and it's the only reason this is worth building at all.
 *
 * ponytail: Playwright/Puppeteer are not options here even if we wanted them —
 * the background bundles to one IIFE with no Node builtins (no `net`), so they
 * cannot run in-extension at all. chrome.tabs + a content script cover this with
 * zero new dependencies and, notably, zero new permissions: `<all_urls>` and
 * `tabs` are already granted (manifest.js:39-40) and the content script is
 * already at document_start on every http/https page.
 *
 * Contract with the DOM half (pages/content/src/agentDom.ts): one message per
 * op, refs minted page-side. See that file for why refs beat selectors.
 */

// captureVisibleTab captures at devicePixelRatio, so a retina display yields a
// 2560px-wide image — and Claude bills images by PIXELS, not bytes (~w*h/750
// tokens). Downscaling to 1024 wide is a ~4x token cut for no practical loss of
// legibility. This is the single biggest token lever in the whole tool set.
const SCREENSHOT_MAX_WIDTH = 1024;
const SCREENSHOT_QUALITY = 60;
const LOAD_TIMEOUT_MS = 20_000;

const err = (code: string, message: string) => Object.assign(new Error(message), { code });

/** MCP content blocks — the vault passes these through verbatim (see HANDOFF). */
type Content = { content: Array<Record<string, unknown>> };
const text = (t: string): Content => ({ content: [{ type: 'text', text: t }] });

export const BROWSER_TOOLS = [
  {
    name: 'bex_tabs',
    description:
      "List, create, close, or focus browser tabs in the user's real Chrome. action=list returns each tab's id, url, title and whether it is active.",
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'create', 'close', 'select'], description: 'Default: list' },
        tabId: { type: 'number', description: 'Target tab for close/select' },
        url: { type: 'string', description: 'URL for create' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'bex_navigate',
    description: 'Navigate a tab to a URL and wait for it to finish loading. Omit tabId to use the active tab.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        tabId: { type: 'number' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'bex_snapshot',
    description:
      'Accessibility snapshot of the page: every visible interactive element with a stable [ref=eN] handle, plus headings for orientation. THIS is what you act on — pass a ref to bex_click / bex_type / bex_select. Refs are re-minted on each snapshot, so re-snapshot after anything that changes the page.',
    inputSchema: {
      type: 'object',
      properties: { tabId: { type: 'number' } },
      additionalProperties: false,
    },
  },
  {
    name: 'bex_find',
    description:
      'Search the page snapshot for elements whose accessible name matches, returning only the hits with their refs. Use this instead of bex_snapshot when you already know what you are looking for — it keeps a large page out of your context.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Substring (case-insensitive) or regex source if regex=true' },
        regex: { type: 'boolean' },
        tabId: { type: 'number' },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'bex_click',
    description:
      'Click an element by its snapshot ref. Dispatches a full pointer sequence, so modal/dropdown kits that listen on pointerdown work.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'A ref from the latest bex_snapshot, e.g. "e12"' },
        element: {
          type: 'string',
          description: 'Human-readable description of what you are clicking, for the audit trail',
        },
        tabId: { type: 'number' },
      },
      required: ['ref', 'element'],
      additionalProperties: false,
    },
  },
  {
    name: 'bex_type',
    description:
      'Type text into a textbox by its snapshot ref, replacing any current value. Set submit=true to press Enter afterwards.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string' },
        element: { type: 'string', description: 'Human-readable description of the field' },
        text: { type: 'string' },
        submit: { type: 'boolean' },
        tabId: { type: 'number' },
      },
      required: ['ref', 'element', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'bex_select',
    description: 'Choose an option in a <select> by its snapshot ref.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string' },
        element: { type: 'string' },
        value: { type: 'string' },
        tabId: { type: 'number' },
      },
      required: ['ref', 'element', 'value'],
      additionalProperties: false,
    },
  },
  {
    name: 'bex_read_page',
    description:
      'Rendered text of the page (defaults to <main>, else <body>). Use this to assert on content — balances, error banners, quoted amounts. Scope with a CSS selector to keep it small.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector to scope the read' },
        maxChars: { type: 'number', description: 'Default 10000' },
        tabId: { type: 'number' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'bex_screenshot',
    description:
      "JPEG of the tab's visible viewport, for VISUAL verification only — you cannot act on a screenshot. Use bex_snapshot to find things to click. Focuses the tab as a side effect (Chrome can only capture a visible tab).",
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number' },
        quality: { type: 'number', description: 'JPEG quality 1-100, default 60' },
      },
      additionalProperties: false,
    },
  },
];

async function activeTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw err('no_active_tab', 'no active tab in the last focused window');
  return tab;
}

async function resolveTab(tabId?: number): Promise<chrome.tabs.Tab> {
  if (tabId == null) return activeTab();
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    throw err('tab_not_found', `no tab with id ${tabId}`);
  }
}

/** Ask the page-side agentDom to do something, and normalize its failures. */
async function dom(tabId: number, op: string, payload: Record<string, unknown> = {}): Promise<any> {
  let res: any;
  try {
    res = await chrome.tabs.sendMessage(tabId, { type: 'BEX_AGENT_DOM', op, ...payload });
  } catch {
    // No content script in this tab. Either it predates the extension load, or
    // it's a chrome:// / Web Store / PDF page where content scripts never run.
    throw err(
      'no_content_script',
      `cannot reach tab ${tabId} — reload the page (or use bex_navigate); chrome:// and Web Store pages can never be driven`,
    );
  }
  if (!res) throw err('no_content_script', `tab ${tabId} did not answer — reload the page`);
  if (!res.ok) throw err(res.code ?? 'dom_error', res.message ?? 'DOM operation failed');
  return res.data;
}

/**
 * Resolve once `tabId` finishes loading.
 *
 * Call this BEFORE triggering the navigation — the listener attaches
 * synchronously, so starting the wait first is what closes the race where a
 * fast page (cache hit, localhost) fires `complete` before we're listening and
 * strands us on the timeout.
 *
 * `settledIsDone` is for a freshly created tab, which may already be finished by
 * the time we learn its id. Do NOT set it for a navigate: there the OLD page is
 * still `complete`, and we'd resolve instantly on the page we're leaving.
 */
function waitForLoad(tabId: number, { settledIsDone = false } = {}): Promise<void> {
  return new Promise(resolve => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    };
    // Resolve rather than reject on timeout: a page that never fires `complete`
    // (long-polling, hung analytics beacon) is usually still perfectly drivable,
    // and failing the navigate outright would be worse than proceeding.
    const timer = setTimeout(done, LOAD_TIMEOUT_MS);
    const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === 'complete') done();
    };
    chrome.tabs.onUpdated.addListener(listener);
    if (settledIsDone) {
      chrome.tabs
        .get(tabId)
        .then(t => {
          if (t.status === 'complete') done();
        })
        .catch(done); // tab vanished — nothing left to wait for
    }
  });
}

/** Render a snapshot as indented text — far cheaper than JSON, which repeats every key. */
function formatSnapshot(snap: { url: string; title: string; nodes: any[] }): string {
  const lines = [`page ${snap.url} — ${JSON.stringify(snap.title)}`];
  for (const n of snap.nodes) {
    let line = `- ${n.role} ${JSON.stringify(n.name)}`;
    if (n.ref) line += ` [ref=${n.ref}]`;
    if (n.level) line += ` [level=${n.level}]`;
    if (n.value) line += ` value=${JSON.stringify(n.value)}`;
    if (n.checked != null) line += n.checked ? ' [checked]' : ' [unchecked]';
    if (n.disabled) line += ' [disabled]';
    lines.push(line);
  }
  if (snap.nodes.length === 0) lines.push('(no visible interactive elements — page may still be loading)');
  return lines.join('\n');
}

async function screenshot(tab: chrome.tabs.Tab, quality: number): Promise<Content> {
  // Chrome can only capture the ACTIVE tab of a window, so focus it first. This
  // is a visible side effect and is called out in the tool description.
  if (!tab.active && tab.id != null) await chrome.tabs.update(tab.id, { active: true });
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId!, { format: 'jpeg', quality });

  const binary = atob(dataUrl.split(',')[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
  const scale = Math.min(1, SCREENSHOT_MAX_WIDTH / bitmap.width);
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: quality / 100 });
  const out = new Uint8Array(await blob.arrayBuffer());
  let str = '';
  for (let i = 0; i < out.length; i++) str += String.fromCharCode(out[i]);

  return { content: [{ type: 'image', data: btoa(str), mimeType: 'image/jpeg' }] };
}

export function isBrowserTool(name: string): boolean {
  return BROWSER_TOOLS.some(t => t.name === name);
}

export async function executeBrowserTool(tool: string, args: any): Promise<any> {
  switch (tool) {
    case 'bex_tabs': {
      const action = args?.action ?? 'list';
      if (action === 'create') {
        const tab = await chrome.tabs.create({ url: args?.url, active: true });
        if (args?.url && tab.id != null) await waitForLoad(tab.id, { settledIsDone: true });
        return { tabId: tab.id, url: tab.url };
      }
      if (action === 'close') {
        const tab = await resolveTab(args?.tabId);
        await chrome.tabs.remove(tab.id!);
        return { closed: tab.id };
      }
      if (action === 'select') {
        const tab = await resolveTab(args?.tabId);
        await chrome.tabs.update(tab.id!, { active: true });
        await chrome.windows.update(tab.windowId!, { focused: true });
        return { selected: tab.id };
      }
      const tabs = await chrome.tabs.query({});
      return {
        tabs: tabs.map(t => ({ tabId: t.id, url: t.url, title: t.title, active: t.active, windowId: t.windowId })),
      };
    }

    case 'bex_navigate': {
      if (!args?.url) throw err('bad_args', 'url is required');
      const tab = await resolveTab(args?.tabId);
      const loaded = waitForLoad(tab.id!); // start listening BEFORE navigating
      await chrome.tabs.update(tab.id!, { url: args.url });
      await loaded;
      const after = await chrome.tabs.get(tab.id!);
      return { tabId: after.id, url: after.url, title: after.title };
    }

    case 'bex_snapshot': {
      const tab = await resolveTab(args?.tabId);
      return text(formatSnapshot(await dom(tab.id!, 'snapshot')));
    }

    case 'bex_find': {
      const tab = await resolveTab(args?.tabId);
      const snap = await dom(tab.id!, 'find', { text: args?.text, regex: !!args?.regex });
      if (snap.nodes.length === 0) {
        return text(`no elements match ${JSON.stringify(args?.text)} on ${snap.url}`);
      }
      return text(formatSnapshot(snap));
    }

    case 'bex_click': {
      const tab = await resolveTab(args?.tabId);
      if (!args?.ref) throw err('bad_args', 'ref is required');
      return dom(tab.id!, 'click', { ref: args.ref });
    }

    case 'bex_type': {
      const tab = await resolveTab(args?.tabId);
      if (!args?.ref) throw err('bad_args', 'ref is required');
      return dom(tab.id!, 'type', { ref: args.ref, text: args.text, submit: !!args.submit });
    }

    case 'bex_select': {
      const tab = await resolveTab(args?.tabId);
      if (!args?.ref) throw err('bad_args', 'ref is required');
      return dom(tab.id!, 'select', { ref: args.ref, value: args.value });
    }

    case 'bex_read_page': {
      const tab = await resolveTab(args?.tabId);
      const res = await dom(tab.id!, 'read', { selector: args?.selector, maxChars: args?.maxChars });
      return text(res.truncated ? `${res.text}\n\n[truncated — raise maxChars or scope with selector]` : res.text);
    }

    case 'bex_screenshot': {
      const tab = await resolveTab(args?.tabId);
      const quality = Math.min(100, Math.max(1, Number(args?.quality) || SCREENSHOT_QUALITY));
      return screenshot(tab, quality);
    }

    default:
      throw err('unknown_tool', `unknown browser tool: ${tool}`);
  }
}
