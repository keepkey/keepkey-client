/** requestAccount permission: once per origin, bound to the account, revocable. */
import { describe, expect, it } from 'vitest';
import { createHiveSitePermissions, HIVE_SITES_KEY } from './hiveSitePermissions';
import { buildHiveApprovalView } from '../../../../packages/shared/lib/utils/hiveApproval';

const memory = () => {
  const data = new Map<string, any>();
  return {
    data,
    store: {
      get: async (k: string) => data.get(k),
      set: async (k: string, v: any) => void data.set(k, JSON.parse(JSON.stringify(v))),
    },
  };
};

describe('hive site permissions', () => {
  it('a site is not granted until approved; then it is, for that account only', async () => {
    const { store } = memory();
    const perms = createHiveSitePermissions(store, () => Date.UTC(2026, 10, 26));
    expect(await perms.isGranted('https://skatehive.app', 'sopadevs')).toBe(false);
    await perms.grant('https://skatehive.app/some/page?x=1', 'sopadevs');
    expect(await perms.isGranted('https://skatehive.app', 'sopadevs')).toBe(true);
    expect(await perms.isGranted('https://skatehive.app', 'another')).toBe(false);
    expect(await perms.isGranted('https://evil.example', 'sopadevs')).toBe(false);
    expect(await perms.list()).toEqual([
      { origin: 'https://skatehive.app', account: 'sopadevs', grantedAt: '2026-11-26T00:00:00.000Z' },
    ]);
  });

  it('revoke removes the grant; others stay', async () => {
    const { store, data } = memory();
    const perms = createHiveSitePermissions(store);
    await perms.grant('https://skatehive.app', 'sopadevs');
    await perms.grant('https://peakd.com', 'sopadevs');
    await perms.revoke('https://skatehive.app');
    expect(await perms.isGranted('https://skatehive.app', 'sopadevs')).toBe(false);
    expect(await perms.isGranted('https://peakd.com', 'sopadevs')).toBe(true);
    expect(Object.keys(data.get(HIVE_SITES_KEY))).toEqual(['https://peakd.com']);
  });

  it('opaque or non-web origins are never granted', async () => {
    const perms = createHiveSitePermissions(memory().store);
    await expect(perms.grant('null', 'sopadevs')).rejects.toThrow('Unknown site');
    await expect(perms.grant('chrome-extension://abc', 'sopadevs')).rejects.toThrow('Unknown site');
    expect(await perms.isGranted(undefined, 'sopadevs')).toBe(false);
  });
});

describe('requestAccount approval card', () => {
  it('reads as a connect request with site and account, nothing signed', () => {
    const v = buildHiveApprovalView({
      type: 'requestAccount',
      siteUrl: 'https://skatehive.app/',
      unsignedTx: { from: 'sopadevs', origin: 'https://skatehive.app' },
    });
    expect(v.title).toBe('Connect skatehive.app to your Hive account');
    expect(v.ops[0].rows).toEqual([
      { label: 'Account', value: '@sopadevs' },
      { label: 'Site', value: 'skatehive.app' },
    ]);
    expect(v.checks).toEqual([{ status: 'ok', title: 'Nothing is signed' }]);
    expect(v.clientSignable).toBe(false);
  });
});
