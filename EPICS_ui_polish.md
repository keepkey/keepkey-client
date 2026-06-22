# EPICS — KeepKey BEX side-panel UI polish

**Date:** 2026-06-22
**Branch context:** `feat/side-panel-swap`
**Source:** 9-agent investigation across scam-token strategy, asset-page loading, token icons,
balance/portfolio data architecture, the swap design system, design-consistency gaps, and
in-flight/unfinished projects. All findings grounded in file:line evidence.

---

## TL;DR

The user-visible symptoms (scam "Mortal" token on the dashboard, empty token list until manual
refresh, missing/gray-circle icons, pages that don't match the swaps or the design doc) are not
independent bugs. They trace to **four cross-cutting root causes**, and in most cases the *fix
already exists as written-but-unwired code* — the work is extraction/adoption, not new build.

### Cross-cutting root causes

1. **Two design systems, one conflicting accent.** The `swap/` folder ships its own inline-style
   theme (`swap/theme.ts`, accent = **lime-green**, oklch hue 84) plus polished primitives
   (`PrimaryBtn`, `TokenButton`, `TokenGlyph`, `IconBtn`, `Icon`). Everything else renders through
   Chakra (`styles/theme/index.ts`) where `kk.accent` = **KeepKey gold `#d29929`**. The
   surface/line/text hexes are byte-identical in both files — the *only* real divergence is the
   accent, plus the fact that swap's primitives are scoped and un-reusable. **Until gold-vs-lime is
   decided, no other UI-consistency work can converge.**

2. **One portfolio cache, many divergent read paths.** `cachedBalances` (one Pioneer
   `/api/v1/portfolio` call) is the single source of truth, but surfaces read it through three
   different message types with different semantics: `GET_APP_BALANCES` (passive read, never forces
   discovery), `REFRESH_ALL_BALANCES` (forces discovery via `?forceRefresh=true`), and
   `GET_EVM_BALANCE` (divergent live-RPC). Verified at `index.ts:542,1665-1695`. This single
   divergence causes **the empty-token-on-first-load bug, the dashboard-vs-detail USD mismatch, and
   part of the spam problem.**

3. **Price is conflated with trust and with value.** `valueUsd`/`priceUsd` come entirely from
   Pioneer with no client fallback; a missing price silently becomes `'0'`. That one fact
   simultaneously (a) hides real holdings from the donut/total, (b) drops legit not-yet-priced
   tokens into the spam `<$1` / fake-stablecoin tiers, and (c) lets scam tokens with a fabricated
   `>=$1` price ("Mortal") pass every heuristic. Suppression is deny-by-heuristic with **no
   allowlist**, and the per-token user-override layer is **written but 100% dead code**
   (`filterSpamTokens` at `index.ts:542` is called with no overrides map;
   `getTokenVisibilityMap`/`setTokenVisibility` are imported nowhere outside `spamFilter.ts`).

4. **Polished replacements already exist for the legacy surfaces.** The `swap/` folder and its
   primitives are the design-correct counterparts to legacy `History.tsx`, the Transfer confirm
   modal, and ad-hoc rows. `spamFilter.ts` overrides, `activityReport.ts`, `swapEventStream.ts`,
   and `SwapHistory.tsx` are **in-flight code to finish wiring, not restart.**

5. **Vault REST endpoints gate the activity/history initiative.** Client intake (`activityReport.ts`
   at the EVM chokepoint) and SSE (`swapEventStream.ts`) are code-complete but inert until vault
   deploys `POST /api/v2/activity/intake` and `GET /api/v1/activity`. External blocker, not a
   client bug.

---

## Recommended sequence

| Order | Epic | Why now |
|---|---|---|
| 1 | **EPIC-1** Unify design system / accent | Hard prerequisite; nothing else converges until gold-vs-lime is decided |
| 2 | **EPIC-2** Wire token hide override | P0, near-free, no deps; immediate kill switch for "Mortal" — ship parallel to EPIC-1 |
| 3 | **EPIC-3** Empty-token-on-first-load fix | P0 user-facing bug, surgical, independent — ship parallel to EPIC-1/2 |
| 4 | **EPIC-4** Shared AssetIcon | P1 visible polish (gray circles); soft-depends on EPIC-1 accent only |
| 5 | **EPIC-5** Harden portfolio data layer | Fixes the read-path/price root cause; unblocks 6 + accurate swap Max |
| 6 | **EPIC-6** Durable scam suppression | Makes "Mortal" disappear by default; depends on EPIC-2 + EPIC-5 |
| 7 | **EPIC-7** Migrate legacy pages | Bulk of polish; after EPIC-1 locks accent/primitives + EPIC-4 icon |
| 8 | **EPIC-8** Vault-gated activity/history + swap follow-ups | Mostly done; gated on external vault endpoints |

### Quick wins (high value, low effort — do first)

- **Wire the token-visibility override end-to-end** (EPIC-2): `SET_TOKEN_VISIBILITY` handler + load
  `getTokenVisibilityMap()` into `fetchBalancesFromPioneer` + pass it to `filterSpamTokens` at
  `index.ts:542` (already accepts the map) + a "Hide token" row action in `Tokens.tsx`. Lets a user
  permanently kill "Mortal" **today** — the storage layer already exists as dead code.
- **Pick the canonical accent** and make `swap/theme.ts` and `styles/theme/index.ts` agree
  (`theme.ts:25,39` / `index.ts:77-79`). One small change fixes the single most-complained-about
  mismatch.
- **Stop `GET_APP_BALANCES` treating a natives-but-token-less cache as complete** (EPIC-3) — kick a
  fire-and-forget force-refresh; the `BALANCES_UPDATED` listener already repaints, removing the
  Refresh workaround.
- **Add a "Discovering tokens…" state** to `Tokens.tsx` distinct from "No Tokens Found" (EPIC-3).
- **Replace the stray `Spinner color='green.300'`** in swap (`SwapHistory.tsx:60`, `Swap.tsx:409,552`)
  and Balances' hardcoded teal loader (`Balances.tsx:104,233,269`) with the theme accent.
- **Delete dead code while migrating:** the network `<Select>` block in `History.tsx:148-160` and
  the unused `useColorModeValue` light branch in `Transfer.tsx:62-63` (app is dark-only).
- **Update the stale `MEMORY.md` "Balance fetching deferred (returns empty)" note** so future
  reviewers stop misdiagnosing the token bug as the deferred-stub case.

---

## EPIC-1 — Unify the design system: one accent, one shared primitive set
**Priority:** P0 · **Effort:** M · **Depends on:** —

**Problem.** Two parallel theme systems disagree on the most visible token: swap CTAs are
lime-green (`swap/theme.ts` accent oklch hue 84) while every other primary action is KeepKey gold
(`kk.accent = #d29929`). Surface/line/text hexes are duplicated byte-identically across both files,
and the swap primitives take `T` as a prop so no Chakra page can reuse them.

**Scope.**
- Lock the canonical accent (gold vs lime) as a **product/brand decision** (reports lean gold); use
  the `_design-bex` live accent-hue picker as reference. Gates EPIC-2/4/6/7.
- Make both theme files agree on accent (retarget `swap/theme.ts` to gold, or remap
  `styles/theme/index.ts` `kk.accent/accentDim/accentEdge` + gold Button variant to lime).
- Collapse the duplicated surface/line/text palette into one shared constants module both themes
  derive from.
- Generate status hex fallbacks (`good/warn/bad`) from the same OKLCH source values.
- Promote `swap/ui.tsx` primitives + `swap/icons.tsx` + the `T` object to a shared location.
- Replace the three stray `Spinner color='green.300'` (`SwapHistory.tsx:60`, `Swap.tsx:409,552`).

**Affected:** `swap/theme.ts`, `swap/ui.tsx`, `swap/icons.tsx`, `styles/theme/index.ts`,
`swap/SwapHistory.tsx`, `swap/Swap.tsx`.

**Acceptance.** Swap CTA and every Chakra solid primary button render the same accent (side-by-side
verified) · surface/line/text hexes defined in exactly one module (grep confirms no second copy) ·
`good/warn/bad` identical across surfaces · `swap/ui.tsx` primitives importable by a non-swap page
unmodified · zero `Spinner color='green.300'` in swap.

**Build on:** `swap/theme.ts` (T + makeTheme), `swap/ui.tsx`+`icons.tsx` (primitives to promote),
`styles/theme/index.ts` (gold Button variants + `kk.*` tokens), `_design-bex/KeepKey Extension.html`.

**Risks.** Wrong accent forces a redo of downstream migrations — lock the decision first · mixing
inline-style primitives into Chakra pages: keep the T-prop adapter thin.

---

## EPIC-2 — Kill scam tokens NOW: wire the existing per-token hide override
**Priority:** P0 · **Effort:** S · **Depends on:** —

**Problem.** Scam tokens like "Mortal" show fabricated USD balances right now. A complete per-token
hide/show override layer already exists in `spamFilter.ts`
(`getTokenVisibilityMap`/`setTokenVisibility`/`removeTokenVisibility`, storage key
`keepkey-token-visibility`) but is **100% dead code**: imported nowhere outside `spamFilter.ts`, and
the single `filterSpamTokens` call at `index.ts:542` passes no overrides map (the function already
accepts it as its 2nd arg). Wiring it gives an immediate, permanent kill switch with near-zero
effort and no dependency on the data-layer rework.

**Scope.**
- Add a `SET_TOKEN_VISIBILITY` (and `HIDE_TOKEN`) background handler calling
  `setTokenVisibility(caip, status)`.
- Load `getTokenVisibilityMap()` inside `fetchBalancesFromPioneer` and pass it to `filterSpamTokens`
  at `index.ts:542`.
- Add a per-row "Hide token" action in `Tokens.tsx` (honors tier-0 user override, absolute
  precedence).
- Keep the single chokepoint (`index.ts:542`) authoritative — do **not** add filtering in
  `Tokens.tsx`/`SidePanel.tsx`.
- Add `spamFilter.test.ts` cases: a `hidden` override removes a token; un-hidden reappears.

**Affected:** `spamFilter.ts`, `spamFilter.test.ts`, `index.ts`, `Tokens.tsx`.

**Acceptance.** User can hide "Mortal" from a row and it stays hidden across reloads/worker
restarts · override honored at the single chokepoint · grep confirms
`setTokenVisibility`/`getTokenVisibilityMap` now referenced outside `spamFilter.ts` · new override
tests pass.

**Build on:** `spamFilter.ts` override functions + `STORAGE_KEY` (fully implemented dead code) ·
`filterSpamTokens` already accepts the overrides map · `index.ts:542` chokepoint.

**Risks.** Hide UI must round-trip the caip exactly (lowercased) the way `detectSpamToken` looks it
up, or the override silently no-ops.

---

## EPIC-3 — Fix empty-token-on-first-load via discovery-aware balance reads
**Priority:** P0 · **Effort:** M · **Depends on:** —

**Problem.** Tokens are empty on Asset Detail on first load and only populate after Refresh. Mount
calls `GET_APP_BALANCES` (passive cache read, never forces Pioneer token discovery); Refresh calls
`REFRESH_ALL_BALANCES → fetchBalancesFromPioneer(true)`, the only path that sets `?forceRefresh=true`
and triggers ERC-20/SPL/TRC-20 discovery. `GET_APP_BALANCES` only refetches when
`cachedBalances.length===0` (`index.ts:1667`), so a natives-but-token-less cold cache is treated as
complete. `Tokens.tsx` renders "No Tokens Found" with no loading-vs-empty-vs-discovering
distinction. **This is NOT the stale "balance fetching deferred" memory note — Pioneer fetching IS
implemented.**

**Scope.**
- Make first mount trigger discovery (force-refresh the first time a network shows zero tokens, or an
  opt-in force flag on `GET_APP_BALANCES`). `BALANCES_UPDATED` already repaints.
- Fix `GET_APP_BALANCES` so a natives-but-token-less cache isn't treated as complete — kick a
  fire-and-forget force-refresh while returning the cache immediately.
- Add a third `Tokens.tsx` state ("Discovering tokens…") distinct from genuine empty.
- Resolve the cold-start race so the post-prefetch force-refresh (`index.ts:847-849`) is what users
  wait on.
- Update the stale `MEMORY.md` deferred-balance note.

**Affected:** `Tokens.tsx`, `index.ts`, `AssetDetail.tsx`.

**Acceptance.** Cold-load → open Asset Detail immediately → tokens populate without manual Refresh ·
distinct "discovering" state · `GET_APP_BALANCES` initiates discovery when a network has natives but
no tokens · genuinely token-free wallet still shows real empty state · forced refreshes deduped.

**Build on:** `fetchBalancesFromPioneer` + the existing handlers · `Tokens.tsx:90-97`
`BALANCES_UPDATED` listener (partial Solana-SPL mitigation already in place).

**Risks.** Forcing refresh on every empty-network mount could spam Pioneer — gate on "first time" /
dedupe via the in-progress promise.

---

## EPIC-4 — Shared AssetIcon with deterministic monogram fallback
**Priority:** P1 · **Effort:** M · **Depends on:** EPIC-1 (accent token only)

**Problem.** No single icon component. The main UI hand-rolls a guessed keepkey.info "coins" URL
(copy-pasted `btoa` across ~6 sites: `index.ts:463/488/527`, `AssetDetail:64`) that 404s for most
ERC-20/SPL/TRC-20/IBC tokens, while swap already has a clean monogram fallback (`ui.tsx` TokenGlyph
+ `theme.ts` colorForSymbol). Because the background fills a non-empty guessed URL, empty-value
fallbacks never fire, and most sites use a bare Chakra `Avatar` with no `name`/`onError` → broken
icons render as gray circles. `History.tsx` reads `iconUrl` from a dead placeholder fetch.

**Scope.**
- Create one shared `AssetIcon` (generalize swap's `TokenGlyph` `ui.tsx:18-57` + `colorForSymbol`)
  used everywhere including swap.
- Resolution order: provider/real icon URL → `caipToIcon` (`chainConfig.ts:118`) → optional
  coingecko → deterministic monogram on `onError`.
- Replace inline `btoa` URL construction with `caipToIcon`; stop the background filling a guessed
  non-empty URL that suppresses fallbacks.
- Migrate bare `Avatar` sites: `Balances:337`, `AssetDetail:197`, `Receive:463/485`,
  `NetworkDropdown:84/126`.
- Fix `History.tsx`'s dead `iconUrl` placeholder fetch (`History.tsx:95`).

**Affected:** `Tokens.tsx`, `AssetDetail.tsx`, `Balances.tsx`, `Receive.tsx`,
`header/NetworkDropdown.tsx`, `History.tsx`, `packages/shared/lib/utils/chainConfig.ts`, `index.ts`.

**Acceptance.** Single `AssetIcon` used by all token/asset renders including swap (no bare `Avatar`
without `onError`) · tokens without a working URL show a colored monogram, never a gray circle · no
copy-pasted `btoa` icon-URL construction remains · `History.tsx` no longer depends on the dead fetch.

**Build on:** `swap/ui.tsx` TokenGlyph (`ui.tsx:18-57`) + `colorForSymbol` · `caipToIcon`
(`chainConfig.ts`, currently bypassed) · `SwapHistory.tsx`+`SwapReview.tsx` already consume
TokenGlyph · `useCustomTokens.ts:260` carries a coingecko id usable as a fallback tier.

**Risks.** Coingecko tier adds external latency — keep it optional, behind the monogram default.

---

## EPIC-5 — Harden the portfolio data layer: status states, price fallback, persistence
**Priority:** P1 · **Effort:** L · **Depends on:** EPIC-3

**Problem.** The dashboard total + donut are driven by `cachedBalances`, but the architecture has
resilience gaps: (1) `AssetDetail` re-fetches EVM natives via a divergent `GET_EVM_BALANCE` live-RPC
path so asset page and dashboard can disagree on USD; (2) pricing is fully delegated to Pioneer and
silently becomes `'0'` for custom-RPC chains and unpriced tokens, hiding real value and pushing
legit tokens into spam tiers; (3) every failure path returns `cachedBalances`, so fetch-failure is
indistinguishable from no-assets, and the asset list renders the full static chain catalog
regardless of holdings; (4) no persistent cache/TTL, so MV3 worker eviction shows a transient $0
dashboard.

**Scope.**
- One canonical background accessor (e.g. `getPortfolio()`) returning
  `{balances, status: loading|ok|error|empty, updatedAt}`; route `GET_APP_BALANCES`, `GET_CHARTS`,
  asset-detail, send, receive through it.
- Remove/reconcile the divergent `GET_EVM_BALANCE` live-RPC path so there's exactly one number per
  asset (drop it, or write its result back into `cachedBalances`).
- Stop returning `cachedBalances` on error; return explicit status → distinct loading /
  error-with-retry / empty states.
- Decouple "has a balance" from "has a price": keep `balance>0` rows even when `valueUsd` is
  0/missing, render a "price unavailable" affordance, add a **Pioneer-sourced (not hardcoded)**
  client price fallback.
- Drive the asset list from the held-balance set (`balance>0`), not the full static
  `ChainToNetworkId` catalog; keep the catalog behind the explicit "Add blockchain" picker.
- Persist last-good portfolio (balances + `updatedAt`) to `chrome.storage.local`; hydrate on worker
  start then revalidate (removes cold-start $0 flash; enables "stale since X").

**Affected:** `index.ts`, `spamFilter.ts`, `SidePanel.tsx`, `Balances.tsx`, `DonutChart.tsx`,
`AssetDetail.tsx`.

**Acceptance.** Same asset shows identical USD on dashboard and detail · balance with missing price
still shown (marked "price unavailable"), not hidden/counted as $0 spam · Pioneer 5xx/timeout →
distinct error state with retry, not "No assets found" · asset list shows only held chains/tokens ·
reopening after worker eviction shows last-good portfolio then revalidates ·
**`getSendPubkeys`/account-0 send-scoping unchanged (regression-checked)**.

**Build on:** `fetchBalancesFromPioneer` + custom-RPC enrichment (`index.ts:497-539`) ·
`wallet.ts:330-335` `getSendPubkeys` account-0 broadening (**fund-critical invariant**) ·
multi-account aggregation (`accountsByNetworkStorage`/`buildAccountPaths`).

**Risks.** `getSendPubkeys`/account-0 scoping is fund-critical — do not regress while refactoring ·
client price source must not re-introduce hardcoded RPCs (Pioneer is source of truth).

---

## EPIC-6 — Durable scam suppression: value floor, allowlist, price-aware tiers
**Priority:** P1 · **Effort:** M · **Depends on:** EPIC-2, EPIC-5

**Problem.** Even with the per-token hide override wired (EPIC-2), the default filter is
deny-by-heuristic and still *shows* scam tokens like "Mortal" until a user manually hides them.
`filterSpamTokens` drops only `confirmed` tokens; a benign-looking token with a fabricated
`valueUsd >= $1` lands as `clean` (or deliberately-kept `possible`) and survives. No trusted-CAIP
allowlist, no hard value-floor drop, and the value tiers misfire when `priceUsd` is 0/missing
(dropping legit not-yet-priced tokens).

**Scope.**
- Value-threshold path: hide low-value non-allowlisted tokens by default OR surface them in a
  collapsed "Hidden (low value / suspicious)" section that stays user-recoverable.
- Trusted-CAIP/contract allowlist (or Pioneer's `verified` flag if `/portfolio` carries one — verify
  the row fields at `index.ts:471-495`) to move toward allow-by-trust.
- Make value tiers price-aware: skip Tier-4 (fake stablecoin) and Tier-6 (`<$1`) checks when
  `priceUsd` is 0/missing (uses EPIC-5 price handling).
- Strengthen the dust-airdrop heuristic to be disjunctive, not huge-qty AND near-zero-price together.
- Tests: a benign-symbol token with fabricated `valueUsd>=$1` is suppressed; a not-yet-priced legit
  token is NOT dropped.

**Affected:** `spamFilter.ts`, `spamFilter.test.ts`, `index.ts`, `Tokens.tsx`.

**Acceptance.** Benign-symbol token with fabricated `valueUsd>=$1` suppressed without manual hide ·
auto-hidden tokens recoverable via the collapsed section + EPIC-2 un-hide · legit not-yet-priced
token not dropped · new "Mortal"/price-aware tests pass · filtering stays at the single chokepoint.

**Build on:** `detectSpamToken` tiers + `KNOWN_LEGIT_SYMBOLS` (extend toward an inclusion gate) ·
`spamFilter.test.ts` · `index.ts:542` chokepoint.

**Risks.** Hard value-floor risks hiding legit small holdings — pair every auto-hide with the
recoverable section + EPIC-2 un-hide · allowlist maintenance — prefer a Pioneer `verified` flag.

---

## EPIC-7 — Migrate legacy pages onto the design tokens and shared primitives
**Priority:** P2 · **Effort:** XL · **Depends on:** EPIC-1

**Problem.** Most non-swap pages never adopted the design system — raw Chakra `colorScheme`
(blue/teal/orange/green/purple), `gray.700/800/900` surfaces, ad-hoc rgba whites, no shared
Row/Card/Button. Worst offenders: Settings, History, Connect, Transfer (the Send flow), Tokens;
AssetDetail and header dropdowns close behind. `Receive.tsx`/`Balances.tsx` are the reference for a
correctly token-consuming Chakra page.

**Scope.**
- Extract one shared `<Row>` and one surface/Card (`Balances`' `kk.surface` + `kk.line` + 12px is
  closest); migrate Tokens, AssetDetail activity rows, header dropdown rows onto it.
- Replace every `colorScheme='blue|teal|orange|green'` solid button with the canonical accent
  button: `Transfer.tsx:387`, `AssetDetail.tsx:264-301` (tri-color Send/Receive/Swap),
  `Settings.tsx:184-311`, `Connect.tsx:94-101`, `History.tsx:254-261`.
- Migrate pages off raw `colorScheme`/`gray.*`/rgba onto `kk.*` in user-impact order: Transfer
  (Send) and Connect first, then Settings, History, Tokens, AssetDetail, then
  NetworkDropdown/AccountDropdown.
- Replace `DonutChart` raw palette (`DonutChart.tsx:5-11`) with theme accent/status tokens.
- Replace `Balances`' hardcoded teal loader (`Balances.tsx:104,233,269`) with the theme accent.
- Fix `Connect`'s white `rgba(255,255,255,0.8)` full-card spinner overlay that flashes light.
- Cleanup: delete dead `History.tsx:148-160` `<Select>` and unused `Transfer.tsx:62-63`
  `useColorModeValue` light branch (app is dark-only).

**Affected:** `Settings.tsx`, `History.tsx`, `Connect.tsx`, `Transfer.tsx`, `Tokens.tsx`,
`AssetDetail.tsx`, `DonutChart.tsx`, `Balances.tsx`, `header/NetworkDropdown.tsx`,
`header/AccountDropdown.tsx`.

**Acceptance.** No page uses raw `colorScheme='blue|teal|orange'` for primary actions (grep audit) ·
Settings/History/Connect/Transfer/Tokens/AssetDetail render surfaces/rows from `kk.*` or the shared
Row/Card · DonutChart + Balances loader use theme tokens · Connect no longer flashes white · dead
History `<Select>` and Transfer light-mode branch removed.

**Build on:** `Receive.tsx`+`Balances.tsx` (reference) · `swap/SwapHistory.tsx` (counterpart to
legacy History) · `swap/SwapReview.tsx` (counterpart to the Transfer confirm modal) · swap
primitives promoted in EPIC-1 + `AssetIcon` from EPIC-4.

**Risks.** Large surface — sequence by impact (Transfer/Send, Connect first), ship per-page to avoid
a giant unreviewable diff · Tokens/AssetDetail rows intersect EPIC-3/4/5; coordinate so each row is
restyled once, after its data-state and icon work lands.

---

## EPIC-8 — Land unified activity & swap history (vault-gated) + deferred swap follow-ups
**Priority:** P3 · **Effort:** L · **Depends on:** EPIC-5

**Problem.** A native side-panel swap flow (assets→quote→review→execute→progress→history) is ~90%
complete and wired end-to-end. The newest activity-intake + unified-history work is code-complete on
the client but **blocked on vault** deploying `POST /api/v2/activity/intake` and
`GET /api/v1/activity`. `activityReport.ts` is wired only at the EVM broadcast chokepoint,
`swapEventStream.ts` SSE is unverified end-to-end, and there's no general activity-history UI yet.
Deferred swap follow-ups remain: manual nonce override, accurate swap Max/50%, tap-a-history-row to
reopen tracking.

**Scope.**
- Track the two vault endpoints as explicit external blockers
  (`HANDOFF_vault_activity_intake_and_history.md`).
- Once intake is live, add the general activity-history UI by mirroring `SwapHistory.tsx`, reading
  `/api/v1/activity`.
- After intake deploys, land the planned one-line `reportActivityToVault` calls at the non-EVM
  broadcast sites (btc/ltc/doge/dash/bch, solana, tron, cosmos/osmosis/thorchain/maya, ripple, ton).
- Verify `/api/v2/swap/*` are live on the target vault build; ensure the EIP-1559 firmware signing
  fix is flashed for EVM swaps to broadcast (`RESOLUTION_evm_tx_1559_signing_chain.md`).
- E2E-verify the SSE accelerator (`swapEventStream.ts`); otherwise disable it in favor of the 4s
  poll.
- Deferred: manual nonce override in `NonceInfoRow.tsx`; accurate swap Max/50% via Pioneer HTTP
  max-spendable (+ UTXO empty-caip networkId fallback, `Swap.tsx:147-180`,
  re-implement `index.ts:1067` removal); tap-a-history-row to reopen tracking in `SwapHistory.tsx`.

**Affected:** `activityReport.ts`, `swapEventStream.ts`, `swapHandler.ts`,
`chains/ethereumHandler.ts`, `chains/bitcoinHandler.ts`, `swap/SwapHistory.tsx`, `swap/Swap.tsx`,
`approval/evm/NonceInfoRow.tsx`, `index.ts`.

**Acceptance.** With vault intake + `/api/v1/activity` deployed, a general activity-history UI
renders sends+swaps+defi · EVM and major non-EVM broadcast sites report txids · swap quote/execute
confirmed live · SSE "Live" indicator verified (or SSE explicitly disabled for the poll) · nonce
override editable · swap Max accurate for EVM + UTXO · tapping a SwapHistory row reopens tracking.

**Build on:** `activityReport.ts` (intake wired at EVM chokepoint) · `swapEventStream.ts` (SSE via
SWAP_WATCH/UNWATCH) · `swap/SwapHistory.tsx` (mirror for general history) ·
`HANDOFF_vault_activity_intake_and_history.md` · `RESOLUTION_evm_tx_1559_signing_chain.md` ·
`index.ts:1067` (SwapKit max-spendable removal point).

**Risks.** Hard external dependency on vault endpoints — client work inert until then · manual nonce
override can produce stuck/replaced txs — guard with the existing replace warning · swap Max accuracy
depends on EPIC-5 — don't ship Max before that lands.
