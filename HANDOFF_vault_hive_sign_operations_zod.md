# HANDOFF → vault: `/hive/sign-operations` 500s on every request (Zod 3 syntax on Zod 4)

**From:** keepkey-client Hive Keychain work, 2026-07-15 (PRs #107/#108 merged to
`develop`, client rebuilt at 0.0.36).
**For:** whoever owns `keepkey-vault`. This is a vault-side change; the client
side needs nothing.

**Repo:** `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11`
**File:** `projects/keepkey-vault/src/bun/schemas.ts` **line 203**
(the vault repo is `github.com/keepkey/keepkey-vault`; `src/bun` lives under
`projects/keepkey-vault/` in the v11 checkout — a known foot-gun)

No branch exists for this. It is a one-line fix; I did not open one, per the
no-cross-repo-changes rule.

---

## The bug

`POST /hive/sign-operations` returns **500** for *every* request, before any
device interaction:

```json
{"error":"undefined is not an object (evaluating 'def.valueType._zod')"}
```

`schemas.ts:203`, inside `HiveSignOperationsRequest`:

```ts
operations: z.array(z.tuple([z.string(), z.record(z.any())])).min(1).max(4),
```

`z.record(z.any())` is **Zod 3** syntax. The vault is on **Zod `^4.3.6`**
(`projects/keepkey-vault/package.json:49`). In Zod 4, `z.record()` requires two
arguments — `z.record(keyType, valueType)`. Called with one, `keyType` becomes
`z.any()` and `valueType` is `undefined`, so Zod's record internals dereference
`def.valueType._zod` on `undefined` and throw.

The throw happens at **schema-construction/parse time**, so the endpoint is
100% dead — not data-dependent, not a bad-request case. Any Hive op request
fails identically.

## The fix

```ts
operations: z.array(z.tuple([z.string(), z.record(z.string(), z.any())])).min(1).max(4),
```

Hive condenser op payloads are always string-keyed objects, so `z.string()` is
the correct key type and the accepted-input set is unchanged.

**Scope: this is the only occurrence.** `grep -rn "z\.record(" src/` over the
vault source returns exactly one hit, line 203. Nothing else needs touching.

## Reproduction

Run against the vault's own installed Zod (from
`/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault`):

```js
const ops = [['vote', { voter:'a', author:'b', permlink:'c', weight:10000 }]];

z.array(z.tuple([z.string(), z.record(z.any())])).min(1).max(4).parse(ops);
// throws: Cannot read properties of undefined (reading '_zod')

z.array(z.tuple([z.string(), z.record(z.string(), z.any())])).min(1).max(4).parse(ops);
// parses OK
```

Confirmed against `node_modules/zod` in that checkout. Note the wording
differs by engine — **Node** says `Cannot read properties of undefined
(reading '_zod')`, **Bun** says `undefined is not an object (evaluating
'def.valueType._zod')`. The vault runs on Bun, which is why the client sees the
latter. Same bug.

## What I have NOT verified

I reproduced the schema failure in isolation, **not** a live fixed request
end-to-end. I did not rebuild or restart the vault (no cross-repo changes), so
nothing downstream of validation has been exercised.

## Why this is probably the whole blocker for Vote

Worth knowing before you scope this larger than it is: `vote` is a **phase-1**
op, not part of the unlanded phase-2 firmware table that keepkey-client PR #108
flags as a dependency. `projects/keepkey-vault/src/bun/txbuilder/hive-ops.ts:4`
declares "Phase-1 ops: vote (0), comment (1), custom_json (18)", and the
serializer case at `:121` is fully implemented (`OP_VOTE = 0`, varint + voter +
author + permlink + weight).

So the path past this schema fix — serialize → device clear-sign → broadcast —
looks complete for `vote`. **Expect this one-line change to make voting work.**
Power up / delegation / conversion still wait on the phase-2 firmware table;
vote does not.

## Gap this points at

`/hive/sign-operations` is dead on arrival for every input, which means it has
**no request-level test** — nothing constructs `HiveSignOperationsRequest` and
parses a payload through it. A single `bun test` that parses one representative
condenser tuple would have caught this at the moment the schema was written, and
would catch the next Zod 3→4 holdover. The Zod 4 migration is the kind of change
that leaves exactly this residue, so it is worth grepping other services on the
same major for single-arg `z.record(` / `z.map(`.
