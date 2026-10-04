# Handoff — reviewing a Solana `signTransaction` in the extension

**Date:** 2026-09-19
**Repo:** `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client` (`develop`)
**Trigger:** the user driving SoltoshiDICE with a funded mainnet wallet saw
`TO: N/A / AMOUNT: N/A` and said "we cant review the tx in client".
**Status:** a fix landed here as `5355b5a` ("fix(solana): decode a dApp
transaction before asking the user to approve it") at 18:32 while this was being
diagnosed. This doc records what the original defect was, what that commit does
and does not solve, and the gaps that remain. Nothing was edited by this
investigation except this file.

---

## 1. The transaction that started it

Captured live from the extension over the vault MCP bridge
(`bex_pending_requests`), then decoded and checked against mainnet:

- `solana_signTransaction` from `https://soltoshidice.wtf/?room=the-block`,
  899 bytes, unsigned legacy message, 23 static accounts, 0 ALT entries,
  fee payer `Gu83nVMD8qh948D1vqe8UPoUHaFuSwcHrvNHetcM4Xux`.
- **ix0** ComputeBudget `setComputeUnitLimit(350000)`.
- **ix1** `CuTLp7pDmNGkFgi4aoh8Ef1YSjc2BzECQRLzYqaoVWBR` (SoltoshiDICE),
  26 bytes, tag `0x36` (54), 24 accounts:
  `tag u8 | round u64 = 1564 | wager u64 = 1_000_000_000 | u8 = 4 | deposit u64 = 10_000_000`
  → **a 1,000 SDICE Cee-lo bet plus a 0.01 SOL deposit.**

Field meanings are proven, not guessed: rounds 1558-1563 on the same table show
the round field incrementing by one per bet, the wager matching the signer's
SDICE debit to the unit, and the SOL delta minus fee exactly 10,000,000 lamports
every time.

**This is not the certified instruction.** The vault catalog covers SoltoshiDICE
*Blackjack join* — tag `0x51`, 82 bytes, mint at account index 3. Cee-lo is tag
`0x36`, 26 bytes, mint at position 5, so no certified description exists and
nothing clear-signs.

## 2. The original defect (fixed by 5355b5a)

`buildEvent()` created the approval event with no `unsignedTx` at all, while the
card read `unsignedTx.payment.{destination,amount}` — hence two literal `N/A`s.
The Raw tab was bound to the same missing object, so **no surface in the client
showed any part of the transaction**. Worse, approval was requested *before* the
vault decoded anything: the user pressed APPROVE on an empty screen, and the
vault's decode, risk bar and blind-signing policy all ran afterwards.

## 3. What 5355b5a achieves, and what it does not

It decodes via a new vault route before asking for approval, and gives Solana its
own branch in the card. For the transaction above it now renders:
`Instructions: 2 (legacy)`, a green `Compute Budget / setComputeUnitLimit`, an
orange `CuTLp7…VWBR / unrecognized instruction`, and "Blind signing — your
KeepKey cannot show what this transaction does."

That is an honest screen and a real improvement: "unknown program" is the truth,
where `TO: N/A` read as "nothing is being moved". **But the 1,000 SDICE and the
0.01 SOL still appear nowhere** — not in the extension, not in the vault overlay,
not on the device. The user still cannot review this transaction.

## 4. Gaps to close, roughly in order of value

1. **Show what leaves the wallet, with no catalog needed.**
   `keepkey-vault` already has `checkSolanaOutflow` (`src/bun/solana-outflow.ts`),
   which runs `simulateTransaction` and reports post-execution balances. It is
   imported only by `swap.ts` — not by the signing gate and not by the new decode
   route. Run against these bytes it names the SDICE and the SOL leaving the
   wallet for *any* program, including unknown ones. Label it honestly ("checked
   on this computer", host-side, not device-verified) and it turns this screen
   from "unknown program" into "1,000 SDICE and 0.01 SOL leave your wallet".
2. **Return the risk assessment from the decode route.** `assessSigningRisk`
   (`src/shared/clearsign-risk.ts`) already produces "Runs app code KeepKey cannot
   read (CuTLp7…VWBR). That code is able to move your SOL or tokens, and nobody
   can show you how much before you sign." The route currently returns only
   `{solanaDecoded, requiresBlindSigningConsent}`, and the card substitutes a
   weaker line that drops the "is able to move your SOL or tokens" part.
3. **Version skew will fire on every Solana transaction.** The handler hard-
   depends on `POST /solana/decode-transaction`. That route is **uncommitted** in
   the vault main checkout and **absent from vault `develop`** — so against any
   shipped vault the fetch 404s and the red "could not decode" banner shows for
   every Solana transaction, including ones the vault's own overlay decodes fine
   two steps later. Land the vault route first, then probe for it and degrade
   gracefully rather than alarming.
4. **Partial decodes render as confident ones.** `DecodedInstruction.note`
   carries messages like `truncated at arg "X" (need 8B, have 3B)`
   (`solana-instruction-decoder.ts:118, :245`). The route forwards it; the card
   never renders it, printing a clean-looking arg list instead. Render `note`, or
   treat a noted instruction as undecoded.
5. **Approve stays enabled when the decode fails**, including for
   `solana_signAndSendTransaction`, which broadcasts immediately. Gate it: on
   decode failure require the explicit blind-sign path, or refuse up front when
   the vault is unreachable.
6. **The send flow still shows `N/A`.** The new branch keys on
   `unsignedTx.kind === 'solana'`, but the side-panel transfer event writes
   `{from, to, amount, lamports, blockhash, txBase64}` with no `kind` and no
   `payment`, and every Solana event routes to the generic `other` renderer. A
   user-initiated SOL send therefore still falls through to the To/Amount table
   and renders `N/A` — now sitting directly below a Solana branch that looks like
   it covers it.

## 5. If you plan to certify Cee-lo (tag 0x36), read this first

- **The program is upgradeable.** `CuTLp7…VWBR` is owned by
  `BPFLoaderUpgradeab1e…`, programData `9HF5BoewAreFTHQgR6K3mvgkcG5cLy1mF4mnsUkHWBVM`,
  upgrade authority `5SD2yUKBHkUhpC7rHzEqLgYKHrkNoyYymNkDXmFaoJ1Y` still set. The
  authority can redeploy and change what tag `0x36` means while the device keeps
  showing the signed description. This applies to the shipped Blackjack entry too.
- **A certified schema binds the program, discriminator, data length and arg
  layout — not the destinations.** Account entries carry a *label*, never a pinned
  pubkey, and `spec.token` is not serialized. So "Game vault" would print beside
  whatever address the dApp supplied. A confidently-wrong screen is worse than
  "unknown program".
- **Don't ship labels from observation alone.** The Blackjack entry's provenance
  is a read of the dApp's own encoder function. The Cee-lo layout above is
  confirmed against seven on-chain bets, but the byte at offset 17 (always `4`)
  has no known meaning, and `serializeSolanaSchema` requires a real label for
  every argument.

## 6. Corrections to earlier notes in this thread

- Vault `develop` **does** contain `solana-outflow.ts`, `solana-token.ts`,
  `solana-message-preview.ts` and `solana-certified-policy.ts`; it also has
  `solana-certified-match.ts`, which the main checkout does not. The only thing
  develop lacks is the new decode route, which is uncommitted on the main
  checkout.
- `buildSolanaDecodedInfo` has four non-test call sites (`rest-api.ts`,
  `walletconnect.ts` ×2, `swap.ts`), not one. Any "extract it so the paths cannot
  drift" refactor has to cover all four.
- The instruction payload is **not** Anchor-style: it is a 1-byte tag, not an
  8-byte discriminator. Reading it as Anchor misaligns every field after it.

## 7. Reproducing

```bash
DB="$HOME/Library/Application Support/com.keepkey.vault/dev/vault.db"
K=$(sqlite3 "file:$DB?immutable=1" \
  "select api_key from paired_apps order by last_used_on desc limit 1;")
curl -s localhost:1646/mcp -H "Authorization: Bearer $K" \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"bex_pending_requests","arguments":{"browser":"b2"}}}'
```

The full bridge workflow is in the vault repo:
`projects/keepkey-vault/docs/handoff-driving-the-bex-mcp-tools.md`.
