import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Owner decision 2026-11-13: transactions are never built on a server.
// KeepKey Desktop builds them locally; servers only supply chain data.
const SRC = fileURLToPath(new URL('../../', import.meta.url));
const CHAINS = fileURLToPath(new URL('./', import.meta.url));

const DESKTOP_BUILT_HANDLERS = [
  'bitcoinHandler.ts',
  'bitcoinCashHandler.ts',
  'litecoinHandler.ts',
  'dogecoinHandler.ts',
  'dashHandler.ts',
  'cosmosHandler.ts',
  'osmosisHandler.ts',
  'thorchainHandler.ts',
  'mayaHandler.ts',
  'rippleHandler.ts',
];

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts') ? [full] : [];
  });

const read = (file: string) => readFileSync(join(CHAINS, file), 'utf8');

describe('no server-side transaction build', () => {
  it('nothing under chrome-extension/src calls the legacy buildTx endpoint', () => {
    const offenders = sourceFiles(SRC).filter(file => readFileSync(file, 'utf8').includes('api/v1/buildTx'));
    expect(offenders).toEqual([]);
  });

  it.each(DESKTOP_BUILT_HANDLERS)('%s builds via Desktop and signs exactly what Desktop built', file => {
    const source = read(file);
    expect(source).toContain('buildViaDesktop(');
    expect(source).toContain('wallet.signViaVault(build.signRoute, build.signBody)');
  });

  it.each(DESKTOP_BUILT_HANDLERS)('%s never patches coin into a signViaVault body', file => {
    const calls = [...read(file).matchAll(/signViaVault\(([\s\S]*?)\);/g)].map(match => match[1]);
    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls) expect(args).not.toMatch(/coin|\.\.\./);
  });
});
