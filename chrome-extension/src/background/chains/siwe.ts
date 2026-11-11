/**
 * ERC-4361 (Sign-In with Ethereum) domain binding for personal_sign / eth_sign.
 *
 * A SIWE message names the site it logs you in to, and that site's server
 * checks the message — never which page collected the signature. So any page
 * can hand the user opensea.io's login challenge and replay the signature on
 * opensea.io. The device can't catch it: a multi-line message only shows as a
 * hash on the OLED. EIP-4361 makes the wallet check that the message's domain
 * and scheme match the site asking, which only the approval panel can do.
 *
 * `origin` MUST be the Chrome-derived one (senderSite.ts). A page-supplied
 * origin would make this agree with whoever forged it.
 */

const SIWE_PHRASE = ' wants you to sign in with your Ethereum account:';

export interface SiweMessage {
  scheme: string | null;
  domain: string;
  address: string;
  statement: string | null;
  uri: string;
  version: string;
  chainId: string;
  nonce: string;
  issuedAt: string;
  expirationTime: string | null;
  notBefore: string | null;
  requestId: string | null;
  resources: string[];
}

export type SiweCode = 'malformed' | 'origin_unknown' | 'domain_mismatch' | 'scheme_mismatch' | 'uri_mismatch';

export interface SiweWarning {
  level: 'danger' | 'warning';
  code: SiweCode;
  text: string;
}

export interface SiweCheck {
  /** null when the text claims to be SIWE but doesn't parse. */
  message: SiweMessage | null;
  /** The requesting origin as given; null when unknown. */
  origin: string | null;
  /** What message.domain resolves to (case, punycode, default port); null when unresolved. */
  host: string | null;
  warnings: SiweWarning[];
}

/**
 * The text the device will sign. Same plaintext-vs-hex test as signMessage;
 * odd-length hex is left-padded because the vault's arrayify does that.
 */
export function eip191Text(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  if (!raw.startsWith('0x')) return raw;
  let hex = raw.slice(2);
  // The vault's HexString schema rejects this, so nothing gets signed.
  if (!/^[0-9a-fA-F]*$/.test(hex)) return null;
  if (hex.length % 2) hex = '0' + hex;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    // A sign-in with a stray invalid byte must read as malformed — not as
    // "not a sign-in", and not as a clean one (U+FFFD parses fine in a
    // statement or URI path, but the device signs the bytes, not this text).
    // So keep the lossy text only when it has the header, behind a first
    // line that never parses.
    const lossy = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    return lossy.includes(SIWE_PHRASE) ? '\uFFFD\n' + lossy : null;
  }
}

const HEADER = /^(?:([A-Za-z][A-Za-z0-9+.-]*):\/\/)?([^\s/?#]+) wants you to sign in with your Ethereum account:$/;
const DATE_TIME =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])[Tt](?:[01]\d|2[0-3]):[0-5]\d:(?:[0-5]\d|60)(?:\.\d+)?(?:[Zz]|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

const isDateTime = (v: string) => DATE_TIME.test(v);
const isUri = (v: string) => {
  try {
    return !/\s/.test(v) && Boolean(new URL(v));
  } catch {
    return false;
  }
};

/** Strict EIP-4361 parse. Anything off-grammar is null — never a best guess. */
export function parseSiwe(text: string): SiweMessage | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  while (lines.length && lines[lines.length - 1] === '') lines.pop();

  const header = HEADER.exec(lines[0] ?? '');
  if (!header || !/^0x[0-9a-fA-F]{40}$/.test(lines[1] ?? '') || lines[2] !== '') return null;

  // One blank line then URI, two blank lines, or one statement line between blanks.
  let i = 3;
  let statement: string | null = null;
  if (lines[i] === '') {
    i++;
  } else if (lines[i] !== undefined && !lines[i].startsWith('URI: ')) {
    statement = lines[i];
    if (lines[i + 1] !== '') return null;
    i += 2;
  }

  // Consumes the next line only if it is `prefix` + a valid value.
  const take = (prefix: string, valid: (v: string) => boolean): string | null => {
    const line = lines[i];
    if (line === undefined || !line.startsWith(prefix) || !valid(line.slice(prefix.length))) return null;
    i++;
    return line.slice(prefix.length);
  };

  const uri = take('URI: ', isUri);
  const version = take('Version: ', v => v === '1');
  const chainId = take('Chain ID: ', v => /^\d+$/.test(v));
  const nonce = take('Nonce: ', v => /^[A-Za-z0-9]{8,}$/.test(v));
  const issuedAt = take('Issued At: ', isDateTime);
  if (uri === null || version === null || chainId === null || nonce === null || issuedAt === null) return null;

  const expirationTime = take('Expiration Time: ', isDateTime);
  const notBefore = take('Not Before: ', isDateTime);
  const requestId = take('Request ID: ', v => /^[-._~!$&'()*+,;=:@%A-Za-z0-9]*$/.test(v));
  const resources: string[] = [];
  if (lines[i] === 'Resources:') {
    i++;
    for (let r = take('- ', isUri); r !== null; r = take('- ', isUri)) resources.push(r);
  }
  if (i !== lines.length) return null;

  return {
    scheme: header[1] ?? null,
    domain: header[2],
    address: lines[1],
    statement,
    uri,
    version,
    chainId,
    nonce,
    issuedAt,
    expirationTime,
    notBefore,
    requestId,
    resources,
  };
}

/**
 * The host `domain` names when reached over `protocol`. '@' (userinfo), '\'
 * (read as '/') and '%' (decoded in hosts) let a domain string read as one
 * site to a person and resolve to another, so they never resolve.
 */
function hostOf(protocol: string, domain: string): string | null {
  if (/[@\\%]/.test(domain)) return null;
  try {
    return new URL(`${protocol}//${domain}`).host;
  } catch {
    return null;
  }
}

const LOCALHOST = new Set(['localhost', '127.0.0.1', '[::1]']);

const MALFORMED: SiweWarning = {
  level: 'danger',
  code: 'malformed',
  text: "This looks like a Sign-In with Ethereum message but doesn't follow the standard, so KeepKey can't check which site it signs you in to.",
};

/**
 * null when the text isn't a SIWE message (hashes, arbitrary text) — the card
 * then behaves exactly as it did before this check existed.
 */
export function checkSiwe(text: unknown, { origin }: { origin: string | null }): SiweCheck | null {
  if (typeof text !== 'string' || !text.includes(SIWE_PHRASE)) return null;
  try {
    const message = parseSiwe(text);
    if (!message) return { message: null, origin, host: null, warnings: [MALFORMED] };

    let o: URL | null = null;
    try {
      if (origin) o = new URL(origin);
    } catch {
      // Unparsable — same as unknown.
    }
    if (!o || (o.protocol !== 'http:' && o.protocol !== 'https:')) {
      return {
        message,
        origin,
        host: hostOf('https:', message.domain),
        warnings: [
          {
            level: 'danger',
            code: 'origin_unknown',
            text: `KeepKey can't tell which website sent this request, so it can't check that it came from ${message.domain}.`,
          },
        ],
      };
    }

    const { domain, scheme, uri } = message;
    const host = hostOf(o.protocol, domain);
    const warnings: SiweWarning[] = [];
    if (host !== o.host) {
      warnings.push({
        level: 'danger',
        code: 'domain_mismatch',
        text: `This sign-in is for ${domain}, but the request came from ${o.host}. Signing could let ${o.host} log in to ${domain} as you.`,
      });
    }
    const schemeOk = scheme
      ? `${scheme.toLowerCase()}:` === o.protocol
      : o.protocol === 'https:' || LOCALHOST.has(o.hostname);
    if (!schemeOk) {
      warnings.push({
        level: 'danger',
        code: 'scheme_mismatch',
        text: `This sign-in is for ${scheme ?? 'https'}://${domain}, but the request came from ${o.origin}.`,
      });
    }
    // Opaque URIs (did:, urn:) have origin 'null' and nothing to compare.
    const uriOrigin = new URL(uri).origin;
    if (uriOrigin !== 'null' && uriOrigin !== o.origin) {
      warnings.push({
        level: 'warning',
        code: 'uri_mismatch',
        text: `This sign-in names ${uri} as the resource you're signing in to, which is not on ${o.origin}. Some sites use a separate login server; make sure you expected this one.`,
      });
    }
    return { message, origin: o.origin, host, warnings };
  } catch {
    return { message: null, origin, host: null, warnings: [MALFORMED] };
  }
}
