/**
 * mcpBridge — BEX side of the MCP agent bridge (EPIC_mcp_agent_bridge.md).
 *
 * When the options-page "Agent mode" toggle is ON, the background keeps one
 * outbound WebSocket to the vault (ws://localhost:1646/bex-bridge, authed with
 * the existing pairing key) and answers read-only introspection tool calls
 * forwarded from the vault's POST /mcp endpoint:
 *
 *   {id, tool, args}  →  {id, result | error: {code, message}}
 *
 * Toggle OFF (the default) → no socket, no data exposed; the vault answers
 * agents with bridge_disconnected. Reconnect lifecycle mirrors
 * swapEventStream.ts (backoff, restart on SW wake via module-load init).
 */

import * as wallet from './wallet';
import { agentModeStorage, keepKeyApiKeyStorage, web3ProviderStorage } from '@extension/storage';
import { getLogs, getPendingRequests, getConnectedSites, SW_STARTED_AT } from './providerLog';
import { BROWSER_TOOLS, executeBrowserTool, isBrowserTool } from './browserTools';

const TAG = ' | mcpBridge | ';
const BRIDGE_URL = 'ws://localhost:1646/bex-bridge';
const RECONNECT_MAX_MS = 60_000;

// MV3 evicts an idle service worker after ~30s, and an idle WebSocket does NOT
// prevent that — only actual WS traffic resets the timer (Chrome 116+). Without
// this ping the worker dies on a quiet machine, the socket goes with it, and
// nothing wakes the worker back up: an agent polling bex_status would see
// bridge "down" indefinitely. 20s keeps us inside the 30s window.
// The vault ignores frames whose id matches no pending call, so this needs no
// server-side handler.
const HEARTBEAT_MS = 20_000;

const KEEPKEY_STATE_NAMES: Record<number, string> = {
  0: 'unknown',
  1: 'disconnected',
  2: 'connected',
  3: 'busy',
  4: 'errored',
  5: 'paired',
};

// Chains whose request_accounts is a cache read (no device round-trip).
const ACCOUNT_CHAINS = [
  'ethereum',
  'bitcoin',
  'bitcoincash',
  'dogecoin',
  'litecoin',
  'dash',
  'thorchain',
  'mayachain',
  'cosmos',
  'osmosis',
  'ripple',
];

/**
 * The tier-1 introspection catalog. It lives HERE, next to the code that
 * implements it, rather than in the vault — the vault serves whatever
 * bex_list_tools returns (see HANDOFF_vault_mcp_dumb_pipe.md). That keeps every
 * future tool a one-repo change instead of a cross-repo one, which is the only
 * reason the browser tools below could ship without touching the vault at all.
 */
const INTROSPECTION_TOOLS = [
  {
    name: 'bex_status',
    description:
      'KeepKey extension health: extension version, device/vault connection state, active EVM network, bridge status. Works even when the extension bridge is down (reports bridge: "down").',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'bex_accounts',
    description:
      'Per-chain accounts exactly as the extension returns them to dApps via request_accounts — raw shape preserved (string vs array), plus the underlying pubkey/xpub cache entries.',
    inputSchema: {
      type: 'object',
      properties: {
        chains: {
          type: 'array',
          items: { type: 'string' },
          description: 'Chains to query (e.g. ["ethereum","bitcoin","thorchain"]). Default: all supported.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'bex_pending_requests',
    description: 'The extension approval queue: requests waiting for user approval in the side panel.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'bex_connected_sites',
    description: 'Origins that have made provider requests through the extension, with the chains each has touched.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'bex_logs',
    description:
      'Structured provider request/response log from the extension background (every injected request, its result or error code). Ring buffer, newest last. This is the wallet-traffic view a generic browser MCP cannot give you.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex filter over method/origin/error' },
        since: { type: 'number', description: 'Only entries with timestamp >= this (ms epoch)' },
        limit: { type: 'number', description: 'Max entries returned (default 100)' },
      },
      additionalProperties: false,
    },
  },
];

export interface McpBridgeDeps {
  getKeepKeyState: () => number;
  /** Routes through the same handleWalletRequest path page traffic takes. */
  walletRequest: (chain: string, method: string, params: any[]) => Promise<any>;
}

let deps: McpBridgeDeps | null = null;
let ws: WebSocket | null = null;
let enabled = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectDelay = 5_000;
let connectedAt: number | null = null;

export function initMcpBridge(bridgeDeps: McpBridgeDeps): void {
  deps = bridgeDeps;
  const apply = (on: boolean | undefined) => {
    enabled = !!on;
    if (enabled) connect();
    else disconnect();
  };
  agentModeStorage.subscribe(() => apply(agentModeStorage.getSnapshot() ?? undefined));
  agentModeStorage.get().then(apply);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function disconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  stopHeartbeat();
  if (ws) {
    try {
      ws.close();
    } catch {
      /* already closed */
    }
    ws = null;
  }
  connectedAt = null;
  reconnectDelay = 5_000;
}

async function connect(): Promise<void> {
  if (!enabled || ws) return;
  const apiKey = await keepKeyApiKeyStorage.getApiKey();
  if (!enabled || ws) return; // toggle raced the await
  if (!apiKey) {
    // Not paired yet — retry until pairing exists or the toggle goes off.
    scheduleReconnect();
    return;
  }

  // Browser WebSocket can't set an Authorization header — pairing key rides
  // the query string on this loopback-only socket (vault validates it).
  const socket = new WebSocket(`${BRIDGE_URL}?token=${encodeURIComponent(apiKey)}`);
  ws = socket;

  socket.onopen = () => {
    if (ws !== socket) return;
    console.log(TAG, 'bridge connected');
    connectedAt = Date.now();
    reconnectDelay = 5_000;
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (ws !== socket || socket.readyState !== WebSocket.OPEN) return;
      try {
        socket.send(JSON.stringify({ ping: Date.now() }));
      } catch {
        /* onclose handles the reconnect */
      }
    }, HEARTBEAT_MS);
  };

  socket.onmessage = async event => {
    let msg: any;
    try {
      msg = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (!msg?.id || !msg?.tool) return;
    try {
      const result = await executeTool(msg.tool, msg.args ?? {});
      socket.send(JSON.stringify({ id: msg.id, result }));
    } catch (e: any) {
      socket.send(
        JSON.stringify({
          id: msg.id,
          error: { code: e?.code ?? 'tool_error', message: e?.message || String(e) },
        }),
      );
    }
  };

  socket.onclose = () => {
    if (ws !== socket) return;
    ws = null;
    connectedAt = null;
    stopHeartbeat();
    scheduleReconnect();
  };

  socket.onerror = () => {
    // onclose follows and handles reconnect
  };
}

function scheduleReconnect(): void {
  if (!enabled || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
}

async function executeTool(tool: string, args: any): Promise<any> {
  if (!deps) throw new Error('bridge not initialized');

  // The vault asks for the catalog on tools/list and serves it verbatim.
  if (tool === 'bex_list_tools') return { tools: [...INTROSPECTION_TOOLS, ...BROWSER_TOOLS] };
  if (isBrowserTool(tool)) return executeBrowserTool(tool, args);

  switch (tool) {
    case 'bex_status': {
      const state = deps.getKeepKeyState();
      const apiKey = await keepKeyApiKeyStorage.getApiKey();
      const provider = await web3ProviderStorage.getWeb3Provider().catch(() => null);
      return {
        bridge: 'up',
        version: chrome.runtime.getManifest().version,
        keepkeyState: state,
        keepkeyStateName: KEEPKEY_STATE_NAMES[state] ?? String(state),
        deviceConnected: state === 2 || state === 3 || state === 5,
        vaultPaired: !!apiKey,
        walletInitialized: wallet.isInitialized(),
        activeEvmNetwork: provider
          ? { chainId: provider.chainId, networkId: provider.networkId, name: provider.name }
          : null,
        swStartedAt: SW_STARTED_AT,
        bridgeConnectedAt: connectedAt,
      };
    }

    case 'bex_accounts': {
      const chains: string[] = Array.isArray(args?.chains) && args.chains.length ? args.chains : ACCOUNT_CHAINS;
      const accounts = await Promise.all(
        chains.map(async chain => {
          try {
            // The EXACT value a dApp gets from request_accounts — raw shape
            // (string vs array vs nested array) deliberately preserved; this
            // is the epic's bug-#2 regression surface.
            const providerResponse = await deps!.walletRequest(chain, 'request_accounts', []);
            return { chain, providerResponse };
          } catch (e: any) {
            return { chain, error: e?.message || String(e) };
          }
        }),
      );
      return { accounts, pubkeys: wallet.getPubkeys() };
    }

    case 'bex_pending_requests':
      return { requests: getPendingRequests() };

    case 'bex_connected_sites':
      return { sites: getConnectedSites() };

    case 'bex_logs':
      return { swStartedAt: SW_STARTED_AT, entries: getLogs(args) };

    default:
      throw Object.assign(new Error(`unknown tool: ${tool}`), { code: 'unknown_tool' });
  }
}
