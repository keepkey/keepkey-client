/**
 * consoleBridge — ISOLATED-world half of the `bex_console` page-console tool.
 *
 * The page's console is captured MAIN-world side (chrome-extension/src/injected/
 * consoleCapture.ts) and kept there. This asks for it on demand: post a
 * KEEPKEY_CONSOLE_GET, await the correlated KEEPKEY_CONSOLE_DATA reply. If the
 * injected script isn't present (capture never installed), it resolves empty
 * rather than hanging.
 */

export interface ConsoleFilter {
  level?: string;
  pattern?: string;
  since?: number;
  limit?: number;
}

const GET_TIMEOUT_MS = 3000;
let seq = 0;

export function getPageConsole(filter: ConsoleFilter = {}): Promise<{ entries: any[]; captured: boolean }> {
  return new Promise(resolve => {
    const requestId = `kkc-${Date.now()}-${seq++}`;
    let done = false;

    const finish = (entries: any[], captured: boolean) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      resolve({ entries, captured });
    };

    const onMessage = (ev: MessageEvent) => {
      if (ev.source !== window) return;
      const d = ev.data;
      if (!d || d.source !== 'keepkey-injected' || d.type !== 'KEEPKEY_CONSOLE_DATA' || d.requestId !== requestId)
        return;
      finish(Array.isArray(d.entries) ? d.entries : [], true);
    };

    // No reply within the window → the injected capture isn't there. Report it
    // as not-captured rather than an empty page so the agent can tell the
    // difference between "no logs" and "capture unavailable".
    const timer = setTimeout(() => finish([], false), GET_TIMEOUT_MS);

    window.addEventListener('message', onMessage);
    window.postMessage(
      { source: 'keepkey-content', type: 'KEEPKEY_CONSOLE_GET', requestId, filter },
      window.location.origin,
    );
  });
}
