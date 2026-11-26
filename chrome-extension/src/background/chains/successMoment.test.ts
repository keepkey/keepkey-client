/**
 * Success moment (side panel): render with full motion vs reduced motion, the
 * txid page (txid + explorer link, Close never waits), and the spark physics.
 */
import { describe, expect, it } from 'vitest';
import { makeSparks, stepSpark, SUCCESS_MOMENT_MS } from '../../../../pages/side-panel/src/components/SuccessMoment';
import { renderSuccessMoment, renderTxidPage } from '../../../../pages/side-panel/src/components/SuccessMoment.render';

const TX = '0x9f2c4b7e1a0d3c5f8e6b2a1d4c7f0e3b9a8d6c5f4e3d2c1b0a9f8e7d6c5b4a39';

describe('SuccessMoment render', () => {
  it('full motion: drawn check, expanding ring, sparks canvas, network logo', () => {
    const html = renderSuccessMoment({ networkId: 'eip155:8453', reducedMotion: false });
    expect(html).toContain('data-motion="full"');
    expect(html).toContain('kk-sm-check');
    expect(html).toContain('kk-sm-circle');
    expect(html).toContain('data-success-ring');
    expect(html).toContain('data-success-sparks');
    expect(html).toContain('data-success-logo');
    expect(html).toContain('kk-sm-logo');
  });

  it('reduced motion: only the check (already drawn), no ring, no sparks, no animation classes', () => {
    const html = renderSuccessMoment({ networkId: 'eip155:8453', reducedMotion: true });
    expect(html).toContain('data-motion="reduced"');
    expect(html).toContain('M20 33.5 L28.5 42 L45 24.5');
    expect(html).not.toContain('data-success-ring');
    expect(html).not.toContain('data-success-sparks');
    expect(html).not.toMatch(/kk-sm-(check|circle|logo|ring)/);
  });

  it('uses KeepKey gold only (no rainbow palette) and never captures pointer events', () => {
    const html = renderSuccessMoment({ reducedMotion: false });
    expect(html).toMatch(/#d29929|#EDC157/i);
    expect(html).toContain('pointer-events:none');
    expect(html).not.toContain('data-success-logo'); // no network → no improvised logo
  });

  it('non-EVM network falls back to the official coin icon', () => {
    const html = renderSuccessMoment({ networkId: 'hive:beeab0de', reducedMotion: true });
    expect(html).toContain('data-success-logo');
  });
});

describe('TxidPage render', () => {
  it('shows the txid linked to the explorer, copy, and an immediate Done', () => {
    const url = `https://basescan.org/tx/${TX}`;
    const html = renderTxidPage({ txHash: TX, explorerUrl: url, networkId: 'eip155:8453', reducedMotion: true });
    expect(html).toContain('data-txid-page');
    expect(html).toContain('data-success-moment');
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain('data-txid-link');
    expect(html).toContain('0x9f2c4b7e…c5b4a39'.replace('c5b4a39', TX.slice(-8)));
    expect(html).toContain('Copy transaction ID');
    expect(html).toContain('data-action="close"');
    expect(html).not.toMatch(/disabled[^>]*data-action="close"/);
  });

  it('without an explorer URL: plain txid, no explorer button', () => {
    const html = renderTxidPage({ txHash: TX, reducedMotion: true });
    expect(html).toContain('data-txid-text');
    expect(html).not.toContain('data-action="view-explorer"');
  });
});

describe('spark physics', () => {
  it('a small burst, upward-biased, that falls under light gravity', () => {
    let seed = 1;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const sparks = makeSparks(14, rand);
    expect(sparks).toHaveLength(14);
    expect(sparks.filter(s => s.vy < 0).length).toBeGreaterThan(sparks.length / 2);
    // Canvas is 2.6× the 88px check: every spark must stay inside its radius.
    const radius = (88 * 2.6) / 2;
    for (const start of sparks) {
      let s = start;
      for (let t = 0; t < SUCCESS_MOMENT_MS; t += 16) s = stepSpark(s, 16);
      if (start.vy < 0) expect(s.vy).toBeGreaterThan(start.vy); // gravity bends the rising ones down
      expect(Math.hypot(s.x, s.y)).toBeLessThan(radius - 4);
    }
  });
});
