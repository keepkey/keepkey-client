# Resolution — EIP-1559 type-2 tx signing chain (release blocker)

**Status:** ✅ **ROOT CAUSE IDENTIFIED — fix in flight**
**Resolved on:** 2026-04-28 (continuation of same-day investigation)
**Fix lives in:** firmware (`keepkey-firmware/lib/firmware/ethereum.c`), PR pending against `BitHighlander/keepkey-firmware:develop`.

Supersedes [`RETRO_evm_tx_1559_signing_chain.md`](RETRO_evm_tx_1559_signing_chain.md). Read this first; the older retro is a record of the diagnostic dead-ends, not the answer.

---

## TL;DR

The KeepKey firmware has a one-line ordering bug in EIP-1559 signing. When the transaction's `data` field exceeds 1024 bytes (the single-USB-chunk threshold), the firmware hashes the empty access-list byte `0xC0` **between** the first chunk and the remaining chunks, producing a non-canonical pre-image:

```
keccak( 0x02 || rlp_list_len || chainId || nonce || maxPri || maxFee
        || gasLimit || to || value
        || data_len_prefix
        || data[0..1024]
        || 0xC0           ← bug: should be after ALL data
        || data[1024..end] )
```

The signature is mathematically valid for that mangled hash, so it recovers to a wrong-but-deterministic address. Every Uniswap Universal Router swap, Permit2 batch, large multicall — anything pushing tx-data past 1024 bytes — hits it. Single-chunk transactions (≤1024 bytes) escape because the misplaced `0xC0` happens to land at the end anyway.

**Location:** `keepkey-firmware/lib/firmware/ethereum.c:891-895`.

---

## How we found it (the move that finally worked)

The prior session's hypothesis battery (30+ pre-image variants tested offline) was hunting the wrong axis: it assumed the firmware was hashing the canonical *fields* but in some non-canonical *layout*. The bug is the opposite — fields and layout are correct; the *byte stream order* is wrong only when chunked transmission is involved.

The unlock was reading the firmware proto more carefully:

```proto
// messages-ethereum.proto
message EthereumTxRequest {
  optional uint32 signature_v = 2;
  optional bytes  signature_r = 3;
  optional bytes  signature_s = 4;
  optional bytes  hash        = 5;   // ← KeepKey custom field — the actual signed hash
}
```

`EthereumTxRequest.hash` is a custom KeepKey extension. The firmware has been reporting the hash it signed all along (see `ethereum.c:300-302`), but `hdwallet/src/ethereum.ts` was reading only `r/s/v` and discarding the hash field. Wiring it through gave us the smoking gun in one device sign:

```
deviceSignedHash:  0x385868e52dadf5efc378d12eaf596c61ed94a675474e73c2076da9b8c1eba2c4
canonical hash:    0xe93917b6c4da282868f167999f09f5d5f082bdf19f5ffb5dfbf2f19b9441f147
```

Different — so the firmware definitely hashed the wrong bytes. Then variant #17 in `find-preimage.js` (manually-built stream with 0xC0 sandwiched between data chunks) matched `0x385868e5…` exactly. Done.

**Lesson for future-you:** when an EVM signature recovers to a wrong address, the first move is `response.getHash_asU8()` from the firmware, not yet-another offline hash hypothesis.

---

## The fix

Move the `0xC0` write so it fires *right before each `send_signature()` call*, not after the initial chunk. The single-chunk case currently works only by accident — the fix should make both paths correct by construction.

```c
// ethereum.c — sketch
static void hash_access_list_if_eip1559(void) {
  if (ethereum_tx_type == ETHEREUM_TX_TYPE_EIP_1559) {
    uint8_t datbuf[1] = {0xC0};
    hash_data(datbuf, sizeof(datbuf));
  }
}

// ethereum_signing_init: replace the 0xC0 block at line 891
if (data_left > 0) {
  send_request_chunk();
} else {
  hash_access_list_if_eip1559();
  send_signature();
}

// ethereum_signing_txack: add before send_signature()
if (data_left == 0) {
  hash_access_list_if_eip1559();
  send_signature();
}
```

That's the entire fix. Two move-points, one helper. No protocol changes.

---

## Verification

- **Offline regression** (no device): `keepkey-vault-v11/projects/keepkey-sdk/tests/evm-tx-1559/recover-fixture.js` will pass when re-signing the captured fixture against firmware that has the fix.
- **Live regression** (paired device): `tests/evm-tx-1559/sign-and-recover.js` re-signs the captured input on a device and checks the recovered signer matches.
- **Hash-stream replica**: `tests/evm-tx-1559/find-preimage.js` variant #17 documents the exact mangled stream — keep it as a memorial test.
- **Production diagnostic**: `keepkey-vault-v11/projects/keepkey-vault/src/bun/rest-api.ts` carries a `[DIAG]` block that logs `deviceSignedHash` vs canonical for every EVM sign. Leaves the alarm bell wired in.

The hdwallet patch (`modules/hdwallet/packages/hdwallet-keepkey/src/ethereum.ts` — surface `deviceSignedHash` from `response.getHash_asU8()`) is harmless and should be kept regardless of the firmware fix; it makes the next class of EVM signing bug a one-look diagnosis.

---

## Why the original hypothesis battery failed

The retro tested 30+ field-level variants but never tested *structural* variants where the byte stream is correct elsewhere but a single byte is misplaced. The lesson isn't "test more variants" — it's "stop hunting variants offline once the device can tell you the answer." The `hash` field has been there since at least firmware 7.x.

---

## Things flagged in the prior retro that turned out to be red herrings

- **"Blink Protect sponsored relayer with different `from`"** — pure hallucination, never relevant.
- **Mempool-eviction / RPC-routing framing** — symptom-level confusion. The RPC dropped the tx because the recovered signer was wrong, full stop.
- **Hardcoded RPC fallback URLs** — almost added before you stopped me. See `feedback_no_hardcoded_rpcs.md` / `no-hardcoded-rpcs-use-pioneer.md`.

---

## Open follow-ups

1. **Firmware PR** → `BitHighlander/keepkey-firmware:develop`. Branch name: `fix/eip1559-chunked-data-access-list`. CI must go green before flashing.
2. **Device verification** — flash patched firmware, re-run `tests/evm-tx-1559/sign-and-recover.js`, expect ✅.
3. **Upstream PR** → `keepkey/keepkey-firmware:develop` once the fork PR is merged.
4. **Emulator rebuild** — clean image with zcash sidecar + this firmware fix only, nothing else.

---

## Memory index

- `firmware_eip1559_chunked_data_bug.md` — durable record of the bug + the diagnostic move that solved it.
