/**
 * swConsole — captures the extension background service worker's own console
 * (console.log/info/warn/error/debug) into a ring buffer for the
 * `bex_ext_console` MCP tool.
 *
 * This is the raw SW console — the hundreds of diagnostics the background prints
 * — distinct from `bex_logs` (the structured provider request/response log) and
 * from `bex_console` (the web page's console). It's what you'd read in the
 * service worker's DevTools console, made queryable by an agent.
 *
 * Installed on import (side effect) so it hooks console before the rest of the
 * background logs anything. Wiped on MV3 SW restart, like providerLog; bex_status
 * exposes swStartedAt so an agent can detect the wipe.
 */

const MAX_ENTRIES = 500;
const MAX_ENTRY_CHARS = 2000;
const LEVELS = ['log', 'info', 'warn', 'error', 'debug'] as const;
type Level = (typeof LEVELS)[number];

interface SwLogEntry {
  ts: number;
  level: Level;
  text: string;
}

const buffer: SwLogEntry[] = [];

function render(arg: unknown): string {
  try {
    if (typeof arg === 'string') return arg;
    if (arg === null) return 'null';
    if (arg === undefined) return 'undefined';
    const t = typeof arg;
    if (t === 'number' || t === 'boolean') return String(arg);
    if (t === 'bigint') return `${String(arg)}n`;
    if (t === 'function') return `[Function ${(arg as any).name || 'anonymous'}]`;
    if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
    const seen = new WeakSet();
    return (
      JSON.stringify(
        arg,
        (_k, v) => {
          if (typeof v === 'bigint') return `${String(v)}n`;
          if (typeof v === 'function') return '[Function]';
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

export function getSwConsole(filter?: {
  level?: string;
  pattern?: string;
  since?: number;
  limit?: number;
}): SwLogEntry[] {
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

function install(): void {
  if (installed) return;
  installed = true;
  for (const level of LEVELS) {
    const orig = (console as any)[level]?.bind(console) ?? (() => {});
    (console as any)[level] = (...args: any[]) => {
      try {
        buffer.push({ ts: Date.now(), level, text: args.map(render).join(' ').slice(0, MAX_ENTRY_CHARS) });
        if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
      } catch {
        /* never break logging */
      }
      orig(...args);
    };
  }
}

install();
