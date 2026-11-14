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
 * SSE auth needs a queryKey registered with the gateway (the shared one from
 * pioneerKey.ts). All of it is best-effort: if registration or the stream fails,
 * the poll still drives the UI.
 */

import { ensureQueryKey } from './pioneerKey';

const PIONEER_API = 'https://api.keepkey.info';

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

  try {
    const queryKey = await ensureQueryKey();
    if (signal.aborted) return;
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
      // The gateway replays an unknown-key 401 to green (which has no
      // /events/subscribe, so: green 404). Re-register before retrying.
      if (!resp.ok && resp.headers.get('x-kk-served-by') === 'green') await ensureQueryKey(true).catch(() => {});
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
