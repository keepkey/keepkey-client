/**
 * Clear-sign summaries for EIP-712 typed data (eth_signTypedData / _v3 / _v4).
 *
 * The device never sees these fields: hdwallet-keepkey hashes the payload in
 * the vault and sends EthereumSignTypedHash, so the OLED shows two hashes and
 * the side-panel card is the user's only readable view. A summary that shows a
 * friendlier value than the one that gets hashed is worse than none, so every
 * value here is read the way the vault's hasher reads it (hdwallet-keepkey →
 * eip-712 1.0.0 → @findeth/abi 0.3.1, probed against the installed packages),
 * not the way the EIP-712 spec or ethers would:
 *
 *   - Integers (uintN / intN) are BigInt(value), then range-checked against
 *     the declared width. ' 12 ', '+12', '0xc', '0X0C', '0o14', '0b1100' and 12
 *     all sign as 12; '' and [] sign as 0; '1e3', 1.5 and a negative uint make
 *     the vault throw.
 *   - bool goes through that SAME integer path (the abi encoder has no bool
 *     entry in its parser table). true / 1 / '1' sign as 1; false / 0 / '0' /
 *     '' sign as 0; 2 signs a word no contract's bool can equal; 'true' and
 *     'false' make the vault throw. It is not JS truthiness.
 *   - address writes the 40 hex chars after ANY two-char prefix and stops at
 *     the first non-hex char. Only /^0[xX][0-9a-fA-F]{40}$/ is accepted here —
 *     the one form where what we show and what gets hashed cannot differ.
 *   - bytesN strips a lowercase '0x', decodes hex up to the first non-hex
 *     char, drops an odd nibble and right-pads, so text, '0X…' and '0xabc'
 *     sign as other bytes (often zeros); dynamic bytes throws on anything but
 *     even-length hex. Only clean hex is accepted here, bytesN shown padded.
 *   - A field type ending in [..] is an array; otherwise, if `types` defines
 *     it, a struct (even one named 'uint256'); otherwise elementary.
 *   - The typehash covers only the structs the fields refer to, each looked
 *     up by its name minus one trailing [..] (hdwallet patches eip-712 so
 *     that Hyperliquid's 'HyperliquidTransaction:ApproveAgent' works; older
 *     vaults use the leading \w+ of the name). For nested arrays the patch is
 *     a vault bug: 'T[2][2]' looks up 'T[2]', finds nothing, and leaves T out
 *     of the typehash, so a Seaport BulkOrder signs a non-standard digest
 *     (HANDOFF_vault_eip712_decoder.md). The values it encodes, and so this
 *     summary, are still right. Values are encoded with the fields of the
 *     full name. So a definition nothing refers to changes
 *     nothing, and 'PermitSingle[]' (on an older vault, 'PermitSingle:X') as
 *     primaryType signs as a canonical PermitSingle whatever its own fields
 *     are called. The typehash text is 'Name(type name,…)' per struct, so a
 *     ',', '(' or ')' in a name lets one set of fields spell another's.
 *     extractTypedData refuses whitespace, ',', '(', ')', '[' and ']' in
 *     primaryType and `types` keys (field types add [n] suffixes), a name
 *     whose leading \w+ is another `types` key, and ',', '(' and ')' in
 *     field names.
 *   - Only fields declared in `types` are hashed; any other JSON key is
 *     ignored. The domain is hashed with types.EIP712Domain when that is an
 *     array, else with whichever canonical keys `domain` has
 *     (hdwallet's withEip712DomainType). With primaryType 'EIP712Domain' the
 *     message is not hashed at all.
 *
 * A payload is classified as a permit only when its type definitions exactly
 * match the canonical ones (so the typehash is the one the token or Permit2
 * checks). When they match but a value cannot be read, the summary says so as
 * loudly as an unlimited approval — never a quiet generic fallback. The same
 * goes for anything that claims Permit2 and is not bound to some other
 * well-formed address: Permit2 takes the witness part of its typehash from the
 * caller, so a payload there that cannot be decoded may still be a transfer.
 *
 * A leaf module (no imports) so evmTypedData.test.ts can load it:
 * ethereumHandler.ts imports @extension/storage, which touches chrome.* at
 * import time.
 */

export interface TypedData {
  types: Record<string, unknown>;
  primaryType: string;
  domain?: unknown;
  message: Record<string, unknown>;
}

export type ExtractResult = { ok: true; typedData: TypedData } | { ok: false; code: 4200 | -32602; message: string };

export type TypedDataKind = 'eip2612' | 'dai-permit' | 'permit2-allowance' | 'permit2-transfer' | 'generic';

export type WarningCode =
  | 'UNLIMITED_AMOUNT'
  | 'LONG_ALLOWANCE'
  | 'CHAIN_MISMATCH'
  | 'NO_CHAIN_BINDING'
  | 'PERMIT2_NOT_CANONICAL'
  | 'UNDECODABLE_PERMIT'
  | 'UNKNOWN_TOKEN'
  | 'FIELDS_TRUNCATED'
  | 'UNREADABLE_DOMAIN'
  | 'PERMIT2_WITNESS';

/** No prose: the card composes the text (it owns network names). */
export interface TypedDataWarning {
  code: WarningCode;
  severity: 'danger' | 'caution';
  params: Record<string, string>;
}

export interface TimeValue {
  /** Unix seconds as hashed, decimal. */
  raw: string;
  /** null when past the JS Date range — effectively never. */
  unixMs: number | null;
  note: 'no-deadline' | 'submitting-block' | null;
}

export interface PermitToken {
  address: string;
  amountRaw: string;
  unlimited: boolean;
  symbol: string | null;
  decimals: number | null;
  /** formatUnits(amountRaw, decimals); null until decimals are known. */
  amount: string | null;
  /** Permit2 allowance only: when the allowance itself lapses. */
  expires: TimeValue | null;
}

export interface FieldNode {
  name: string;
  type: string;
  /** Leaf value as the hasher reads it; null for structs and arrays. */
  value: string | null;
  /** The hasher would reject this value, it is not valid for its type, or it is not shown in full. */
  invalid: boolean;
  children: FieldNode[] | null;
}

export interface TypedDataSummary {
  kind: TypedDataKind;
  /** Canonical permit types, or a claim to be Permit2, even if the summary had to fall back to generic. */
  looksLikePermit: boolean;
  primaryType: string;
  tokens: PermitToken[];
  spender: string | null;
  /** When the signature (not the allowance) stops being usable. */
  deadline: TimeValue | null;
  /** Hashed domain values only — an unhashed JSON key binds nothing. */
  verifyingContract: string | null;
  /** A hashed verifyingContract that is not a clean address, previewed as sent: it is still signed. */
  unreadableContract: string | null;
  chainId: string | null;
  warnings: TypedDataWarning[];
  domainFields: FieldNode[];
  messageFields: FieldNode[];
  /** JSON keys the hasher ignores. */
  unsigned: { path: string; value: string }[];
}

export interface TokenMeta {
  symbol: string | null;
  decimals: number;
}

export const PERMIT2_ADDRESS = '0x000000000022d473030f116ddee9f6b43ac78ba3';

const ADDRESS_RE = /^0[xX][0-9a-fA-F]{40}$/;
const HEX_RE = /^(?:0x)?((?:[0-9a-fA-F]{2})*)$/;
const TYPE_NAME_RE = /^[^\s,()[\]]+$/;
const FIELD_TYPE_RE = /^[^\s,()[\]]+(?:\[\d*\])*$/;
const FIELD_NAME_RE = /^[^,()]*$/;
// The hasher's own array pattern (eip-712 ARRAY_REGEX).
const ARRAY_TYPE_RE = /^(.*)\[([0-9]*?)]$/;
// eip-712's own NUMBER_REGEX: the vault rejects wider widths before hashing.
const INT_TYPE_RE = /^(u?)int(\d{0,3})$/;
const UNLIMITED_MIN = (1n << 128n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;
const LONG_ALLOWANCE_SEC = 30n * 24n * 3600n;
const MAX_DATE_MS = 8_640_000_000_000_000n;
const MAX_DEPTH = 16;
// The page writes the payload, so the summary's size is capped whatever it
// sends: it is stored on the approval event (chrome.storage.local, 10 MB).
// MAX_NAME bounds what each node repeats (extractTypedData enforces it).
const MAX_NODES = 2000;
const MAX_UNSIGNED = 200;
const MAX_NAME = 256;

type Def = readonly [name: string, type: string];

const CANONICAL_DOMAIN: Def[] = [
  ['name', 'string'],
  ['version', 'string'],
  ['chainId', 'uint256'],
  ['verifyingContract', 'address'],
  ['salt', 'bytes32'],
];
const PERMIT_2612: Def[] = [
  ['owner', 'address'],
  ['spender', 'address'],
  ['value', 'uint256'],
  ['nonce', 'uint256'],
  ['deadline', 'uint256'],
];
const DAI_PERMIT: Def[] = [
  ['holder', 'address'],
  ['spender', 'address'],
  ['nonce', 'uint256'],
  ['expiry', 'uint256'],
  ['allowed', 'bool'],
];
const PERMIT_DETAILS: Def[] = [
  ['token', 'address'],
  ['amount', 'uint160'],
  ['expiration', 'uint48'],
  ['nonce', 'uint48'],
];
const TOKEN_PERMISSIONS: Def[] = [
  ['token', 'address'],
  ['amount', 'uint256'],
];
const permit2Allowance = (details: string): Def[] => [
  ['details', details],
  ['spender', 'address'],
  ['sigDeadline', 'uint256'],
];
const permit2Transfer = (permitted: string): Def[] => [
  ['permitted', permitted],
  ['spender', 'address'],
  ['nonce', 'uint256'],
  ['deadline', 'uint256'],
];
const PERMIT2_PRIMARY_TYPES = new Set([
  'PermitSingle',
  'PermitBatch',
  'PermitTransferFrom',
  'PermitBatchTransferFrom',
  'PermitWitnessTransferFrom',
  'PermitBatchWitnessTransferFrom',
]);
// The elementary types the canonical fields use. A `types` entry with one of
// these names turns those fields into structs and changes the typehash.
const ELEMENTARY = new Set(['address', 'bool', 'uint48', 'uint160', 'uint256']);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const own = (obj: Record<string, unknown>, key: string): unknown =>
  Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;

const invalidParams = (message: string): ExtractResult => ({ ok: false, code: -32602, message });

/**
 * Find the typed-data payload by shape, for every param order in the wild:
 * v1 is [payload, address], v3/v4 are [address, payload], and the payload may
 * be an object or a JSON string. Returns the dApp's own object — no clone, no
 * normalisation — so the summary and the signer read the same thing.
 */
export function extractTypedData(params: unknown): ExtractResult {
  if (!Array.isArray(params)) return invalidParams('Invalid typed data: params must be an array');
  let payload: unknown =
    params.find(p => isPlainObject(p) || Array.isArray(p)) ??
    params.find(p => typeof p === 'string' && !ADDRESS_RE.test(p));
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      return invalidParams('Invalid typed data: not valid JSON');
    }
  }
  if (Array.isArray(payload)) {
    return {
      ok: false,
      code: 4200,
      message: 'Legacy eth_signTypedData (v1 array format) is not supported. Use eth_signTypedData_v4.',
    };
  }
  if (
    !isPlainObject(payload) ||
    typeof payload.primaryType !== 'string' ||
    !isPlainObject(payload.types) ||
    !isPlainObject(payload.message)
  ) {
    return invalidParams('Invalid typed data: expected { types, primaryType, domain, message }');
  }
  const td = payload as unknown as TypedData;
  // Only names every vault's hasher reads one way, and only field names that
  // cannot spell another typehash (see the header). An older vault reads
  // 'X:Y' as 'X' for the typehash, so that is refused only when `types`
  // defines 'X'. Every name is length-capped (the summary repeats it in each
  // node it labels) before an anchored, linear regex sees it.
  const aliased = (s: string) => {
    const word = /^\w+/.exec(s)?.[0];
    return word !== undefined && word.length < s.length && s[word.length] !== '[' && own(td.types, word) !== undefined;
  };
  const badType = (s: string, re: RegExp) => s.length > MAX_NAME || !re.test(s) || aliased(s);
  if (
    badType(td.primaryType, TYPE_NAME_RE) ||
    Object.entries(td.types).some(
      ([key, defs]) =>
        badType(key, TYPE_NAME_RE) ||
        (Array.isArray(defs) &&
          defs.some(
            d =>
              isPlainObject(d) &&
              ((typeof d.type === 'string' && badType(d.type, FIELD_TYPE_RE)) ||
                (typeof d.name === 'string' && (d.name.length > MAX_NAME || !FIELD_NAME_RE.test(d.name)))),
          )),
    )
  ) {
    return invalidParams(
      `Invalid typed data: a type or field name the hasher could read another way, or longer than ${MAX_NAME} characters`,
    );
  }
  return { ok: true, typedData: td };
}

/** BigInt(v) exactly as the hasher calls it; null where it would throw. */
function toBigInt(v: unknown): bigint | null {
  try {
    return BigInt(v as string);
  } catch {
    return null;
  }
}

function parseUint(v: unknown, bits: number): bigint | null {
  const n = toBigInt(v);
  return n !== null && n >= 0n && n < 1n << BigInt(bits) ? n : null;
}

function parseAddress(v: unknown): string | null {
  return typeof v === 'string' && ADDRESS_RE.test(v) ? '0x' + v.slice(2) : null;
}

/** Exact decimal rendering with thousands separators — no floats anywhere. */
export function formatUnits(raw: bigint, decimals: number): string {
  const digits = raw.toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = digits.slice(digits.length - decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

/** Token symbols are attacker-chosen: no control/format chars, 16 chars max. */
export function sanitizeSymbol(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = [...raw.replace(/[\p{Cc}\p{Cf}]/gu, '').trim()].slice(0, 16).join('').trim();
  return s || null;
}

/** Metadata from symbol()/decimals(); decimals outside 0..36 means unknown, never a guess. */
export function toTokenMeta(symbol: unknown, decimals: unknown): TokenMeta | null {
  const d = toBigInt(decimals);
  if (d === null || d < 0n || d > 36n) return null;
  return { symbol: sanitizeSymbol(symbol), decimals: Number(d) };
}

function preview(v: unknown): string {
  let s: string | undefined;
  try {
    s = JSON.stringify(v);
  } catch {
    s = undefined;
  }
  s = s ?? String(v);
  return s.length > 200 ? `${s.slice(0, 200)}… (+${s.length - 200} more chars)` : s;
}

function structDefs(types: Record<string, unknown>, type: string): Def[] | null {
  const defs = own(types, type);
  if (!Array.isArray(defs)) return null;
  return defs
    .filter(
      (d): d is { name: string; type: string } =>
        isPlainObject(d) && typeof d.name === 'string' && typeof d.type === 'string',
    )
    .map(d => [d.name, d.type] as const);
}

function defsMatch(types: Record<string, unknown>, type: string, expected: Def[], extra = 0): boolean {
  const defs = own(types, type);
  return (
    Array.isArray(defs) &&
    defs.length === expected.length + extra &&
    expected.every(
      ([name, t], i) =>
        isPlainObject(defs[i]) &&
        defs[i].name === name &&
        defs[i].type === t &&
        !(ELEMENTARY.has(t) && Array.isArray(own(types, t))),
    )
  );
}

function leaf(type: string, v: unknown): { value: string; invalid: boolean } {
  const int = INT_TYPE_RE.exec(type);
  if (int || type === 'bool') {
    const bits = int?.[2] ? Number(int[2]) : 256;
    const signed = int?.[1] === '';
    const n = toBigInt(v);
    const limit = 1n << BigInt(signed ? bits - 1 : bits);
    if (n === null || n >= limit || n < (signed ? -limit : 0n)) return { value: preview(v), invalid: true };
    const shown = type !== 'bool' ? n.toString() : n === 1n ? 'true' : n === 0n ? 'false' : `${n} (not a bool)`;
    const asSent = type === 'bool' ? typeof v === 'boolean' : typeof v === 'number' || v === shown;
    return { value: asSent ? shown : `${shown} (sent as ${preview(v)})`, invalid: type === 'bool' && n > 1n };
  }
  if (type === 'address') {
    const a = parseAddress(v);
    return a ? { value: a, invalid: false } : { value: preview(v), invalid: true };
  }
  const fixed = /^bytes(\d{1,2})$/.exec(type);
  if (fixed || type === 'bytes') {
    const size = fixed ? Number(fixed[1]) : null;
    const hex = typeof v === 'string' ? HEX_RE.exec(v)?.[1] : undefined;
    if (hex === undefined || (size !== null && (size < 1 || size > 32 || hex.length > size * 2))) {
      return { value: preview(v), invalid: true };
    }
    const shown = '0x' + (size === null ? hex : hex.padEnd(size * 2, '0'));
    return { value: v === shown ? shown : `${shown} (sent as ${preview(v)})`, invalid: false };
  }
  if (type === 'string') {
    return typeof v === 'string' ? { value: v, invalid: false } : { value: preview(v), invalid: true };
  }
  return { value: preview(v), invalid: true };
}

/** One budget for the domain and message walks together. */
interface Walk {
  unsigned: TypedDataSummary['unsigned'];
  nodes: number;
  /** Something was left out: too deep, too many fields, or too many ignored keys. */
  truncated: boolean;
  /** structDefs per struct name: a def list is read once, not per visit. */
  defs: Map<string, Def[]>;
}

/** Maps items to nodes until the node budget runs out, then ends the list with one marker. */
function walkEach<T>(items: readonly T[], walk: Walk, visit: (item: T, i: number) => FieldNode): FieldNode[] {
  const out: FieldNode[] = [];
  for (let i = 0; i < items.length; i++) {
    if (walk.nodes >= MAX_NODES) {
      walk.truncated = true;
      out.push({ name: '…', type: '', value: '(too many fields to show)', invalid: true, children: null });
      break;
    }
    walk.nodes++;
    out.push(visit(items[i], i));
  }
  return out;
}

function walkFields(
  types: Record<string, unknown>,
  defs: Def[],
  data: Record<string, unknown>,
  path: string,
  walk: Walk,
  depth: number,
): FieldNode[] {
  const declared = new Set(defs.map(([name]) => name));
  for (const key of Object.keys(data)) {
    if (declared.has(key)) continue;
    if (walk.unsigned.length >= MAX_UNSIGNED) {
      walk.truncated = true;
      break;
    }
    walk.unsigned.push({ path: `${path}.${key}`, value: preview(data[key]) });
  }
  // A repeated name hashes the same value again, maybe as another type. No
  // canonical type repeats one, and walking it again is how k same-named
  // fields d levels deep become k^d nodes: mark it instead.
  const seen = new Set<string>();
  return walkEach(defs, walk, ([name, type]) => {
    if (seen.has(name)) return { name, type, value: '(repeated field name)', invalid: true, children: null };
    seen.add(name);
    return walkValue(types, name, type, own(data, name), `${path}.${name}`, walk, depth);
  });
}

function walkValue(
  types: Record<string, unknown>,
  name: string,
  type: string,
  v: unknown,
  path: string,
  walk: Walk,
  depth: number,
): FieldNode {
  const node = (value: string | null, invalid: boolean, children: FieldNode[] | null = null): FieldNode => ({
    name,
    type,
    value,
    invalid,
    children,
  });
  if (depth >= MAX_DEPTH) {
    walk.truncated = true;
    return node('(nested too deep to show)', true);
  }
  if (v === undefined || v === null) return node('(missing)', true);
  const array = ARRAY_TYPE_RE.exec(type);
  if (array) {
    if (!Array.isArray(v)) return node(preview(v), true);
    const length = Number(array[2]) || null;
    const children = walkEach(v, walk, (item, i) =>
      walkValue(types, `[${i}]`, array[1], item, `${path}[${i}]`, walk, depth + 1),
    );
    return node(null, length !== null && v.length !== length, children);
  }
  if (Array.isArray(own(types, type))) {
    // Shape first: reading a huge def list for every non-object item is its own slow path.
    if (!isPlainObject(v)) return node(preview(v), true);
    let defs = walk.defs.get(type);
    if (!defs) walk.defs.set(type, (defs = structDefs(types, type) ?? []));
    return node(null, false, walkFields(types, defs, v, path, walk, depth + 1));
  }
  const { value, invalid } = leaf(type, v);
  return node(value, invalid);
}

const hasInvalid = (nodes: FieldNode[]): boolean =>
  nodes.some(n => n.invalid || (n.children !== null && hasInvalid(n.children)));

function timeValue(seconds: bigint, note: TimeValue['note'] = null): TimeValue {
  const ms = seconds * 1000n;
  return { raw: seconds.toString(), unixMs: ms <= MAX_DATE_MS ? Number(ms) : null, note };
}

function newToken(address: string, amount: bigint, expires: TimeValue | null = null): PermitToken {
  return {
    address,
    amountRaw: amount.toString(),
    unlimited: amount >= UNLIMITED_MIN,
    symbol: null,
    decimals: null,
    amount: null,
    expires,
  };
}

type PermitMatch = { kind: Exclude<TypedDataKind, 'generic'>; batch: boolean };

function matchPermit(types: Record<string, unknown>, primaryType: string): PermitMatch | null {
  const batch = primaryType.startsWith('PermitBatch');
  switch (primaryType) {
    case 'Permit':
      if (defsMatch(types, 'Permit', PERMIT_2612)) return { kind: 'eip2612', batch };
      if (defsMatch(types, 'Permit', DAI_PERMIT)) return { kind: 'dai-permit', batch };
      return null;
    case 'PermitSingle':
    case 'PermitBatch':
      return defsMatch(types, primaryType, permit2Allowance(batch ? 'PermitDetails[]' : 'PermitDetails')) &&
        defsMatch(types, 'PermitDetails', PERMIT_DETAILS)
        ? { kind: 'permit2-allowance', batch }
        : null;
    case 'PermitTransferFrom':
    case 'PermitBatchTransferFrom':
    case 'PermitWitnessTransferFrom':
    case 'PermitBatchWitnessTransferFrom': {
      // Witness variants: the canonical four plus exactly one caller-typed field.
      const witness = primaryType.includes('Witness') ? 1 : 0;
      return defsMatch(
        types,
        primaryType,
        permit2Transfer(batch ? 'TokenPermissions[]' : 'TokenPermissions'),
        witness,
      ) && defsMatch(types, 'TokenPermissions', TOKEN_PERMISSIONS)
        ? { kind: 'permit2-transfer', batch }
        : null;
    }
  }
  return null;
}

type Decoded = { tokens: PermitToken[]; spender: string; deadline: TimeValue };

/** Reads the values a permit card shows; null if any of them cannot be read. */
function decodePermit(
  match: PermitMatch,
  msg: Record<string, unknown>,
  verifyingContract: string | null,
): Decoded | null {
  const spender = parseAddress(msg.spender);
  if (!spender) return null;
  const list = (v: unknown): unknown[] | null => (match.batch ? (Array.isArray(v) ? v : null) : [v]);
  const field = (item: unknown, key: string): unknown => (isPlainObject(item) ? own(item, key) : undefined);

  switch (match.kind) {
    case 'eip2612': {
      const value = parseUint(msg.value, 256);
      const deadline = parseUint(msg.deadline, 256);
      if (!verifyingContract || value === null || deadline === null) return null;
      return { tokens: [newToken(verifyingContract, value)], spender, deadline: timeValue(deadline) };
    }
    case 'dai-permit': {
      // DAI sets the allowance to uint(-1) when allowed, 0 when not.
      const allowed = parseUint(msg.allowed, 256);
      const expiry = parseUint(msg.expiry, 256);
      if (!verifyingContract || expiry === null || (allowed !== 0n && allowed !== 1n)) return null;
      return {
        tokens: [newToken(verifyingContract, allowed === 1n ? MAX_UINT256 : 0n)],
        spender,
        // DAI treats expiry 0 as "no deadline".
        deadline: timeValue(expiry, expiry === 0n ? 'no-deadline' : null),
      };
    }
    case 'permit2-allowance': {
      const details = list(msg.details);
      const sigDeadline = parseUint(msg.sigDeadline, 256);
      if (!details || sigDeadline === null) return null;
      const tokens = details.map(d => {
        const token = parseAddress(field(d, 'token'));
        const amount = parseUint(field(d, 'amount'), 160);
        const expiration = parseUint(field(d, 'expiration'), 48);
        if (!token || amount === null || expiration === null) return null;
        // Permit2 stores expiration 0 as block.timestamp: usable in that block only.
        return newToken(token, amount, timeValue(expiration, expiration === 0n ? 'submitting-block' : null));
      });
      if (tokens.some(t => t === null)) return null;
      return { tokens: tokens as PermitToken[], spender, deadline: timeValue(sigDeadline) };
    }
    case 'permit2-transfer': {
      const permitted = list(msg.permitted);
      const deadline = parseUint(msg.deadline, 256);
      if (!permitted || deadline === null) return null;
      const tokens = permitted.map(p => {
        const token = parseAddress(field(p, 'token'));
        const amount = parseUint(field(p, 'amount'), 256);
        return token && amount !== null ? newToken(token, amount) : null;
      });
      if (tokens.some(t => t === null)) return null;
      return { tokens: tokens as PermitToken[], spender, deadline: timeValue(deadline) };
    }
  }
}

const sortWarnings = (warnings: TypedDataWarning[]): TypedDataWarning[] => [
  ...warnings.filter(w => w.severity === 'danger'),
  ...warnings.filter(w => w.severity === 'caution'),
];

/**
 * Summarize a payload extractTypedData accepted. Total over anything it
 * accepts, never mutates it, and returns only JSON values (the result is
 * stored on the approval event). Token symbol/decimals come later, from
 * withTokenMetadata.
 */
export function summarizeTypedData(
  td: TypedData,
  ctx: { activeChainId: string | number | null; nowSec: number },
): TypedDataSummary {
  const { types, primaryType, message } = td;
  const walk: Walk = { unsigned: [], nodes: 0, truncated: false, defs: new Map() };
  const warnings: TypedDataWarning[] = [];
  const domain = isPlainObject(td.domain) ? td.domain : {};

  const domainDefs = Array.isArray(own(types, 'EIP712Domain'))
    ? (structDefs(types, 'EIP712Domain') ?? [])
    : CANONICAL_DOMAIN.filter(([name]) => domain[name] !== undefined);
  const domainFields = walkFields(types, domainDefs, domain, 'domain', walk, 0);
  const msgDefs = primaryType === 'EIP712Domain' ? [] : (structDefs(types, primaryType) ?? []);
  const messageFields = walkFields(types, msgDefs, message, 'message', walk, 0);

  // Domain checks read only what is hashed, as the type it is hashed as.
  const hashed = (name: string): { type: string; value: unknown } | null => {
    const def = domainDefs.find(([n]) => n === name);
    return def && !structDefs(types, def[1]) ? { type: def[1], value: own(domain, name) } : null;
  };
  const chainField = hashed('chainId');
  const chainWidth = chainField && /^uint(\d{0,3})$/.exec(chainField.type);
  const chainId = chainWidth ? parseUint(chainField.value, chainWidth[1] ? Number(chainWidth[1]) : 256) : null;
  const contractField = hashed('verifyingContract');
  const verifyingContract = contractField?.type === 'address' ? parseAddress(contractField.value) : null;
  // Hashed but not a clean address is never "not signed": the vault writes hex
  // up to the first non-hex char, so '0x…zz' signs as the real '0x…00'.
  const contractRaw = own(domain, 'verifyingContract');
  const unreadableContract =
    verifyingContract === null && domainDefs.some(([n]) => n === 'verifyingContract')
      ? contractRaw === undefined
        ? '(missing)'
        : preview(contractRaw)
      : null;
  const nameField = hashed('name');
  const claimsPermit2 =
    PERMIT2_PRIMARY_TYPES.has(primaryType) || (nameField?.type === 'string' && nameField.value === 'Permit2');

  const match = matchPermit(types, primaryType);
  const atPermit2 = verifyingContract?.toLowerCase() === PERMIT2_ADDRESS;
  let decoded: Decoded | null = null;
  if (claimsPermit2 && verifyingContract !== null && !atPermit2) {
    warnings.push({ code: 'PERMIT2_NOT_CANONICAL', severity: 'caution', params: { verifyingContract } });
  } else if (match || claimsPermit2) {
    // Permit2 checks only its own typehashes, but the witness part is the
    // caller's: whatever claims it here and cannot be read may still be a
    // valid transfer of anything, so it is never a quiet generic.
    const readable = match && (atPermit2 || !claimsPermit2) && !hasInvalid(domainFields) && !hasInvalid(messageFields);
    decoded = readable ? decodePermit(match, message, verifyingContract) : null;
    if (!decoded) warnings.push({ code: 'UNDECODABLE_PERMIT', severity: 'danger', params: {} });
  }
  // A domain value the card cannot show may bind the signature to a contract
  // or chain the user never saw, whatever the message is.
  if (unreadableContract !== null || hasInvalid(domainFields)) {
    warnings.push({ code: 'UNREADABLE_DOMAIN', severity: 'danger', params: {} });
  }
  // The witness carries terms the spender acts on (a UniswapX order's outputs
  // and recipients) that no summary row shows.
  if (decoded && match?.kind === 'permit2-transfer' && primaryType.includes('Witness')) {
    const [field = '', type = ''] = msgDefs[4] ?? [];
    warnings.push({ code: 'PERMIT2_WITNESS', severity: 'caution', params: { field, type } });
  }

  const longAfter = BigInt(Math.floor(ctx.nowSec)) + LONG_ALLOWANCE_SEC;
  for (const t of decoded?.tokens ?? []) {
    if (t.unlimited) warnings.push({ code: 'UNLIMITED_AMOUNT', severity: 'danger', params: { token: t.address } });
    if (t.expires && t.expires.note === null && BigInt(t.expires.raw) > longAfter) {
      warnings.push({ code: 'LONG_ALLOWANCE', severity: 'caution', params: { token: t.address } });
    }
  }

  const activeChainId = ctx.activeChainId === null ? null : toBigInt(ctx.activeChainId);
  if (chainId === null) {
    warnings.push({ code: 'NO_CHAIN_BINDING', severity: 'caution', params: {} });
  } else if (activeChainId !== null && chainId !== activeChainId) {
    warnings.push({
      code: 'CHAIN_MISMATCH',
      severity: 'danger',
      params: { domainChainId: chainId.toString(), activeChainId: activeChainId.toString() },
    });
  }
  if (walk.truncated) warnings.push({ code: 'FIELDS_TRUNCATED', severity: 'caution', params: {} });

  return {
    kind: decoded && match ? match.kind : 'generic',
    looksLikePermit: match !== null || claimsPermit2,
    primaryType,
    tokens: decoded?.tokens ?? [],
    spender: decoded?.spender ?? null,
    deadline: decoded?.deadline ?? null,
    verifyingContract,
    unreadableContract,
    chainId: chainId === null ? null : chainId.toString(),
    warnings: sortWarnings(warnings),
    domainFields,
    messageFields,
    unsigned: walk.unsigned,
  };
}

/** Unique token addresses (lower-cased) in the order the card shows them. */
export function permitTokenAddresses(summary: TypedDataSummary): string[] {
  return [...new Set(summary.tokens.map(t => t.address.toLowerCase()))];
}

/**
 * Fill in symbol/decimals/amount from `meta` (keyed by lower-cased address).
 * A token without metadata keeps its raw amount and gets UNKNOWN_TOKEN.
 */
export function withTokenMetadata(
  summary: TypedDataSummary,
  meta: Record<string, TokenMeta | null | undefined>,
): TypedDataSummary {
  const tokens = summary.tokens.map(t => {
    const m = meta[t.address.toLowerCase()];
    return m
      ? { ...t, symbol: m.symbol, decimals: m.decimals, amount: formatUnits(BigInt(t.amountRaw), m.decimals) }
      : t;
  });
  const unknown = new Map<string, TypedDataWarning>();
  for (const t of tokens) {
    const key = t.address.toLowerCase();
    if (t.decimals === null && !unknown.has(key)) {
      unknown.set(key, { code: 'UNKNOWN_TOKEN', severity: 'caution', params: { token: t.address } });
    }
  }
  return { ...summary, tokens, warnings: sortWarnings([...summary.warnings, ...unknown.values()]) };
}
