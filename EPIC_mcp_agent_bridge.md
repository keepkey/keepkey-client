# EPIC → MCP Agent Bridge: let agents drive the BEX and the wallets it connects

**From:** planning session (swapspro balance debugging, 2026-07-15)
**Owners:** keepkey-client (BEX) + keepkey-vault (v11) — this epic spans both repos.
**Repos:**
- BEX: `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client` (this repo)
- Vault: `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault`

> Absolute paths throughout (multi-repo stack). Vault REST base is
> `http://localhost:1646` (`src/bun/rest-api.ts`); the BEX already pairs against
> it (`HANDOFF_vault_connectivity_api.md`).

---

## Why (the motivating failure)

An agent spent a session testing swapspro against the BEX **blind**. Three bugs
that took hours to find would each have been a one-tool-call diagnosis:

1. **Add Network spam** — connect fired N concurrent `wallet_switchEthereumChain`
   requests; all but the first got `-32002`, and a catch-all fallback turned each
   into a `wallet_addEthereumChain` prompt. Agent could not see the request
   queue, the error codes, or the prompts. (`bex_pending_requests` + `bex_logs`
   would have shown it instantly.)
2. **Pubkey array bug** — Pioneer `/portfolio` 400'd because the BEX provider
   returns an **array** for UTXO/Cosmos addresses where SwapKit expects a string
   (`pubkeys.$9.pubkey: ["thor1g9el..."]`). Agent had no way to dump what the
   BEX actually hands a dApp per chain. (`bex_accounts` would have shown the
   shape mismatch before any UI existed.)
3. **No end-to-end verification** — agent shipped a preview it could not click
   through; the human found the breakage. (`bex_provider_request` +
   approval-control closes the loop: agent tests connect→balances→swap alone.)

Goal: an MCP server agents connect to that can **introspect and drive the BEX
itself, and the wallets/dApp connections it manages** — so agent test loops are
observable, scriptable, and don't need a human clicking the side panel.

---

## Architecture decision

**The vault hosts the MCP endpoint; the BEX is a bridge client.**

Chrome MV3 extensions cannot listen on a port, so the MCP server must live in a
process that can. We already run one: the vault's Bun REST server on `:1646`,
which the BEX already pairs with and holds credentials for. Reuse it.

```
Agent (Claude Code / any MCP client)
   │  Streamable HTTP  POST http://localhost:1646/mcp
   ▼
Vault (Bun, src/bun/) ── MCP session state, tool registry, auth
   │  WebSocket  ws://localhost:1646/bex-bridge   (BEX connects OUTBOUND,
   ▼              Authorization: Bearer <existing pairing key>)
BEX background service worker ── executes tool calls:
   ├─ reads its own state (accounts, queue, logs, connected sites)
   ├─ settles approvals (same runtime message the side panel sends)
   └─ drives providers (window.keepkey.* handlers in background/chains/*)
```

- **Transport agent→vault:** MCP Streamable HTTP at `POST /mcp` (new handler in
  `src/bun/rest-api.ts` territory; own module `src/bun/mcp.ts`).
- **Transport vault→BEX:** one persistent outbound WebSocket from the BEX
  background SW. Precedent already in-repo: `chrome-extension/src/background/
  swapEventStream.ts` maintains a vault event stream; the bridge is the same
  pattern with a request/response envelope (`{id, tool, args}` →
  `{id, result | error}`). MV3 note: a WS keeps the SW alive while open, but the
  bridge must survive SW restarts — reconnect on SW wake (same lifecycle hooks
  the pairing init uses, see `background/index.ts`).
- **Auth:** the BEX authenticates the socket with its existing pairing bearer
  key (no new credential). The `/mcp` endpoint is localhost-only and requires
  the vault's existing API auth (`src/bun/auth.ts`) — same story as the v2 REST
  surface.
- **If the bridge is down** (BEX not running / socket dropped): tools return a
  structured `bridge_disconnected` error, never hang. Vault answers `/mcp`
  regardless so the agent can always ask `bex_status` and get a truthful "BEX
  unreachable".

**Rejected alternative — native messaging host:** a stdio MCP binary registered
as a Chrome native-messaging host. Works, but adds a second install/registration
path and a new binary to ship; the vault channel already exists, is authed, and
is running full-time on the dev machine this epic serves. Revisit only if we
need the bridge without a vault install.

---

## Tool surface (v1)

All tools namespaced `bex_`. Two tiers, both **off by default** (see Safety).

### Tier 1 — read-only (enabled by the "Agent mode" toggle)

| Tool | Returns | Notes |
|---|---|---|
| `bex_status` | extension version, device connected?, vault paired?, active EVM networkId, bridge uptime, SW restart count | the "is anything even alive" call |
| `bex_accounts` | per-chain: `{ chain, networkId, address, pubkey/xpub, addressType }` — the **exact values handlers return to dApps** | must expose the raw shape (string vs array) — that's the point; would have caught bug #2 |
| `bex_pending_requests` | approval queue: `{ id, method, params, origin, chain, requestedAt }` | source of truth is whatever `requireApproval` (`background/methods.ts:60`) queues for the side panel |
| `bex_logs` | ring buffer of background logs + a structured provider request/response log; args: `{ pattern?, since?, limit? }` | new: a `providerLog` interceptor in `background/methods.ts` recording every injected request, response, and error **code** — would have caught bug #1 |
| `bex_connected_sites` | origins with active provider connections + chains each has touched | |

### Tier 2 — control (additionally requires the "Allow agent control" toggle)

| Tool | Action | Notes |
|---|---|---|
| `bex_approve_request` | settle a pending approval id as approved | sends the same `eth_sign_response` runtime message the side panel sends — no parallel approval path, one choke point |
| `bex_reject_request` | settle as rejected (dApp receives code 4001) | |
| `bex_provider_request` | execute `{ chain, method, params, origin? }` through the same `handleXxxRequest` routing in `background/methods.ts` a page would hit | read-only methods (accounts, balances, chainId) run directly; signing/tx methods still enter `requireApproval` — the agent then approves via `bex_approve_request`, keeping one auditable path |
| `bex_set_network` | switch active EVM network | |
| `bex_revoke_site` | disconnect an origin | |

**Explicitly out of scope for v1:** seed/xpriv/entropy access (never), pairing-key
export (never), skipping device confirmation (the KeepKey's physical button
remains the backstop for anything that signs — MCP cannot press it, by design),
driving the side-panel UI itself (agent asserts via state, not pixels).

---

## Safety model

- Both toggles live in the options page, persisted via `packages/storage`,
  default **off**. Flipping either shows a persistent badge/banner ("Agent mode
  active") so a human at the machine always knows.
- Tier-2 tools hard-fail with a structured `agent_control_disabled` error when
  the second toggle is off — not silently downgraded.
- Everything is localhost + existing vault auth. No remote exposure; the vault
  must not bind `/mcp` beyond loopback.
- The provider log (`bex_logs`) must redact nothing *structural* but must never
  log signed-tx raw bytes' private inputs (there are none — signing happens on
  device — but keep the rule stated).
- Signing still requires the physical device confirmation. Agent mode automates
  the *extension's* consent, not the *device's*. This is the line: an agent can
  approve what the side panel would approve, and nothing more.

---

## Phases — each ends in a testable state

### Phase 1 — Bridge + read-only introspection
**Build:** `src/bun/mcp.ts` (vault: Streamable HTTP endpoint, tool registry,
session handling) · `ws /bex-bridge` upgrade handler (vault) ·
`chrome-extension/src/background/mcpBridge.ts` (BEX: outbound WS, reconnect on
SW wake, request/response envelope) · tools `bex_status`, `bex_accounts`,
`bex_pending_requests`, `bex_connected_sites` · options-page "Agent mode"
toggle · `providerLog` ring buffer + `bex_logs`.

**Exit test (scriptable, no human):**
```bash
claude mcp add keepkey --transport http http://localhost:1646/mcp
# then, in an agent session:
# 1. tools/list returns the 6 tier-1/2 names (tier-2 present but disabled)
# 2. bex_status → { deviceConnected: true, vaultPaired: true, bridge: "up" }
# 3. bex_accounts → ETH address equals the one the side panel displays;
#    THOR/UTXO entries expose their real shape (this is bug #2's regression test)
# 4. Kill the BEX (disable extension) → bex_status returns bridge_disconnected
#    within 10s; re-enable → bridge recovers without vault restart
```

### Phase 2 — Approval control
**Build:** `bex_approve_request` / `bex_reject_request` wired through the
`eth_sign_response` message path · "Allow agent control" toggle + banner ·
structured `agent_control_disabled` error.

**Exit test:** a fixture page (`tests/fixtures/agent-bridge.html`) that fires
`wallet_addEthereumChain` and `eth_requestAccounts` on load:
```
1. Agent opens fixture page, polls bex_pending_requests → sees the request
   with correct origin/method/params
2. bex_reject_request → page's promise rejects with code 4001
3. bex_approve_request on eth_requestAccounts → page receives accounts
4. With control toggle OFF, both tools return agent_control_disabled and the
   queue is untouched
```
(This is bug #1's regression environment: the agent can now *watch* the
switch/add cascade and assert on error codes.)

### Phase 3 — Drive the wallet end-to-end
**Build:** `bex_provider_request`, `bex_set_network`, `bex_revoke_site`.

**Exit test — the acceptance run for the whole epic:** an agent, alone, against
a local swapspro dev server:
```
1. bex_provider_request eth_requestAccounts (origin: localhost:3000) → approve
   via bex_approve_request → addresses returned
2. Drive swapspro's connect flow; assert via bex_logs that connecting 9 chains
   produces ZERO wallet_addEthereumChain requests for already-known networks
3. Capture the exact pubkey payload swapspro sends to Pioneer /portfolio and
   assert every pubkey is a non-empty string (bug #2, verified end-to-end)
4. Balances render: agent asserts sidepanel state via swapspro, not pixels
5. Full transcript of provider traffic available from bex_logs as the test
   artifact
```

**The epic is done when the Phase-3 script runs green from a fresh
`claude mcp add`, with the human's only involvement being the two options-page
toggles and (for any signing test) the device button.**

---

## Implementation pointers (verified in-code this session)

- `chrome-extension/src/background/methods.ts:60` — `requireApproval`: sets
  badge, opens side panel, resolves on `eth_sign_response` runtime message or
  timeout-reject. Both new approval tools and `bex_pending_requests` hang off
  this one function; extend it, don't fork it.
- `chrome-extension/src/background/methods.ts:~170-215` — per-chain
  `handleXxxRequest` dispatch: the routing `bex_provider_request` should call
  into, so agent traffic and page traffic take the identical path.
- `chrome-extension/src/background/swapEventStream.ts` — existing vault event
  stream; the bridge socket follows this lifecycle pattern.
- `chrome-extension/src/background/index.ts` + `utils.ts` — pairing/init and
  the `1646` client; bridge auth reuses the stored pairing key.
- Vault REST/auth: `src/bun/rest-api.ts`, `src/bun/auth.ts` (vault repo) —
  `/mcp` and `/bex-bridge` land beside the existing v2 surface.
- Manifest (`chrome-extension/manifest.js`): no new permissions expected —
  outbound WS to localhost is covered; verify against MV3 CSP during Phase 1.

## Phase 1 implementation notes (2026-07-15, branch `feature/mcp-agent-bridge`)

Shipped: vault `src/bun/mcp.ts` + `src/bun/bex-bridge.ts` + `rest-api.ts` wiring
(vault repo, uncommitted — its tree is mid-hive-work); BEX `mcpBridge.ts`,
`providerLog.ts`, `methods.ts` instrumentation, `agentModeStorage`, options
toggle; exit test `scripts/test-mcp-bridge.mjs`.

Deviations from the spec above:
- **WS auth is `?token=<pairing key>`, not an Authorization header** — browser
  `WebSocket` cannot set headers. Loopback-only socket, key still validated by
  `auth.validate`.
- **`POST /mcp` requires loopback, not a bearer key** — the exit test's bare
  `claude mcp add` has no pairing key; the BEX-side Agent-mode toggle (default
  off) is the actual gate on data. `/mcp` and `/bex-bridge` both reject
  non-loopback callers (the vault otherwise binds 0.0.0.0).
- **MCP protocol is hand-rolled** (initialize/ping/tools/list/tools/call, plain
  JSON responses, no sessions/SSE — all optional per spec) instead of
  `@modelcontextprotocol/sdk` — open question #1 resolved in favor of no new
  vault dependency.
- tools/list returns the **5 tier-1 tools only**; tier-2 names appear in
  Phase 2 with the control toggle.

## Open questions (decide at Phase boundaries, don't block Phase 1)

1. MCP SDK on the vault side: `@modelcontextprotocol/sdk` server under Bun vs.
   hand-rolled Streamable HTTP (the protocol surface we need is small). Try the
   SDK first; fall back if Bun compat bites.
2. Should `bex_logs` persist across SW restarts (chrome.storage ring) or is
   in-memory + restart counter enough for v1? Start in-memory.
3. Event push (MCP notifications for "new pending request") vs. agent polling.
   v1: polling; the queue is small and agents poll fine.
