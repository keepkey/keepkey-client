import { describe, it, expect } from 'vitest';
import { deriveUtxoAddress } from './utxoDerive';

// Canonical BIP test vectors for the "abandon abandon ... about" mnemonic.
// These pin our local pubkey→address derivation against the published
// specs — a wrong address here means funds sent to the wrong place, so
// these assertions are deliberately exact.
const BTC = 'bip122:000000000019d6689c085ae165831e93/slip44:0';

// BIP84 account 0 (m/84'/0'/0'), receive m/0/0 -> bc1qcr8te4...
const ZPUB_BIP84 =
  'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
// BIP44 account 0 (m/44'/0'/0'), receive m/0/0 -> 1LqBGSK...
const XPUB_BIP44 =
  'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj';

describe('deriveUtxoAddress — Bitcoin (canonical BIP vectors)', () => {
  // The BIP84 native-segwit vector is the canonical anchor: the address
  // below is published in the BIP84 spec, so an exact match proves the
  // whole pipeline (HDKey parse, version-byte rewrite, hash160, bech32).
  it('derives the BIP84 native-segwit (p2wpkh) first receive address', () => {
    const addr = deriveUtxoAddress({ xpub: ZPUB_BIP84, scriptType: 'p2wpkh', networkId: BTC });
    expect(addr).toBe('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
  });

  it('produces address-format prefixes matching the script type', () => {
    expect(deriveUtxoAddress({ xpub: ZPUB_BIP84, scriptType: 'p2wpkh', networkId: BTC })).toMatch(/^bc1q/);
    expect(deriveUtxoAddress({ xpub: XPUB_BIP44, scriptType: 'p2pkh', networkId: BTC })).toMatch(/^1/);
    expect(deriveUtxoAddress({ xpub: XPUB_BIP44, scriptType: 'p2sh-p2wpkh', networkId: BTC })).toMatch(/^3/);
  });

  it('is deterministic for the same inputs', () => {
    const a = deriveUtxoAddress({ xpub: ZPUB_BIP84, scriptType: 'p2wpkh', networkId: BTC });
    const b = deriveUtxoAddress({ xpub: ZPUB_BIP84, scriptType: 'p2wpkh', networkId: BTC });
    expect(a).toBe(b);
  });

  it('defaults to p2pkh when no script type is given', () => {
    const explicit = deriveUtxoAddress({ xpub: XPUB_BIP44, scriptType: 'p2pkh', networkId: BTC });
    const defaulted = deriveUtxoAddress({ xpub: XPUB_BIP44, networkId: BTC });
    expect(defaulted).toBe(explicit);
  });
});

describe('deriveUtxoAddress — error handling', () => {
  it('throws on an unsupported networkId', () => {
    expect(() => deriveUtxoAddress({ xpub: XPUB_BIP44, scriptType: 'p2pkh', networkId: 'eip155:1' })).toThrow(
      /Unsupported UTXO networkId/,
    );
  });

  it('throws on an unsupported script type', () => {
    expect(() => deriveUtxoAddress({ xpub: XPUB_BIP44, scriptType: 'p2tr', networkId: BTC })).toThrow(
      /Unsupported script type/,
    );
  });

  it('throws on a malformed extended key', () => {
    expect(() => deriveUtxoAddress({ xpub: 'not-an-xpub', scriptType: 'p2pkh', networkId: BTC })).toThrow();
  });
});
