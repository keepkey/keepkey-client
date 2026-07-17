/**
 * pageObserver — MAIN-world collectors for the bex_network and bex_perf MCP
 * tools. Runs inside the injected wallet script (the only extension code in the
 * page's main world) and, like consoleCapture, buffers in page memory and
 * answers on-demand pulls over the postMessage bridge — nothing is shipped per
 * event, so a chatty page costs nothing until an agent asks.
 *
 * network: fetch + XMLHttpRequest wrapped to record method/url/status/duration/
 *   failure. Resource Timing + Navigation Timing added at query time.
 * perf: PerformanceObservers accumulate Core Web Vitals + long tasks; memory,
 *   a short rAF FPS sample, and the WebGL GPU-identity string are read at query
 *   time.
 *
 * Honest limits (mirror these in the tool descriptions):
 *  - Captures from injection onward — the document fetch and any request/log
 *    before this script ran are unrecoverable without chrome.debugger, refused.
 *  - Cross-origin Resource Timing zeroes DNS/TCP/TLS/TTFB and byte sizes without
 *    a Timing-Allow-Origin header; the fetch/XHR interceptor still gives status
 *    + wall-clock duration there.
 *  - No response bodies/headers, no other realms (workers, cross-origin iframes).
 *  - performance.memory is Chrome-only + coarse; INP stays unsettled under
 *    synthetic clicks; GPU utilization/VRAM/temperature are simply not exposed.
 */

const NET_MAX = 300;
const ENTRY_CLIP = 2000;

interface NetEntry {
  ts: number;
  type: 'fetch' | 'xhr';
  method: string;
  url: string;
  status?: number;
  ok?: boolean;
  durationMs: number;
  error?: string;
}

const net: NetEntry[] = [];
function pushNet(e: NetEntry) {
  net.push(e);
  if (net.length > NET_MAX) net.splice(0, net.length - NET_MAX);
}

// ---- Core Web Vitals accumulators (updated by observers, read at query) ----
const vitals: {
  lcp?: number;
  cls: number;
  fcp?: number;
  ttfb?: number;
  inp?: number;
  longTasks: number;
  longTaskMs: number;
} = {
  cls: 0,
  longTasks: 0,
  longTaskMs: 0,
};

function clip(s: string): string {
  return s.length > ENTRY_CLIP ? s.slice(0, ENTRY_CLIP) + '…' : s;
}

function installNetwork() {
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (this: any, ...args: any[]) {
      const start = performance.now();
      const req = args[0];
      const url = typeof req === 'string' ? req : req?.url || String(req);
      const method = (args[1]?.method || (typeof req === 'object' && req?.method) || 'GET').toUpperCase();
      const p = origFetch.apply(this, args as any);
      p.then(
        (res: Response) =>
          pushNet({
            ts: Date.now(),
            type: 'fetch',
            method,
            url: clip(url),
            status: res.status,
            ok: res.ok,
            durationMs: Math.round(performance.now() - start),
          }),
        (err: any) =>
          pushNet({
            ts: Date.now(),
            type: 'fetch',
            method,
            url: clip(url),
            durationMs: Math.round(performance.now() - start),
            error: String(err?.message || err),
          }),
      );
      return p;
    } as any;
  }

  const XHR = window.XMLHttpRequest?.prototype;
  if (XHR) {
    const origOpen = XHR.open;
    const origSend = XHR.send;
    XHR.open = function (this: any, method: string, url: string, ...rest: any[]) {
      this.__kk = { method: String(method || 'GET').toUpperCase(), url: String(url) };
      return origOpen.apply(this, [method, url, ...rest] as any);
    };
    XHR.send = function (this: any, ...rest: any[]) {
      const meta = this.__kk;
      if (meta) {
        const start = performance.now();
        const done = (error?: string) =>
          pushNet({
            ts: Date.now(),
            type: 'xhr',
            method: meta.method,
            url: clip(meta.url),
            status: error ? undefined : this.status,
            ok: error ? undefined : this.status >= 200 && this.status < 400,
            durationMs: Math.round(performance.now() - start),
            error,
          });
        this.addEventListener('load', () => done());
        this.addEventListener('error', () => done('network error'));
        this.addEventListener('abort', () => done('aborted'));
        this.addEventListener('timeout', () => done('timeout'));
      }
      return origSend.apply(this, rest as any);
    };
  }
}

function installVitals() {
  const obs = (type: string, cb: (entries: any[]) => void, opts: any = {}) => {
    try {
      new PerformanceObserver(list => cb(list.getEntries())).observe({ type, buffered: true, ...opts });
    } catch {
      /* type unsupported in this browser — skip */
    }
  };
  obs('paint', entries => {
    const fcp = entries.find((e: any) => e.name === 'first-contentful-paint');
    if (fcp) vitals.fcp = Math.round(fcp.startTime);
  });
  obs('largest-contentful-paint', entries => {
    const last = entries[entries.length - 1] as any;
    if (last) vitals.lcp = Math.round(last.startTime);
  });
  obs('layout-shift', entries => {
    for (const e of entries as any[]) if (!e.hadRecentInput) vitals.cls += e.value;
  });
  obs(
    'event',
    entries => {
      for (const e of entries as any[]) vitals.inp = Math.max(vitals.inp ?? 0, Math.round(e.duration));
    },
    { durationThreshold: 40 },
  );
  obs('longtask', entries => {
    for (const e of entries as any[]) {
      vitals.longTasks += 1;
      vitals.longTaskMs += Math.round(e.duration);
    }
  });
  try {
    const nav = performance.getEntriesByType('navigation')[0] as any;
    if (nav) vitals.ttfb = Math.round(nav.responseStart);
  } catch {
    /* ignore */
  }
}

/** Short requestAnimationFrame sample → approximate current FPS + worst frame. */
function sampleFps(ms = 500): Promise<{ fps: number; longestFrameMs: number; frames: number }> {
  return new Promise(resolve => {
    const deltas: number[] = [];
    let last = performance.now();
    const start = last;
    const tick = (now: number) => {
      deltas.push(now - last);
      last = now;
      if (now - start < ms) requestAnimationFrame(tick);
      else {
        const frames = deltas.length;
        const longest = deltas.length ? Math.max(...deltas) : 0;
        const fps = frames ? Math.round((frames / (now - start)) * 1000) : 0;
        resolve({ fps, longestFrameMs: Math.round(longest), frames });
      }
    };
    requestAnimationFrame(tick);
  });
}

/** GPU identity (not load) via a throwaway WebGL context. Often masked. */
function gpuIdentity(): { vendor?: string; renderer?: string } {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl') || c.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return {};
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return {};
    return {
      vendor: gl.getParameter((ext as any).UNMASKED_VENDOR_WEBGL),
      renderer: gl.getParameter((ext as any).UNMASKED_RENDERER_WEBGL),
    };
  } catch {
    return {};
  }
}

function networkReport(filter: any) {
  let out = net;
  if (filter?.since) out = out.filter(e => e.ts >= filter.since);
  if (filter?.status === 'error') out = out.filter(e => e.error || (e.status && e.status >= 400));
  if (filter?.pattern) {
    let re: RegExp | null = null;
    try {
      re = new RegExp(filter.pattern, 'i');
    } catch {
      re = null;
    }
    if (re) out = out.filter(e => re!.test(`${e.method} ${e.url} ${e.status ?? ''} ${e.error ?? ''}`));
  }
  const limit = filter?.limit ?? 100;
  const requests = out.slice(-limit);

  let navigation: any;
  try {
    const nav = performance.getEntriesByType('navigation')[0] as any;
    if (nav)
      navigation = {
        ttfbMs: Math.round(nav.responseStart),
        domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
        loadMs: Math.round(nav.loadEventEnd),
        transferBytes: nav.transferSize,
        type: nav.type,
      };
  } catch {
    /* ignore */
  }
  return {
    requests,
    navigation,
    note: 'Captured from extension injection onward; response bodies/headers not included.',
  };
}

async function perfReport() {
  const fps = await sampleFps();
  const mem = (performance as any).memory;
  return {
    vitals: {
      lcpMs: vitals.lcp,
      cls: Math.round(vitals.cls * 1000) / 1000,
      fcpMs: vitals.fcp,
      ttfbMs: vitals.ttfb,
      inpMs: vitals.inp,
      note: 'LCP/CLS/INP are interim until the page settles; INP stays low/absent under synthetic clicks.',
    },
    rendering: {
      fps: fps.fps,
      longestFrameMs: fps.longestFrameMs,
      sampledFrames: fps.frames,
      longTasks: vitals.longTasks,
      longTaskTotalMs: vitals.longTaskMs,
      gpu: gpuIdentity(),
      note: 'fps is a main-thread-cadence proxy, not GPU load. GPU utilization/VRAM/temperature are not exposed to any page.',
    },
    memory: mem
      ? {
          usedJsHeapMb: Math.round(mem.usedJSHeapSize / 1048576),
          totalJsHeapMb: Math.round(mem.totalJSHeapSize / 1048576),
          jsHeapLimitMb: Math.round(mem.jsHeapSizeLimit / 1048576),
          deviceMemoryGb: (navigator as any).deviceMemory,
          domNodes: document.getElementsByTagName('*').length,
          note: 'Chrome-only, coarse/quantized, JS-heap only unless the page is cross-origin-isolated.',
        }
      : {
          available: false,
          domNodes: document.getElementsByTagName('*').length,
          note: 'performance.memory is Chrome-only.',
        },
  };
}

let installed = false;

export function installPageObserver(): void {
  if (installed) return;
  installed = true;
  try {
    installNetwork();
  } catch {
    /* never break the page */
  }
  try {
    installVitals();
  } catch {
    /* never break the page */
  }

  window.addEventListener('message', async ev => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.source !== 'keepkey-content' || d.type !== 'KEEPKEY_OBS_GET') return;
    let data: any;
    try {
      data = d.category === 'perf' ? await perfReport() : networkReport(d.filter || {});
    } catch (e: any) {
      data = { error: String(e?.message || e) };
    }
    window.postMessage(
      { source: 'keepkey-injected', type: 'KEEPKEY_OBS_DATA', requestId: d.requestId, category: d.category, data },
      window.location.origin,
    );
  });
}
