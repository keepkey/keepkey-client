# HANDOFF → vault: the BEX MCP tool surface grew to 19 — enable it with the dumb-pipe

**From:** keepkey-client `develop` (+ PR #117, page-observability tools).
**To:** `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault` — `src/bun/mcp.ts`.
**TL;DR:** the extension now exposes **19** `bex_*` tools. You do **not** wire them one by one. The
single ~20-line change in **`HANDOFF_vault_mcp_dumb_pipe.md`** turns on all 19 — and every future
one — with no further vault work. This doc is the catalog + the one detail that change must get right.

---

## Why this exists

The tool catalog used to be hardcoded in the vault (`mcp.ts` `const TOOLS`), so each new extension
tool needed a matching vault edit. The extension has since added nine browser-driving tools and five
page-observability tools; hand-maintaining that list in two repos does not scale. The dumb-pipe change
fixes it once: `tools/list` proxies to the BEX's own `bex_list_tools`, `tools/call` passes content
blocks through, and the `TOOL_NAMES` guard is dropped. After it lands, the vault never needs to know
the tool names again.

**Nothing in this handoff is a second code change.** It is the reference for *what* the dumb-pipe
enables, plus the one static list you should refresh while you're in there.

## The current catalog (19 tools)

The BEX answers `bex_list_tools` with `{ tools: [...INTROSPECTION_TOOLS, ...BROWSER_TOOLS] }`
(`chrome-extension/src/background/mcpBridge.ts`). Grouped:

**Introspection — 6** (extension/wallet state; answered in the background, no page needed):
`bex_status` · `bex_accounts` · `bex_pending_requests` · `bex_connected_sites` · `bex_logs` ·
`bex_ext_console`

**Browser-driving & page-observability — 13** (act on / read the user's real tab):
`bex_tabs` · `bex_navigate` · `bex_snapshot` · `bex_find` · `bex_click` · `bex_type` · `bex_select` ·
`bex_read_page` · `bex_console` · `bex_network` · `bex_perf` · `bex_storage` · `bex_screenshot`

All read-only except the four page-driving actuators (`navigate`/`click`/`type`/`select`), and none can
sign — the device button remains the only path to a signature.

## The one detail the dumb-pipe must get right (already in its Change 2)

`bex_screenshot` returns an **image** content block (`{type:'image', data, mimeType:'image/jpeg'}`), not
text. The other observability tools return pre-shaped MCP content too. Change 2 of the dumb-pipe handoff
already handles this — pass a result through untouched when `Array.isArray(result.content)`, else wrap as
text. Do not JSON-stringify a result that is already content blocks; it double-encodes the text and
destroys the image. This is the load-bearing line for the whole observability set.

## Refresh the bridge-down fallback while you're there

The dumb-pipe keeps a static `FALLBACK_TOOLS` for when the extension bridge is down (BEX closed or Agent
mode off) so `claude mcp add` and `tools/list` still succeed and the agent can reach `bex_status` to find
out why. That fallback should be the **6 introspection tools** — it currently lists 5. Add `bex_ext_console`:

```ts
const FALLBACK_TOOLS = [ /* bex_status, bex_accounts, bex_pending_requests,
  bex_connected_sites, bex_logs, bex_ext_console */ ]
```

Only `bex_status` actually answers with the bridge down (it self-reports `bridge:'down'`); the rest
return `bridge_disconnected`. That's fine — the point of the fallback is a working `tools/list` and a
reachable `bex_status`, not live data. The page-driving/observability tools deliberately stay **out** of
the fallback: they can't do anything without the bridge, so advertising them bridge-down would only
invite failing calls.

## Explicitly unchanged

- **Auth** — bearer + loopback + browser-excluded. The browser tools make this matter *more*:
  `bex_click` can drive any tab in the user's real Chrome, including a logged-in exchange, and
  `bex_storage` reads a dApp's persisted state. The BEX Agent-mode toggle (default off) stays the gate.
- **`CALL_TIMEOUT_MS = 30_000`** (`bex-bridge.ts`) — still adequate. The slowest new tool is `bex_perf`
  (~500 ms rAF sample) and `bex_navigate` (self-caps at 20 s); both are well under the budget.
- **`bex-bridge.ts`** — nothing. It is already tool-agnostic (`callBex(tool, args)`).

## Verify

Once the dumb-pipe + fallback update land, with the vault running and Agent mode ON:

```bash
curl -s -X POST http://localhost:1646/mcp \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $KEEPKEY_API_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | grep -o '"name":"bex_[a-z_]*"' | sort -u
```

Expect **19** names with Agent mode on, **6** with it off. `scripts/test-mcp-bridge.mjs` also asserts the
browser tools appear and that `bex_screenshot` returns an `image` block.
