/**
 * swapEventStream — real-time swap acceleration via Pioneer's SSE feed.
 *
 * The vault tracker poll (GET /api/v1/swaps/:txid) remains the source of truth
 * for a swap's full lifecycle. This stream is an ACCELERATOR: it opens an SSE
 * connection to Pioneer (api.keepkey.info) watching the swap's from/to addresses
 * and, the instant a `tx:incoming` lands on the destination, tells the side panel
 * to refresh — so "output arrived" shows immediately instead of up to a poll
 * interval later. It never invents terminal state; it just nudges the poll.
 *
 * Mirrors vault's src/bun/event-stream.ts protocol:
 *   POST {base}/api/v1/events/subscribe   Accept: text/event-stream
 *     x-api-key: <registered queryKey>
 *     body: { addresses: [{address, networkId}], events: ['tx:incoming','tx:confirmed'] }
 *
 * SSE auth needs a queryKey that's been registered with Pioneer (the anonymous
 * `key:public-*` read scheme does not authorize the stream), so we mint + persist
 * + register one on first use. All of it is best-effort: if registration or the
 * stream fails, the poll still drives the UI.
 */

const PIONEER_API = 'https://api.keepkey.info';
const QUERY_KEY_STORAGE = 'keepkey-pioneer-query-key';

export interface AddressEntry {
  address: string;
  networkId: string;
}

export interface StreamEvent {
  type: 'tx:incoming' | 'tx:confirmed' | 'connected';
  data: any;
}

type EventHandler = (event: StreamEvent) => void;

let controller: AbortController | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let currentAddresses: AddressEntry[] = [];
let currentHandler: EventHandler | null = null;
let reconnectDelay = 10_000;
const RECONNECT_MAX_MS = 120_000;

let cachedQueryKey: string | null = null;

/** Mint (once) + register a Pioneer queryKey usable for SSE auth. Best-effort. */
async function ensureQueryKey(): Promise<string> {
  if (cachedQueryKey) return cachedQueryKey;
  let key: string | undefined;
  try {
    const stored = await chrome.storage.local.get(QUERY_KEY_STORAGE);
    key = stored?.[QUERY_KEY_STORAGE];
  } catch {
    /* ignore */
  }
  if (!key) {
    key = `bex:${crypto.randomUUID()}`;
    try {
      await chrome.storage.local.set({ [QUERY_KEY_STORAGE]: key });
    } catch {
      /* ignore — we can still use it for this session */
    }
    // Register the new key so the SSE endpoint authorizes it. 409 = already there.
    const username = key.slice(0, 32);
    try {
      await fetch(`${PIONEER_API}/api/v1/user/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, queryKey: key }),
      });
    } catch {
      /* non-fatal — stream degrades to poll-only if unregistered */
    }
  }
  cachedQueryKey = key;
  return key;
}

/** Start watching `addresses` for incoming/confirmed txs. Replaces any prior watch. */
export function startSwapEventStream(addresses: AddressEntry[], onEvent: EventHandler): void {
  stopSwapEventStream();
  if (!addresses.length) return;
  currentAddresses = addresses;
  currentHandler = onEvent;
  controller = new AbortController();
  reconnectDelay = 10_000;
  void connect();
}

export function stopSwapEventStream(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (controller) {
    controller.abort();
    controller = null;
  }
  currentAddresses = [];
  currentHandler = null;
}

async function connect(): Promise<void> {
  if (!controller || !currentHandler) return;
  const signal = controller.signal;
  const queryKey = await ensureQueryKey();
  if (signal.aborted) return;

  try {
    const resp = await fetch(`${PIONEER_API}/api/v1/events/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'x-api-key': queryKey,
      },
      body: JSON.stringify({ addresses: currentAddresses, events: ['tx:incoming', 'tx:confirmed'] }),
      signal,
    });

    if (!resp.ok || !resp.body) {
      scheduleReconnect();
      return;
    }
    reconnectDelay = 10_000; // healthy connection — reset backoff

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const frames = buf.split('\n\n');
      buf = frames.pop()!;
      for (const frame of frames) {
        if (!frame.trim() || frame.startsWith(':')) continue; // heartbeat / comment
        const evLine = frame.match(/^event:\s*(.+)$/m)?.[1]?.trim();
        const dataStr = frame.match(/^data:\s*(.+)$/m)?.[1]?.trim();
        if (!evLine || !dataStr) continue;
        try {
          currentHandler?.({ type: evLine as StreamEvent['type'], data: JSON.parse(dataStr) });
        } catch {
          /* malformed frame — skip */
        }
      }
    }
    scheduleReconnect(); // stream ended — reconnect
  } catch (err: any) {
    if (err?.name === 'AbortError') return; // intentional close
    scheduleReconnect();
  }
}

function scheduleReconnect(): void {
  if (!controller) return; // stopped
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
}
