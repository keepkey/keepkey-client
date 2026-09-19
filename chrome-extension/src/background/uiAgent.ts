/**
 * uiAgent — background half of bex_ui: the agent's view of the KeepKey UI
 * itself (side panel or a KeepKey window).
 *
 * Every open KeepKey UI connects a named port and says where it lives
 * (pages/side-panel/src/agentUi.ts). This registry is therefore the truth about
 * "is the wallet UI open, where, and what is it showing" — no guessing from
 * tabs, no broadcast where the first responder wins.
 *
 * Opening: chrome.sidePanel.open() needs a real user gesture, which an agent
 * never has. `open` launches the same app in its own KeepKey window instead;
 * approvals render there exactly as in the panel (same storage subscription).
 *
 * Read-only: needs only Agent mode (the bridge is only up then). Deciding a
 * request is bex_request's job, not a click here.
 */
import { captureWindow, formatSnapshot } from './browserTools';

const TAG = ' | uiAgent | ';
const PORT_NAME = 'keepkey-agent-ui';
const CALL_TIMEOUT_MS = 10_000;
const OPEN_TIMEOUT_MS = 8_000;

type Surface = 'side_panel' | 'window' | 'tab';
interface UiInstance {
  port: chrome.runtime.Port;
  windowId: number;
  surface: Surface;
  tabId: number | null;
  url: string;
}

const instances = new Set<UiInstance>();
const pending = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void }>();
let seq = 0;

const err = (code: string, message: string) => Object.assign(new Error(message), { code });
const text = (t: string) => ({ content: [{ type: 'text', text: t }] });

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== PORT_NAME) return;
  let inst: UiInstance | null = null;
  port.onMessage.addListener((msg: any) => {
    if (msg?.type === 'hello') {
      inst = { port, windowId: msg.windowId, surface: msg.surface, tabId: msg.tabId, url: msg.url };
      instances.add(inst);
    } else if (msg?.type === 'result') {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.data);
      else p.reject(err(msg.code ?? 'ui_error', msg.message ?? 'UI operation failed'));
    }
  });
  port.onDisconnect.addListener(() => {
    if (inst) instances.delete(inst);
  });
});

function call(inst: UiInstance, op: string, payload: Record<string, unknown> = {}): Promise<any> {
  const id = `ui${++seq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(err('ui_timeout', `KeepKey UI in window ${inst.windowId} did not answer`));
    }, CALL_TIMEOUT_MS);
    pending.set(id, {
      resolve: v => (clearTimeout(timer), resolve(v)),
      reject: e => (clearTimeout(timer), reject(e)),
    });
    inst.port.postMessage({ type: 'call', id, op, ...payload });
  });
}

const describe = (i: UiInstance) => ({ windowId: i.windowId, surface: i.surface, tabId: i.tabId });

/** Pick the one UI a call targets: explicit windowId, the only one, or fail listing them. */
async function target(windowId?: number): Promise<UiInstance> {
  const all = [...instances];
  if (windowId != null) {
    const hit = all.find(i => i.windowId === windowId);
    if (!hit) throw err('ui_not_found', `no KeepKey UI open in window ${windowId}`);
    return hit;
  }
  if (all.length === 1) return all[0];
  if (all.length === 0) {
    throw err('ui_not_open', 'no KeepKey UI is open — call bex_ui with action=open (or open the side panel)');
  }
  throw err('ui_ambiguous', `${all.length} KeepKey UIs are open — pass windowId: ${JSON.stringify(all.map(describe))}`);
}

async function open(): Promise<UiInstance> {
  const existing = [...instances].find(i => i.surface === 'window');
  if (existing) {
    await chrome.windows.update(existing.windowId, { focused: true });
    return existing;
  }
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL('side-panel/index.html'),
    type: 'popup',
    width: 420,
    height: 820,
    focused: true,
  });
  // The page connects its port once React has booted; wait for it.
  const deadline = Date.now() + OPEN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const inst = [...instances].find(i => i.windowId === win.id);
    if (inst) return inst;
    await new Promise(r => setTimeout(r, 100));
  }
  throw err('ui_timeout', `KeepKey window ${win.id} opened but its UI did not connect`);
}

export const UI_TOOL = {
  name: 'bex_ui',
  description:
    "See the KeepKey wallet's OWN UI (side panel or a KeepKey window) — what the user is shown, e.g. an approval card. Read-only: decide requests with bex_request. " +
    'status: which KeepKey UIs are open and what screen each shows. open: open (or focus) a KeepKey window — use this when nothing is open, since Chrome only opens the side panel on a user click. ' +
    'snapshot/find/read: what the UI shows ([disabled] / [obscured] = a user could not click it). ' +
    'screenshot: KeepKey window only (Chrome cannot capture the side panel). close: close a KeepKey window. ' +
    'Pass windowId when more than one UI is open.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['status', 'open', 'snapshot', 'find', 'read', 'screenshot', 'close'],
      },
      windowId: { type: 'number' },
      text: { type: 'string', description: 'find: name to match' },
      regex: { type: 'boolean' },
      maxChars: { type: 'number' },
    },
    required: ['action'],
    additionalProperties: false,
  },
};

export async function executeUiTool(args: any): Promise<any> {
  const action = args?.action;
  switch (action) {
    case 'status': {
      const uis = await Promise.all(
        [...instances].map(async i => {
          try {
            return { ...describe(i), ...(await call(i, 'status')) };
          } catch (e: any) {
            return { ...describe(i), error: e?.message };
          }
        }),
      );
      return { open: uis.length > 0, uis };
    }
    case 'open': {
      const inst = await open();
      return { ...describe(inst), ...(await call(inst, 'status')) };
    }
    case 'snapshot':
      return text(formatSnapshot(await call(await target(args.windowId), 'snapshot')));
    case 'find':
      return text(
        formatSnapshot(await call(await target(args.windowId), 'find', { text: args.text, regex: args.regex })),
      );
    case 'read':
      return call(await target(args.windowId), 'read', { maxChars: args.maxChars });
    case 'screenshot': {
      const inst = await target(args.windowId);
      if (inst.surface === 'side_panel') {
        throw err(
          'uncapturable_surface',
          'Chrome cannot capture the side panel — use snapshot/read, or bex_ui open for a capturable KeepKey window',
        );
      }
      if (inst.tabId != null) await chrome.tabs.update(inst.tabId, { active: true });
      return captureWindow(inst.windowId);
    }
    case 'close': {
      const inst = await target(args.windowId);
      if (inst.surface !== 'window') throw err('not_closable', 'only a KeepKey window (bex_ui open) can be closed');
      await chrome.windows.remove(inst.windowId);
      return { closed: inst.windowId };
    }
    default:
      throw err('unknown_action', `bex_ui has no action ${action}`);
  }
}

console.log(TAG, 'KeepKey UI agent port listener installed');
