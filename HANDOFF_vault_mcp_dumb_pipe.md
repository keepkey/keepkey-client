# HANDOFF → vault: make `/mcp` a dumb pipe (serve the BEX's catalog, pass content through)

**From:** keepkey-client `develop` — PR #112 (browser-driving tools) and #113 (Agent Mode UI) are
**MERGED**. The client side is done.
**To:** `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault`
**File:** `src/bun/mcp.ts` — **that file only**. `src/bun/bex-bridge.ts` needs nothing; it is already
tool-agnostic.
**Size:** ~20 lines. One time, forever.

> **Status: this is the only thing left.** Nine browser-driving tools (`bex_snapshot`, `bex_click`,
> `bex_navigate`, `bex_type`, `bex_select`, `bex_find`, `bex_read_page`, `bex_screenshot`,
> `bex_tabs`) are merged and shipping in the extension, and they are **inert** — not because they're
> unfinished, but because the vault won't advertise or route them. This change turns them on.

**Line numbers verified against the current vault tree on 2026-07-16** (vault repo was on branch
`fix/thorchain-clearsign-per-chain-router`; the code below is what's there now).

---

## Why

`src/bun/mcp.ts:38` hardcodes the tool catalog in the vault, and `:158` wraps every tool result as
`{type:'text'}`. Two consequences, both blocking:

1. **Every new BEX tool is a cross-repo change.** With the catalog in the vault, `tools/list` never
   mentions the nine browser tools and `tools/call` rejects them at the `TOOL_NAMES` guard (`:155`)
   before the bridge is consulted. Every future tool repeats this dance.
2. **Screenshots are impossible.** MCP returns images as `{type:'image', data, mimeType}` content
   blocks. The vault can only emit text, so `bex_screenshot` has nowhere to put its JPEG.

The bridge is already right: `callBex(tool, args)` (`bex-bridge.ts:78`) does not care what the tool
is. Only `mcp.ts` is coupled. Fix it once and the extension owns its entire tool surface — every
subsequent tool ships in keepkey-client alone, with no vault release.

The client half is already in place: `chrome-extension/src/background/mcpBridge.ts:242` on `develop`
answers `bex_list_tools` with `{tools: [...INTROSPECTION_TOOLS, ...BROWSER_TOOLS]}`.

## Change 1 — `tools/list` proxies to the BEX

Replace (`mcp.ts:149-150`):

```ts
    case 'tools/list':
      return rpcResult(id, { tools: TOOLS }, cors)
```

with:

```ts
    case 'tools/list': {
      // The BEX owns its catalog; we serve whatever it reports. This is what
      // keeps new tools a one-repo change (HANDOFF_vault_mcp_dumb_pipe.md).
      try {
        const { tools } = (await callBex('bex_list_tools', {})) as { tools: unknown[] }
        return rpcResult(id, { tools }, cors)
      } catch {
        // Bridge down (BEX closed, or Agent mode off) — serve the static
        // fallback so `claude mcp add` and tools/list still succeed and the
        // agent can reach bex_status to find out why.
        return rpcResult(id, { tools: FALLBACK_TOOLS }, cors)
      }
    }
```

Rename the existing `const TOOLS` (`:38`) to `FALLBACK_TOOLS` and leave its five tier-1 entries
as-is — bridge-down is the only path that reads it now. Add a comment that it is a fallback and
**not** the source of truth, so nobody adds tools there out of habit.

## Change 2 — `tools/call` passes content blocks through

Replace the success line (`mcp.ts:158`):

```ts
        const result = await callBex(name, args)
        return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }, cors)
```

with:

```ts
        const result = (await callBex(name, args)) as any
        // The BEX may answer with MCP content blocks already (bex_snapshot
        // returns pre-formatted text; bex_screenshot returns an image). Pass
        // those through untouched — JSON-stringifying them would double-encode
        // the text and mangle the image.
        if (result && Array.isArray(result.content)) return rpcResult(id, result, cors)
        return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }, cors)
```

Leave the whole `catch` block alone — including the `bex_status` bridge-down special case (`:162-165`)
and the `isError` payload (`:168`). Those are correct and load-bearing.

## Change 3 — drop the `TOOL_NAMES` guard

Delete `const TOOL_NAMES` (`:87`) and the guard (`:155`):

```ts
      if (!TOOL_NAMES.has(name)) return rpcError(id, -32602, `unknown tool: ${name}`, undefined, cors)
```

The vault can no longer know the valid names, and it doesn't need to: `executeTool`'s `default`
branch in the BEX already throws `{code: 'unknown_tool'}`, which surfaces to the agent as an
`isError` result via the existing catch. One rejection path, in the process that owns the catalog.

## Do NOT change

- **Auth.** `/mcp` stays bearer-authed + loopback-only + browser-excluded. The browser tools make
  this *more* important, not less: `bex_click` can drive any page in the user's real Chrome,
  including a logged-in exchange. The BEX-side Agent-mode toggle (default off) remains the gate on
  the tools doing anything.
- **`CALL_TIMEOUT_MS = 30_000`** (`bex-bridge.ts:25`) — still adequate. `bex_navigate` is the
  longest tool and self-caps its page-load wait at 20s.
- **The `catch` block in `tools/call`** — see Change 2.

## Verifying

From the client repo, with the vault running and Agent mode ON in the extension:

```bash
KEEPKEY_API_KEY=<pairing key> node scripts/test-mcp-bridge.mjs
```

The script asserts `tools/list` includes the browser tools alongside tier-1, and that
`bex_screenshot` comes back as an `image` content block. It fails loudly against an unpatched vault,
so it doubles as the check that this handoff landed.

Quick manual smoke (should list 14 tools once patched, 5 before):

```bash
curl -s -X POST http://localhost:1646/mcp \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $KEEPKEY_API_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | grep -o '"name":"bex_[a-z_]*"'
```

## Once this lands

`/docs/bex/mcp` on docs.keepkey.com currently tells users the browser-driving tools do not work yet.
That page needs its availability note flipped when this ships —
`keepkey-docs-v8/content/docs/bex/mcp.mdx`, the "Availability" and "Why they do not work yet"
sections.
