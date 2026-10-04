# HANDOFF — "KeepKey Vault is not running" shown while the vault IS running

Repo: `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client`
Branch observed: `develop` @ `e2a0e57`
Status: diagnosed, **no code changed**. All findings verified against source + live network.

---

## TL;DR

A dApp `eth_sendTransaction` failed with:

```
KeepKey Vault is not running. Open the KeepKey Vault desktop app, then try again.
```

The vault was running the whole time. Two independent message-text classifiers combine to
turn *an Ethereum RPC that won't connect* into *a false claim that the vault is offline*:

```
isTransientRpcError("Failed to fetch")    → false   ⇒ hard-throw, failover loop aborts
isVaultUnreachableError("Failed to fetch") → true   ⇒ "Vault is not running"
```

An RPC connection failure and a vault connection failure produce **byte-identical**
error strings in Chrome. No regex can separate them. That is the core defect.

---

## Do NOT go looking here (already ruled out, with evidence)

**Pioneer is fine.** `GET https://api.keepkey.info/api/v1/discovery/caip/eip155%3A1%2Fslip44%3A60`
→ HTTP 200 in 0.13s, returns 8 mainnet RPCs. 6 of 8 answer `eth_chainId`, including the
primary `https://eth.drpc.org` (178ms). Do not open the pioneer repo for this.

> Note: an un-encoded path 404s. The BEX encodes via `encodeURIComponent` (`registry.ts:143`),
> so use `eip155%3A1%2Fslip44%3A60` when testing by hand or you will chase a phantom 404.

**The vault is fine.** `GET http://localhost:1646/api/health` → healthy, `device_connected: true`,
v1.5.3. CORS is wide open and preflight is correct, including for a `chrome-extension://` origin:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Private-Network: true
OPTIONS → 204
```

**`rpc.flashbots.net` is a red herring.** It appears in the logs timing out, but that path
worked correctly — it was classified transient, logged, and failed over. Flashbots is a
narrow-purpose relay; `ethereumHandler.ts:1613-1627` already documents that it rejects most
read methods.

---

## Root cause chain

Every step below is confirmed by source read plus the user's own console output.

1. `signTransaction` (`chrome-extension/src/background/chains/ethereumHandler.ts:1238`) makes
   preflight RPC calls — nonce, `estimateGas`, fee data — each via `withRpcFailover`.
2. A candidate RPC fails at **TLS/connection** level. Chrome throws `TypeError: Failed to fetch`.
3. `isTransientRpcError` (`ethereumHandler.ts:1629`) returns **false** for that string, so
   `withRpcFailover` (`ethereumHandler.ts:1667`) takes the definitive branch at
   **`ethereumHandler.ts:1684`** → `throw e`. The loop aborts on the **first** bad URL.
   Remaining working RPCs are never tried.
4. The error reaches the catch-all at `chrome-extension/src/background/methods.ts:312`,
   which runs `formatUserError` on **every** error that gets there.
5. `formatUserError` (`utils.ts:58`) calls `isVaultUnreachableError` (`utils.ts:48`), whose
   regex matches `failed to fetch` regardless of what was being fetched → the message is
   replaced with `VAULT_REQUIRED_MESSAGE` (`utils.ts:36`).
6. User is told to start an app that is already running.

### The classifier gap, precisely

`isTransientRpcError` tests for: `rate limit`, `throttle`, `429`, `timeout`, `econnreset`,
`etimedout`, `network`, `server_error`, `exceeded maximum retry`, 5xx, plus method-rejection
patterns. Measured behaviour:

| error string | transient? | browser |
|---|---|---|
| `Failed to fetch` | **false** | Chrome / Edge |
| `TypeError: Failed to fetch` | **false** | Chrome / Edge |
| `Load failed` | **false** | Safari |
| `ERR_NAME_NOT_RESOLVED` | **false** | Chrome |
| `signal is aborted without reason` | **false** | all |
| `NetworkError when attempting to fetch resource.` | true | Firefox / Node |

It was written against Firefox/Node wording. The same dead RPC therefore **fails over on
Firefox and hard-fails on Chrome** — which is why this reproduces for some people and not others.

### Why it triggers on this machine

`chrome-extension/src/background/chains/lastResortRpcs.ts:35`:

```js
'eip155:1': ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org'],
```

`ethereum-rpc.publicnode.com` fails TLS from this network (`curl` exit 35), and it is **first**.
`eth.drpc.org`, immediately after it, works fine and is never reached. Same TLS failure for
`mainnet.gateway.tenderly.co`, which is #2 in Pioneer's list.

**Not a regression.** `isTransientRpcError` was introduced in `c79fc54` and extended in
`5f79b76`; `Failed to fetch` was never covered. Latent since then, surfaced now because a
first-in-list RPC started failing at connection level.

---

## Fixes, in priority order

### 1. `isVaultUnreachableError` cannot work as written — HIGH

`utils.ts:48`. Do not try to improve the regex; the strings are identical, so no regex can work.
Discriminate on **which host was contacted**, not on message text.

The cheap correct fix: the extension **already has an authoritative vault-liveness signal** and
ignores it here. `checkKeepKey()` (`index.ts:221`) polls `http://localhost:1646/docs` every 5s
behind a singleflight guard and sets `KEEPKEY_STATE` (`2` = connected, `4` = errored).
`index.ts:1154` and `index.ts:1196` already do the right thing:

```js
if (KEEPKEY_STATE === 4) throw createVaultRequiredError();
```

During this failure `KEEPKEY_STATE` was `2`. **The extension knew the vault was up and said
otherwise anyway.** Gate `VAULT_REQUIRED_MESSAGE` on that state (or on the vault fetch call
site itself), and stop inferring it from an arbitrary error string in a catch-all.

Vault fetch sites, for the target-based approach: `wallet.ts:29`, `swapHandler.ts:22`,
`activityReport.ts:20`, `chains/{hive,ton,solana,tron}Handler.ts` (all `http://localhost:1646`).

### 2. `isTransientRpcError` must know browser network errors — HIGH

Two copies, already drifted — only the first has the method-rejection patterns:
- `chrome-extension/src/background/chains/ethereumHandler.ts:1629`
- `chrome-extension/src/background/chains/rpcFailover.ts:33`

Add `failed to fetch`, `load failed`, `err_` (Chrome `ERR_*` net errors), and abort wording.
Then collapse the duplicates into one exported classifier so they cannot drift again.

### 3. The definitive branch is silent — MEDIUM

`ethereumHandler.ts:1684` and `rpcFailover.ts:117` both `throw e` with **no logging** — no URL,
no message. The transient branch right below logs properly. That asymmetry is the single
biggest reason this looked like a vault bug: the failing URL never appeared in the console.
Log before throwing.

### 4. `lastResortRpcs['eip155:1']` ordering — LOW

`lastResortRpcs.ts:35` — the working host is second. Put `eth.drpc.org` first. Cosmetic once
#2 lands, but it is why this bites immediately here.

---

## Test surface (already exists — extend, don't invent)

- `chrome-extension/src/background/utils.test.ts` — already covers `keepkey.com/launch` (line 44)
  and `connect ECONNREFUSED 127.0.0.1:1646` (line 53). Add: an RPC-origin `Failed to fetch`
  must **not** produce `VAULT_REQUIRED_MESSAGE`.
- `chrome-extension/src/background/chains/rpcFailover.test.ts` — add the browser-error strings
  from the table above and assert failover proceeds rather than throwing.
- `chrome-extension/src/background/chains/lastResortRpcs.test.ts` — ordering.

Commands: `pnpm test`, `pnpm type-check`, `pnpm lint` (turbo-driven, from repo root).

---

## Reproducing without waiting for a flaky RPC

The failure needs the **first** candidate to fail at connection level. Easiest lever is to point
the first entry of `lastResortRpcs['eip155:1']` (or a custom RPC via the Add Network UI, which
sorts ahead of everything — see `buildCandidates`, `rpcFailover.ts:50`) at an unroutable host,
then run any `eth_sendTransaction`. Pre-fix you get "Vault is not running"; post-fix you should
get a real RPC error, or a successful failover to the next URL.

To confirm what the active path will actually try, from the extension service-worker console:

```js
chrome.storage.local.get(null, d => console.log(JSON.stringify(d.web3Provider, null, 2)))
```

The active-provider path reads `storedRpcList(currentProvider)` (`getCandidateRpcs`,
`ethereumHandler.ts:1567`) — a **snapshot** taken at connect time, not live Pioneer. A stale or
reordered stored list is enough to trigger this on its own.

---

## Open question not resolved here

Which exact URL threw `Failed to fetch` in the reported session could not be determined,
because of finding #3 — the definitive branch logs nothing. Fix #3 first if you want that
answer before changing anything else.
