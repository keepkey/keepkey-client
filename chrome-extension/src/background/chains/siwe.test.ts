/**
 * The SIWE check is the only thing standing between a page and a replayable
 * login for another site: the device shows these messages as a hash. These pin
 * the three ways it breaks — a foreign domain reading as a match (URL parser
 * tricks, www vs apex, ports), a real sign-in slipping through as "not SIWE"
 * (hex, odd length, bad bytes), and an off-spec message being trusted instead
 * of flagged. Non-SIWE payloads (32-byte hashes) must stay a silent null.
 */
import { describe, it, expect } from 'vitest';
import { checkSiwe, eip191Text, parseSiwe } from './siwe';

const ADDR = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

const siwe = ({
  domain = 'example.com',
  statement = 'Sign in to Example.' as string | null,
  uri = 'https://example.com/login',
  tail = [] as string[],
} = {}) =>
  [
    `${domain} wants you to sign in with your Ethereum account:`,
    ADDR,
    '',
    ...(statement === null ? [''] : [statement, '']),
    `URI: ${uri}`,
    'Version: 1',
    'Chain ID: 1',
    'Nonce: 32891756abcDEF',
    'Issued At: 2021-09-30T16:25:24Z',
    ...tail,
  ].join('\n');

// Same encoding signMessage applies to plaintext before it reaches the vault.
const hex = (s: string) =>
  '0x' + Array.from(new TextEncoder().encode(s), b => b.toString(16).padStart(2, '0')).join('');

const check = (text: string, origin: string | null) => checkSiwe(text, { origin });
const codes = (text: string, origin: string | null) => check(text, origin)?.warnings.map(w => w.code);

describe('eip191Text', () => {
  it('returns plaintext as-is and rejects empty / non-string input', () => {
    expect(eip191Text('hello')).toBe('hello');
    expect(eip191Text('')).toBeNull();
    expect(eip191Text(undefined)).toBeNull();
    expect(eip191Text({ message: 'x' })).toBeNull();
  });

  it('decodes hex to the UTF-8 text the device signs', () => {
    expect(eip191Text(hex(siwe()))).toBe(siwe());
    expect(eip191Text('0x')).toBe('');
  });

  it('returns null for 0x-prefixed strings the vault would refuse as hex', () => {
    expect(eip191Text('0xnot hex')).toBeNull();
  });

  it('left-pads odd-length hex like the vault does', () => {
    expect(eip191Text('0x16869')).toBe('\x01hi');
  });

  it('returns null for non-UTF-8 bytes without the SIWE header', () => {
    expect(eip191Text(hex('hello') + 'ff')).toBeNull();
  });
});

describe('parseSiwe', () => {
  it('parses the required fields', () => {
    expect(parseSiwe(siwe())).toEqual({
      scheme: null,
      domain: 'example.com',
      address: ADDR,
      statement: 'Sign in to Example.',
      uri: 'https://example.com/login',
      version: '1',
      chainId: '1',
      nonce: '32891756abcDEF',
      issuedAt: '2021-09-30T16:25:24Z',
      expirationTime: null,
      notBefore: null,
      requestId: null,
      resources: [],
    });
  });

  it('parses every optional field', () => {
    const m = parseSiwe(
      siwe({
        domain: 'https://example.com',
        tail: [
          'Expiration Time: 2021-10-01T16:25:24.000+02:00',
          'Not Before: 2021-09-30t16:25:24z',
          'Request ID: req-1',
          'Resources:',
          '- ipfs://bafybeiemxf5abjwjbikoz4mc3a3dla6ual3jsgpdr4cjr3oz3evfyavhwq/',
          '- https://example.com/my-web2-claim.json',
        ],
      }),
    );
    expect(m).toMatchObject({
      scheme: 'https',
      domain: 'example.com',
      expirationTime: '2021-10-01T16:25:24.000+02:00',
      notBefore: '2021-09-30t16:25:24z',
      requestId: 'req-1',
      resources: [
        'ipfs://bafybeiemxf5abjwjbikoz4mc3a3dla6ual3jsgpdr4cjr3oz3evfyavhwq/',
        'https://example.com/my-web2-claim.json',
      ],
    });
  });

  it('tolerates no statement with one or two blank lines, a trailing newline and CRLF', () => {
    const noStatement = siwe({ statement: null });
    const oneBlank = noStatement.replace('\n\n\nURI:', '\n\nURI:');
    expect(oneBlank).not.toBe(noStatement);
    for (const text of [noStatement, oneBlank, siwe() + '\n', siwe().replace(/\n/g, '\r\n') + '\r\n']) {
      expect(parseSiwe(text), JSON.stringify(text)).not.toBeNull();
    }
    expect(parseSiwe(noStatement)?.statement).toBeNull();
    expect(parseSiwe(oneBlank)?.uri).toBe('https://example.com/login');
  });

  const MALFORMED: Record<string, string> = {
    'Version 2': siwe().replace('Version: 1', 'Version: 2'),
    'short nonce': siwe().replace('Nonce: 32891756abcDEF', 'Nonce: 1234567'),
    'header not on line 1': 'Welcome!\n' + siwe(),
    'unknown trailing field': siwe({ tail: ['Foo: bar'] }),
    'duplicate URI': siwe().replace('Version: 1', 'URI: https://example.com/other\nVersion: 1'),
    'invalid Issued At': siwe().replace('2021-09-30T16:25:24Z', '2021-13-30T16:25:24Z'),
    'statement that looks like a URI line': siwe({ statement: 'URI: https://evil.example/' }),
    'two-line statement': siwe({ statement: 'Line one\nLine two' }),
    'two-line statement with no blank line before URI': siwe().replace(
      'Sign in to Example.\n\n',
      'Sign in to Example.\nLine two\n',
    ),
    'no blank line after address': siwe().replace(`${ADDR}\n\n`, `${ADDR}\n`),
    'URI with whitespace': siwe({ uri: 'https://example.com/ login' }),
    'relative URI': siwe({ uri: '/login' }),
    'bad address': siwe().replace(ADDR, '0x1234'),
  };

  for (const [name, text] of Object.entries(MALFORMED)) {
    it(`rejects: ${name}`, () => {
      expect(parseSiwe(text)).toBeNull();
      expect(check(text, 'https://example.com')).toEqual({
        message: null,
        origin: 'https://example.com',
        host: null,
        warnings: [expect.objectContaining({ level: 'danger', code: 'malformed' })],
      });
    });
  }
});

describe('checkSiwe', () => {
  it('passes a sign-in from the site it names', () => {
    const r = check(siwe(), 'https://example.com');
    expect(r?.warnings).toEqual([]);
    expect(r?.message?.domain).toBe('example.com');
    expect(r?.host).toBe('example.com');
    expect(r?.origin).toBe('https://example.com');
  });

  it('checks hex-encoded messages exactly like plaintext', () => {
    expect(check(eip191Text(hex(siwe()))!, 'https://example.com')).toEqual(check(siwe(), 'https://example.com'));
    expect(codes(eip191Text(hex(siwe({ domain: 'opensea.io' })))!, 'https://example.com')).toContain('domain_mismatch');
  });

  it('is null (and does not throw) for 32-byte hashes and ordinary text', () => {
    const hash = '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470';
    expect(() => checkSiwe(eip191Text(hash), { origin: 'https://example.com' })).not.toThrow();
    expect(checkSiwe(eip191Text(hash), { origin: 'https://example.com' })).toBeNull();
    expect(checkSiwe(eip191Text(hex('hello') + 'ff'), { origin: 'https://example.com' })).toBeNull();
    expect(check('Welcome to Example! Nonce: 1234', 'https://example.com')).toBeNull();
    expect(checkSiwe(undefined, { origin: 'https://example.com' })).toBeNull();
  });

  it('flags a real sign-in whose bytes were altered as malformed, not as non-SIWE', () => {
    // '0xa' + hex: the vault pads to 0x0a…, so the device signs '\n' + message.
    const oddLength = eip191Text('0xa' + hex(siwe()).slice(2));
    expect(oddLength).toBe('\n' + siwe());
    expect(codes(oddLength!, 'https://example.com')).toEqual(['malformed']);
    // A trailing invalid byte fails the fatal decode but keeps the header.
    const badByte = eip191Text(hex(siwe()) + 'ff');
    expect(badByte).not.toBeNull();
    expect(codes(badByte!, 'https://example.com')).toEqual(['malformed']);
    expect(check(badByte!, 'https://example.com')?.warnings[0].text).toBe(
      "This looks like a Sign-In with Ethereum message but doesn't follow the standard, so KeepKey can't check which site it signs you in to.",
    );
  });

  it('flags an invalid byte as malformed even where its replacement character would parse', () => {
    for (const text of [siwe({ statement: 'Sign in XX' }), siwe({ uri: 'https://example.com/XX' })]) {
      // The lossy decode alone would pass clean: statements and URI paths take any character.
      expect(parseSiwe(text.replace('XX', '\uFFFDX')), text).not.toBeNull();
      const bad = eip191Text(hex(text).replace(hex('XX').slice(2), 'ff58'));
      expect(codes(bad!, 'https://example.com'), text).toEqual(['malformed']);
    }
  });

  it('flags a sign-in for another site with the exact wording', () => {
    const r = check(siwe({ domain: 'opensea.io', uri: 'https://opensea.io/' }), 'https://evil.example');
    expect(r?.warnings[0]).toEqual({
      level: 'danger',
      code: 'domain_mismatch',
      text: 'This sign-in is for opensea.io, but the request came from evil.example. Signing could let evil.example log in to opensea.io as you.',
    });
    expect(r?.warnings.map(w => w.code)).toEqual(['domain_mismatch', 'uri_mismatch']);
  });

  it('treats www and apex as different sites', () => {
    expect(codes(siwe({ domain: 'www.example.com' }), 'https://example.com')).toEqual(['domain_mismatch']);
    expect(codes(siwe({ domain: 'example.com', uri: 'https://www.example.com/' }), 'https://www.example.com')).toEqual([
      'domain_mismatch',
    ]);
  });

  it('requires explicit non-default ports to match', () => {
    expect(codes(siwe({ domain: 'example.com:8443' }), 'https://example.com')).toEqual(['domain_mismatch']);
    expect(codes(siwe({ uri: 'https://example.com:8443/' }), 'https://example.com:8443')).toEqual(['domain_mismatch']);
    expect(
      codes(siwe({ domain: 'example.com:8443', uri: 'https://example.com:8443/' }), 'https://example.com:8443'),
    ).toEqual([]);
  });

  it('matches localhost dev servers on their port', () => {
    expect(codes(siwe({ domain: 'localhost:3000', uri: 'http://localhost:3000/' }), 'http://localhost:3000')).toEqual(
      [],
    );
    expect(codes(siwe({ domain: 'localhost:3000', uri: 'http://localhost:3000/' }), 'http://localhost:3001')).toEqual([
      'domain_mismatch',
      'uri_mismatch',
    ]);
  });

  it('normalizes case, punycode and default ports', () => {
    expect(codes(siwe({ domain: 'EXAMPLE.com' }), 'https://example.com')).toEqual([]);
    expect(codes(siwe({ domain: 'example.com:443' }), 'https://example.com')).toEqual([]);
    const idn = check(
      siwe({ domain: 'bücher.example', uri: 'https://xn--bcher-kva.example/' }),
      'https://xn--bcher-kva.example',
    );
    expect(idn?.warnings).toEqual([]);
    expect(idn?.host).toBe('xn--bcher-kva.example');
    expect(idn?.message?.domain).toBe('bücher.example');
  });

  it('matches IPv6 hosts', () => {
    expect(codes(siwe({ domain: '[::1]:8545', uri: 'http://[::1]:8545/' }), 'http://[::1]:8545')).toEqual([]);
    expect(codes(siwe({ domain: '[2001:db8::1]', uri: 'https://[2001:db8::1]/' }), 'https://[2001:db8::1]')).toEqual(
      [],
    );
  });

  it('compares an explicit scheme with the page', () => {
    expect(codes(siwe({ domain: 'https://example.com' }), 'https://example.com')).toEqual([]);
    expect(codes(siwe({ domain: 'HTTPS://example.com' }), 'https://example.com')).toEqual([]);
    const r = check(siwe({ domain: 'http://example.com' }), 'https://example.com');
    expect(r?.warnings).toEqual([
      {
        level: 'danger',
        code: 'scheme_mismatch',
        text: 'This sign-in is for http://example.com, but the request came from https://example.com.',
      },
    ]);
  });

  it('assumes https when the scheme is omitted, except on localhost', () => {
    expect(codes(siwe({ domain: 'opensea.io', uri: 'http://opensea.io/' }), 'http://opensea.io')).toEqual([
      'scheme_mismatch',
    ]);
    expect(
      check(siwe({ domain: 'opensea.io', uri: 'http://opensea.io/' }), 'http://opensea.io')?.warnings[0].text,
    ).toBe('This sign-in is for https://opensea.io, but the request came from http://opensea.io.');
    expect(codes(siwe({ domain: 'localhost:3000', uri: 'http://localhost:3000/' }), 'http://localhost:3000')).toEqual(
      [],
    );
    expect(codes(siwe({ domain: '127.0.0.1:8080', uri: 'http://127.0.0.1:8080/' }), 'http://127.0.0.1:8080')).toEqual(
      [],
    );
  });

  it('never resolves domains that read as one site and parse as another', () => {
    // Each of these resolves to evil.example with a plain URL parse.
    for (const domain of ['opensea.io@evil.example', 'evil.example\\opensea.io', 'evil%2Eexample']) {
      const r = check(siwe({ domain, uri: 'https://evil.example/' }), 'https://evil.example');
      expect(
        r?.warnings.map(w => w.code),
        domain,
      ).toEqual(['domain_mismatch']);
      expect(r?.host, domain).toBeNull();
    }
  });

  it('only warns (does not gate) when the URI is on another origin', () => {
    const r = check(siwe({ uri: 'https://auth.example.net/login' }), 'https://example.com');
    expect(r?.warnings).toEqual([expect.objectContaining({ level: 'warning', code: 'uri_mismatch' })]);
    expect(r?.warnings[0].text).toBe(
      "This sign-in names https://auth.example.net/login as the resource you're signing in to, which is not on https://example.com. Some sites use a separate login server; make sure you expected this one.",
    );
  });

  it('skips the URI check for opaque URIs', () => {
    expect(
      codes(siwe({ uri: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK' }), 'https://example.com'),
    ).toEqual([]);
  });

  it('reports exactly one origin_unknown when the origin is missing or not a website', () => {
    for (const origin of [null, 'chrome-extension://abcdefghijklmnopabcdefghijklmnop', 'not a url']) {
      const r = check(siwe({ domain: 'opensea.io' }), origin);
      expect(r?.warnings, String(origin)).toEqual([
        expect.objectContaining({ level: 'danger', code: 'origin_unknown' }),
      ]);
      expect(r?.warnings[0].text).toBe(
        "KeepKey can't tell which website sent this request, so it can't check that it came from opensea.io.",
      );
      expect(r?.message?.domain).toBe('opensea.io');
      expect(r?.host).toBe('opensea.io');
    }
  });
});
