# Handoff (vault) — make a Solana bet show its amount before signing

**Date:** 2026-09-19
**From:** keepkey-client work on `fix/solana-decode-before-approval` (PR keepkey/keepkey-client#152)
**Vault repo:** `keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault`
**Related vault PR already open:** keepkey/keepkey-vault#449 (`POST /solana/decode-transaction`)

## The goal, in the user's words

> "user is betting x amount sol, need to understand the real risks"

Before approving, the user must see **how much leaves their wallet**. Today
neither the extension card nor the KeepKey screen can say, because nothing in
the system knows.

## What the real transaction looks like

Captured from SoltoshiDICE (`https://soltoshidice.wtf`) through the running
vault, legacy message, **2 instructions**:

1. `Compute Budget` → `setComputeUnitLimit(units=350000)` — decodes fine.
2. `CuTLp7…VWBR` → **unknown program**, 24 accounts, including the SDICE mint
   `4nCm…pump`, the SPL Token program, the System program and several PDAs.

There is **no System transfer and no SPL `transfer`/`transferChecked`
instruction in the message.** The funds move by CPI from inside the game
program, so the amount is not statically visible anywhere in the bytes. That is
exactly why the extension card renders "unrecognized instruction" and the vault
overlay says "Runs app code KeepKey cannot read … nobody can show you how much
before you sign."

That sentence is accurate. It is also the end of the road for a static decoder.

## Ask 1 — return the risk assessment from the decode endpoint (small)

PR #449's `POST /solana/decode-transaction` currently returns
`{ solanaDecoded, requiresBlindSigningConsent }` or `{ solanaDecodeError, … }`.

Please also return:

- `risk` — `assessSigningRisk({ method: '/solana/sign-transaction', solanaDecoded, deviceClearSigns })`
  from `src/shared/clearsign-risk.ts`, which already produces the headline and
  the per-reason lines the vault overlay shows.
- `deviceClearSigns` — whether a certified description was found for these exact
  bytes, the flag `applyRestSolanaSigningGates` sets at `src/bun/rest-api.ts:1866`.

**Why:** the extension is the FIRST screen the user sees, and it currently
re-words the risk itself, which means two sets of words for one transaction.
With `risk` on the response, the card shows the vault's exact sentences. One
risk engine, one vocabulary. The client side is ready to render it.

## Ask 2 — the amount, for programs nobody has decoded

Two approaches. They are complementary; (b) is the one that answers the user's
question for an arbitrary dApp.

### (a) Registry entry for the game program

Add `CuTLp7…VWBR` to `src/bun/solana-programs-local.json`, following the
"Relay Bridge" entry already there as the template: `discriminator`
(`{encoding: "anchor", offset: 0, length: 8}` if it is Anchor) plus an
`instructions` map whose schema names the `u64` bet amount.

That turns the row into `placeBet(amount=1000000000, …)` instead of
"unrecognized instruction", and `assessSigningRisk` can then state the amount.

Needs the program's IDL, or a layout reverse-engineered and **verified across
several bet sizes** the way the Relay entry documents (it tracked 0.5 /
0.123456789 / 0.999 SOL before being trusted). Contribute the entry upstream to
`@pioneer-platform/pioneer-discovery` afterwards.

Limit: this is per-program, forever. It does not generalize to the next dApp.

### (b) Simulate the transaction and show the balance delta

Run the unsigned transaction through the RPC's `simulateTransaction` with
`sigVerify: false`, `replaceRecentBlockhash: true`, and `accounts` set to the
signer's SOL account and its token accounts, then report the **pre/post deltas
for the signer**:

> This transaction takes **1,000 SDICE** and **0.0021 SOL** out of your wallet.

This works for any program, including funds moved by CPI, which is precisely the
case a static decoder cannot reach. Most major wallets answer this question this
way.

Rules for it:

- It is an **estimate against current chain state**, not a guarantee, and must be
  labelled as one. State changes and a different execution path can change it.
- It must **never** downgrade the blind-signing policy or set `deviceClearSigns`.
  The device still cannot read the call; simulation only informs the computer
  screen.
- A simulation failure must surface as "could not simulate", never as "no funds
  move". Same rule as `solanaDecodeError`.
- It needs an RPC round trip (the endpoint already resolves
  `solana_rpc_endpoint`), so keep it inside the existing decode call and let the
  extension show the decode first if simulation is slower.

Suggested shape on the decode response:

```jsonc
{
  "solanaDecoded": { … },
  "risk": { "level": "high", "headline": "…", "reasons": [ … ] },
  "simulatedDelta": {
    "ok": true,
    "sol": "-0.0021",
    "tokens": [ { "mint": "4nCm…pump", "symbol": "SDICE", "amount": "-1000" } ]
  }
}
```

## Ask 3 — the device screen still needs a certified description

Asks 1 and 2 fix the two computer-side screens. The KeepKey itself only shows a
call's details when a KeepKey-certified description (KKSOLSC1) exists for those
exact bytes — the `deviceClearSigns` path. Until SoltoshiDICE's instruction has
one, the device shows the blind-signing prompt and the user is trusting the
computer. Worth saying out loud in whatever ships, because the vault's own
wording already makes the right promise: "Your KeepKey screen is the final word."

## How to reproduce and test

1. Connect the extension on the dice site, place a bet, and let the approval
   appear.
2. Read the exact request through the MCP bridge:
   `bex_pending_requests` → `params[0]` is the transaction as `number[]`.
3. Feed those bytes to the decode endpoint:

```bash
DB="$HOME/Library/Application Support/com.keepkey.vault/dev/vault.db"
K=$(sqlite3 "file:$DB?immutable=1" "select api_key from paired_apps order by last_used_on desc limit 1;")
curl -s localhost:1646/solana/decode-transaction -H "Authorization: Bearer $K" \
  -H 'content-type: application/json' -d "{\"raw_tx\":\"<base64>\"}"
```

Bridge workflow: `projects/keepkey-vault/docs/handoff-driving-the-bex-mcp-tools.md`
in the vault repo.

## What the client already does (no action needed)

PR keepkey/keepkey-client#152 decodes through this endpoint **before** asking for
approval, renders one row per instruction, warns on blind signing and unresolved
ALTs, and shows a red refusal banner when decoding fails. It renders whatever the
endpoint returns, so `risk` and `simulatedDelta` are additive: no coordination
needed beyond the field names above.
