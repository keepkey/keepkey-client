/**
 * obsBridge — ISOLATED-world pull for the bex_network / bex_perf tools. Asks the
 * MAIN-world pageObserver for a category's report over the postMessage bridge
 * and awaits the correlated reply. Resolves { captured:false } if the injected
 * observer isn't present, so the agent can tell "no data" from "unavailable".
 */

const GET_TIMEOUT_MS = 4000; // perf does a ~500ms rAF sample before replying
let seq = 0;

export function pullObs(
  category: 'network' | 'perf',
  filter: Record<string, unknown> = {},
): Promise<{ data: any; captured: boolean }> {
  return new Promise(resolve => {
    const requestId = `kko-${Date.now()}-${seq++}`;
    let done = false;
    const finish = (data: any, captured: boolean) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      resolve({ data, captured });
    };
    const onMessage = (ev: MessageEvent) => {
      if (ev.source !== window) return;
      const d = ev.data;
      if (!d || d.source !== 'keepkey-injected' || d.type !== 'KEEPKEY_OBS_DATA' || d.requestId !== requestId) return;
      finish(d.data, true);
    };
    const timer = setTimeout(() => finish(null, false), GET_TIMEOUT_MS);
    window.addEventListener('message', onMessage);
    window.postMessage(
      { source: 'keepkey-content', type: 'KEEPKEY_OBS_GET', requestId, category, filter },
      window.location.origin,
    );
  });
}
