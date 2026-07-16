# HANDOFF → vault: make `/mcp` a dumb pipe (serve the BEX's catalog, pass content through)

**From:** keepkey-client, branch `feature/mcp-browser-driving`
**To:** `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault`
**File:** `src/bun/mcp.ts` (only — `bex-bridge.ts` needs nothing, it's already tool-agnostic)
**Size:** ~20 lines. One time, forever.

---

## Why

`src/bun/mcp.ts:38` hardcodes the tool catalog in the vault, and `:158` wraps every
tool result as `{type:'text'}`. Two consequences, both blocking:

1. **Every new BEX tool is a cross-repo change.** The client branch adds nine
   browser-driving tools (`bex_snapshot`, `bex_click`, `bex_navigate`, …). With
   the catalog in the vault, `tools/list` never mentions them and `tools/call`
   rejects them at the `TOOL_NAMES` guard (`:155`) before the bridge is even
   consulted. Every future tool would repeat this dance.
2. **Screenshots are impossible.** MCP returns images as
   `{type:'image', data, mimeType}` content blocks. The vault can only emit text,
   so `bex_screenshot` has nowhere to put its JPEG.

The bridge itself is already right: `callBex(tool, args)` in `bex-bridge.ts` does
not care what the tool is. Only `mcp.ts` is coupled. Fix it once and the
extension owns its entire tool surface — every subsequent tool ships in
keepkey-client alone, with no vault release.

## Change 1 — `tools/list` proxies to the BEX

The BEX answers a new `bex_list_tools` call with `{tools: [...]}` (already
implemented and merged-ready in `chrome-extension/src/background/mcpBridge.ts`).

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

Rename the existing `const TOOLS` to `FALLBACK_TOOLS` and leave its five tier-1
entries as-is — bridge-down is the only path that reads it now. Add a comment
that it's a fallback and **not** the source of truth, so nobody adds tools there
out of habit.

## Change 2 — `tools/call` passes content blocks through

```ts
    case 'tools/call': {
      const name = params?.name
      const args = params?.arguments ?? {}
      try {
        const result = (await callBex(name, args)) as any
        // The BEX may answer with MCP content blocks already (bex_snapshot
        // returns pre-formatted text; bex_screenshot returns an image). Pass
        // those through untouched — JSON-stringifying them would double-encode
        // the text and mangle the image.
        if (result && Array.isArray(result.content)) return rpcResult(id, result, cors)
        return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }, cors)
      } catch (e: any) {
        // ... unchanged
      }
    }
```

## Change 3 — drop the `TOOL_NAMES` guard

Delete `const TOOL_NAMES` (`:87`) and the `if (!TOOL_NAMES.has(name))` check
(`:155`). The vault can no longer know the valid names, and it doesn't need to:
`executeTool`'s `default` branch in the BEX already throws
`{code: 'unknown_tool'}`, which surfaces to the agent as an `isError` result via
the existing catch. One rejection path, in the process that actually owns the
catalog.

## Do NOT change

- **Auth** — `/mcp` stays bearer-authed + loopback-only + browser-excluded. The
  browser tools make this *more* important, not less: `bex_click` can drive any
  page in the user's real Chrome, including a logged-in exchange. The BEX-side
  "Agent mode" toggle (default off) remains the gate on the tools doing anything.
- **`CALL_TIMEOUT_MS = 30_000`** (`bex-bridge.ts:25`) — still adequate.
  `bex_navigate` is the longest tool and self-caps its page-load wait at 20s.

## Verifying

From the client repo, with the vault running and Agent mode ON:

```bash
KEEPKEY_API_KEY=<pairing key> node scripts/test-mcp-bridge.mjs
```

The script asserts `tools/list` now includes the browser tools alongside tier-1,
and that `bex_screenshot` comes back as an `image` content block. It fails
loudly against an unpatched vault, so it doubles as the check that this handoff
landed.
