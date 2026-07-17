/**
 * consoleCapture — MAIN-world page console/error hook for the `bex_console` MCP tool.
 *
 * The extension's content script runs in the ISOLATED world and cannot see the
 * page's `console.*`, `window.onerror`, or `unhandledrejection`. This module
 * runs inside the injected wallet script (MAIN world), so it can. It keeps a
 * bounded ring buffer IN PAGE MEMORY and only ships it to the content script on
 * demand (pull) — a `KEEPKEY_CONSOLE_GET` request over the existing postMessage
 * bridge. Nothing is posted per log line, so a chatty page costs nothing until
 * an agent actually asks.
 *
 * Limitation: it captures from injection onward. Logs the page fired before this
 * script executed are unrecoverable without chrome.debugger (which the extension
 * deliberately refuses — it would flag the wallet as "being debugged").
 */

const MAX_ENTRIES = 500;
const MAX_ENTRY_CHARS = 2000;
const LEVELS = ['log', 'info', 'warn', 'error', 'debug'] as const;
type Level = (typeof LEVELS)[number] | 'error-event' | 'unhandledrejection';

interface ConsoleEntry {
  ts: number;
  level: Level;
  text: string;
  url?: string; // for uncaught errors: file:line:col
}

const buffer: ConsoleEntry[] = [];

function push(level: Level, text: string, url?: string) {
  buffer.push({ ts: Date.now(), level, text: text.slice(0, MAX_ENTRY_CHARS), url });
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
}

/** Best-effort one-line rendering of an arbitrary console argument; never throws. */
function render(arg: unknown): string {
  try {
    if (typeof arg === 'string') return arg;
    if (arg === null) return 'null';
    if (arg === undefined) return 'undefined';
    const t = typeof arg;
    if (t === 'number' || t === 'boolean') return String(arg);
    if (t === 'bigint') return `${String(arg)}n`;
    if (t === 'function') return `[Function ${(arg as any).name || 'anonymous'}]`;
    if (t === 'symbol') return String(arg);
    if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
    if (typeof (arg as any).nodeName === 'string') return `[<${(arg as any).nodeName.toLowerCase()}>]`;
    const seen = new WeakSet();
    return (
      JSON.stringify(
        arg,
        (_k, v) => {
          if (typeof v === 'bigint') return `${String(v)}n`;
          if (typeof v === 'function') return `[Function]`;
          if (v && typeof v === 'object') {
            if (seen.has(v)) return '[Circular]';
            seen.add(v);
          }
          return v;
        },
        0,
      ) ?? String(arg)
    );
  } catch {
    return '[unserializable]';
  }
}

function filtered(filter?: { level?: string; pattern?: string; since?: number; limit?: number }): ConsoleEntry[] {
  let out = buffer;
  if (filter?.since) out = out.filter(e => e.ts >= filter.since!);
  if (filter?.level) out = out.filter(e => e.level === filter.level);
  if (filter?.pattern) {
    let re: RegExp | null = null;
    try {
      re = new RegExp(filter.pattern, 'i');
    } catch {
      re = null;
    }
    if (re) out = out.filter(e => re!.test(e.text));
  }
  const limit = filter?.limit ?? 100;
  return out.slice(-limit);
}

let installed = false;

export function installConsoleCapture(): void {
  if (installed) return;
  installed = true;

  for (const level of LEVELS) {
    // Bind the original up front so the wrapped console never re-enters itself.
    const orig = (console as any)[level]?.bind(console) ?? (() => {});
    (console as any)[level] = (...args: any[]) => {
      // Buffer first, then pass through so the real console still shows it.
      try {
        push(level, args.map(render).join(' '));
      } catch {
        /* capture must never break the page's logging */
      }
      orig(...args);
    };
  }

  window.addEventListener('error', ev => {
    const where = ev.filename ? `${ev.filename}:${ev.lineno}:${ev.colno}` : undefined;
    push('error-event', ev.message || String(ev.error ?? 'Error'), where);
  });
  window.addEventListener('unhandledrejection', ev => {
    const r: any = ev.reason;
    push('unhandledrejection', r instanceof Error ? `${r.name}: ${r.message}` : render(r));
  });

  // Answer on-demand pulls from the content script. Correlated by requestId so
  // concurrent asks don't cross. Origin-checked like the wallet bridge.
  window.addEventListener('message', ev => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.source !== 'keepkey-content' || d.type !== 'KEEPKEY_CONSOLE_GET') return;
    window.postMessage(
      { source: 'keepkey-injected', type: 'KEEPKEY_CONSOLE_DATA', requestId: d.requestId, entries: filtered(d.filter) },
      window.location.origin,
    );
  });
}
