/**
 * The approval card's site must be derived from chrome.runtime.MessageSender,
 * never from the page-built requestInfo. These pin the two ways that breaks:
 * a page's forged siteUrl surviving the overwrite, and a non-extension sender
 * being mistaken for the extension (KeepKey logo, no URL) — e.g. by treating
 * a missing sender.tab as "it's us".
 */
import { describe, it, expect } from 'vitest';
import { siteFromSender } from './senderSite';

const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

describe('siteFromSender', () => {
  it('uses the tab sender url and origin', () => {
    const sender = { url: 'https://app.uniswap.org/swap', origin: 'https://app.uniswap.org', tab: { id: 7 } };
    expect(siteFromSender(sender, EXT)).toEqual({
      siteUrl: 'https://app.uniswap.org/swap',
      origin: 'https://app.uniswap.org',
    });
  });

  it('derives the origin from the url when sender.origin is absent', () => {
    expect(siteFromSender({ url: 'https://app.uniswap.org/swap?x=1' }, EXT)).toEqual({
      siteUrl: 'https://app.uniswap.org/swap?x=1',
      origin: 'https://app.uniswap.org',
    });
  });

  it('maps an opaque "null" origin to null but still shows the url', () => {
    expect(siteFromSender({ url: 'https://sandboxed.example/page', origin: 'null' }, EXT)).toEqual({
      siteUrl: 'https://sandboxed.example/page',
      origin: null,
    });
  });

  it('labels the extension itself by origin equality', () => {
    expect(siteFromSender({ url: `${EXT}/side-panel/index.html`, origin: EXT }, EXT)).toEqual({
      siteUrl: 'KeepKey Browser Extension',
      origin: null,
    });
  });

  it('does not treat a tab-less non-extension sender as the extension', () => {
    const r = siteFromSender({ url: 'https://evil.example/x', origin: 'https://evil.example' }, EXT);
    expect(r.siteUrl).not.toBe('KeepKey Browser Extension');
    expect(r).toEqual({ siteUrl: 'https://evil.example/x', origin: 'https://evil.example' });
  });

  it('overwrites a page-forged siteUrl/origin with the real sender', () => {
    const forged = { siteUrl: 'https://opensea.io', origin: 'https://opensea.io', method: 'personal_sign' };
    Object.assign(forged, siteFromSender({ url: 'https://evil.example/x', origin: 'https://evil.example' }, EXT));
    expect(forged).toEqual({
      siteUrl: 'https://evil.example/x',
      origin: 'https://evil.example',
      method: 'personal_sign',
    });
  });

  it('overwrites a page claiming to be the extension', () => {
    const forged = { siteUrl: 'KeepKey Browser Extension' };
    Object.assign(forged, siteFromSender({ url: 'https://evil.example/x', origin: 'https://evil.example' }, EXT));
    expect(forged.siteUrl).toBe('https://evil.example/x');
  });

  it('strips userinfo so a forged name cannot sit in the host position', () => {
    expect(siteFromSender({ url: 'https://opensea.io@evil.example/x' }, EXT)).toEqual({
      siteUrl: 'https://evil.example/x',
      origin: 'https://evil.example',
    });
    expect(
      siteFromSender({ url: 'https://opensea.io:pw@evil.example/x', origin: 'https://evil.example' }, EXT),
    ).toEqual({ siteUrl: 'https://evil.example/x', origin: 'https://evil.example' });
  });

  it('falls back to "Unknown site" for an unparsable url with no origin', () => {
    expect(siteFromSender({ url: 'not a url' }, EXT)).toEqual({ siteUrl: 'Unknown site', origin: null });
    expect(siteFromSender({}, EXT)).toEqual({ siteUrl: 'Unknown site', origin: null });
  });
});
