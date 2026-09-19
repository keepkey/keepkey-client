/**
 * solanaTxSummary — what a Solana transaction actually does, for the approval
 * card. Decoded in the background (like hiveOpSummary), rendered by the side
 * panel; the card used to show "TO: N/A, AMOUNT: N/A" for every dApp tx.
 *
 * Pure leaf module (no imports) so vitest can load it. Parses the wire format
 * (legacy and v0), decodes the programs KeepKey can read — System, SPL Token /
 * Token-2022, Associated Token Account, Compute Budget, Memo — and flags every
 * other program as app code nobody can show the effect of. Honesty rules:
 * token decimals are never guessed (raw base units unless the instruction
 * itself carries them), accounts that come from address lookup tables are
 * labelled as such, and a parse failure is reported, not papered over.
 */

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = '';
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    s = '1' + s;
  }
  return s;
}

export const PROGRAMS: Record<string, string> = {
  '11111111111111111111111111111111': 'System Program',
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: 'Token Program',
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: 'Token-2022 Program',
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: 'Associated Token Account',
  ComputeBudget111111111111111111111111111111: 'Compute Budget',
  MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: 'Memo',
  Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo: 'Memo (v1)',
};

export interface SolanaInstructionSummary {
  program: string;
  programName: string | null;
  /** false = app code KeepKey cannot read */
  known: boolean;
  title: string;
  fields: Array<{ label: string; value: string }>;
}

export interface SolanaTxWarning {
  severity: 'danger' | 'caution';
  code: 'UNKNOWN_PROGRAM' | 'TOKEN_DELEGATE' | 'SET_AUTHORITY' | 'LOOKUP_TABLES' | 'NOT_SIGNER';
  text: string;
}

export interface SolanaTxSummary {
  version: 'legacy' | 'v0';
  feePayer: string;
  signers: string[];
  instructions: SolanaInstructionSummary[];
  /** Lamports leaving `signer` through System transfers / account creation, as a decimal string. */
  solOutLamports: string;
  /** Priority fee ceiling from Compute Budget (limit × price), lamports; null if not set. */
  priorityFeeLamports: string | null;
  lookupTables: number;
  warnings: SolanaTxWarning[];
}

class Reader {
  i = 0;
  constructor(private b: Uint8Array) {}
  u8(): number {
    if (this.i >= this.b.length) throw new Error('truncated transaction');
    return this.b[this.i++];
  }
  bytes(n: number): Uint8Array {
    if (this.i + n > this.b.length) throw new Error('truncated transaction');
    const out = this.b.subarray(this.i, this.i + n);
    this.i += n;
    return out;
  }
  shortvec(): number {
    let v = 0;
    for (let shift = 0; shift < 21; shift += 7) {
      const x = this.u8();
      v |= (x & 0x7f) << shift;
      if (x < 0x80) return v;
    }
    throw new Error('bad length prefix');
  }
}

const le = (d: Uint8Array, off: number, len: number): bigint => {
  let v = 0n;
  for (let k = len - 1; k >= 0; k--) v = (v << 8n) | BigInt(d[off + k] ?? 0);
  return v;
};

export const lamportsToSol = (l: bigint): string => {
  const whole = l / 1_000_000_000n;
  const frac = (l % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
};

/**
 * @param raw  full wire transaction (signature slots + message) as sent by the dApp
 * @param signer  the wallet's address — outflow and signer checks are relative to it
 */
export function summarizeSolanaTx(raw: Uint8Array, signer: string): SolanaTxSummary {
  const r = new Reader(raw);
  r.bytes(64 * r.shortvec()); // signature slots
  const first = r.u8();
  const v0 = (first & 0x80) !== 0;
  const numSigners = v0 ? r.u8() : first;
  r.u8(); // readonly signed
  r.u8(); // readonly unsigned
  const keys: string[] = [];
  const nKeys = r.shortvec();
  for (let k = 0; k < nKeys; k++) keys.push(base58(r.bytes(32)));
  r.bytes(32); // recent blockhash
  const rawIxs: Array<{ pid: number; accts: number[]; data: Uint8Array }> = [];
  const nIx = r.shortvec();
  for (let n = 0; n < nIx; n++) {
    const pid = r.u8();
    const accts = Array.from(r.bytes(r.shortvec()));
    rawIxs.push({ pid, accts, data: r.bytes(r.shortvec()) });
  }
  const lookupTables = v0 ? r.shortvec() : 0;

  const key = (idx: number) => (idx < keys.length ? keys[idx] : `lookup-table account #${idx - keys.length + 1}`);
  const signers = keys.slice(0, numSigners);
  const warnings: SolanaTxWarning[] = [];
  let solOut = 0n;
  let cuLimit: bigint | null = null;
  let cuPrice: bigint | null = null;

  const instructions = rawIxs.map(({ pid, accts, data: d }): SolanaInstructionSummary => {
    const program = key(pid);
    const programName = PROGRAMS[program] ?? null;
    const a = (n: number) => key(accts[n]);
    const out = (title: string, fields: Array<[string, string]> = []): SolanaInstructionSummary => ({
      program,
      programName,
      known: true,
      title,
      fields: fields.map(([label, value]) => ({ label, value })),
    });

    if (programName === 'System Program') {
      const t = Number(le(d, 0, 4));
      if (t === 2) {
        const lamports = le(d, 4, 8);
        if (a(0) === signer) solOut += lamports;
        return out('Send SOL', [
          ['Amount', `${lamportsToSol(lamports)} SOL`],
          ['From', a(0)],
          ['To', a(1)],
        ]);
      }
      if (t === 0) {
        const lamports = le(d, 4, 8);
        if (a(0) === signer) solOut += lamports;
        return out('Create account', [
          ['Funding', `${lamportsToSol(lamports)} SOL`],
          ['New account', a(1)],
          ['Owner program', base58(d.subarray(20, 52))],
        ]);
      }
      if (t === 1)
        return out('Assign account to program', [
          ['Account', a(0)],
          ['Program', base58(d.subarray(4, 36))],
        ]);
    }

    if (programName === 'Token Program' || programName === 'Token-2022 Program') {
      const t = d[0];
      const amt = () => le(d, 1, 8).toString();
      if (t === 3)
        return out('Send tokens', [
          ['Amount', `${amt()} (base units)`],
          ['From', a(0)],
          ['To', a(1)],
        ]);
      if (t === 12)
        return out('Send tokens', [
          ['Amount', `${amt()} (${d[9]} decimals)`],
          ['Mint', a(1)],
          ['From', a(0)],
          ['To', a(2)],
        ]);
      if (t === 4 || t === 13) {
        const checked = t === 13;
        const delegate = checked ? a(2) : a(1);
        warnings.push({
          severity: 'danger',
          code: 'TOKEN_DELEGATE',
          text: `Lets ${delegate} spend tokens from ${a(0)} without asking you again.`,
        });
        return out('Approve token spender', [
          ['Spender', delegate],
          ['Up to', checked ? `${amt()} (${d[9]} decimals)` : `${amt()} (base units)`],
          ['Token account', a(0)],
        ]);
      }
      if (t === 5) return out('Revoke token spender', [['Token account', a(0)]]);
      if (t === 6) {
        warnings.push({ severity: 'danger', code: 'SET_AUTHORITY', text: `Changes who controls ${a(0)}.` });
        return out('Change authority', [['Account', a(0)]]);
      }
      if (t === 9)
        return out('Close token account', [
          ['Account', a(0)],
          ['Rent to', a(1)],
        ]);
      if (t === 8 || t === 15)
        return out('Burn tokens', [
          ['Amount', `${amt()}`],
          ['Account', a(0)],
        ]);
      if (t === 17) return out('Sync wrapped SOL', [['Account', a(0)]]);
      if (t === 1 || t === 16 || t === 18) return out('Initialize token account', [['Account', a(0)]]);
    }

    if (programName === 'Associated Token Account' && (d.length === 0 || d[0] <= 1)) {
      return out('Create token account', [
        ['For wallet', a(2)],
        ['Mint', a(3)],
      ]);
    }

    if (programName === 'Compute Budget') {
      if (d[0] === 2) {
        cuLimit = le(d, 1, 4);
        return out('Set compute limit', [['Units', cuLimit.toString()]]);
      }
      if (d[0] === 3) {
        cuPrice = le(d, 1, 8);
        return out('Set priority fee', [['Price', `${cuPrice} micro-lamports / unit`]]);
      }
    }

    if (programName?.startsWith('Memo')) {
      return out('Memo', [['Text', new TextDecoder('utf-8', { fatal: false }).decode(d)]]);
    }

    return {
      program,
      programName,
      known: false,
      title: programName ? `${programName}: instruction KeepKey can't read` : 'App code KeepKey can’t read',
      fields: [
        { label: 'Program', value: program },
        { label: 'Data', value: `${d.length} bytes` },
        { label: 'Accounts', value: String(accts.length) },
      ],
    };
  });

  const unknown = [...new Set(instructions.filter(i => !i.known).map(i => i.program))];
  if (unknown.length) {
    warnings.unshift({
      severity: 'danger',
      code: 'UNKNOWN_PROGRAM',
      text: `Runs app code KeepKey can't read (${unknown.join(', ')}). It can move your SOL or tokens, and nobody can show you how much before you sign.`,
    });
  }
  if (lookupTables) {
    warnings.push({
      severity: 'caution',
      code: 'LOOKUP_TABLES',
      text: `Uses ${lookupTables} address lookup table(s): some accounts are filled in on-chain and can't be shown here.`,
    });
  }
  if (!signers.includes(signer)) {
    warnings.push({
      severity: 'caution',
      code: 'NOT_SIGNER',
      text: 'Your wallet is not listed as a signer of this transaction.',
    });
  }
  warnings.sort((x, y) => (x.severity === y.severity ? 0 : x.severity === 'danger' ? -1 : 1));

  const priority =
    cuLimit !== null && cuPrice !== null ? ((cuLimit as bigint) * (cuPrice as bigint) + 999_999n) / 1_000_000n : null;

  return {
    version: v0 ? 'v0' : 'legacy',
    feePayer: keys[0],
    signers,
    instructions,
    solOutLamports: solOut.toString(),
    priorityFeeLamports: priority === null ? null : priority.toString(),
    lookupTables,
    warnings,
  };
}
