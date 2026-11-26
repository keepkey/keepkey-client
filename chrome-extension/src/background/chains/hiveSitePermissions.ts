/**
 * Hive account-name permission per site origin (Keychain requestAccount).
 * A site sees the account name only after the user approves it once; the grant
 * is bound to the account (another account asks again) and revocable from the
 * Hive screen. The origin comes from Chrome's sender (senderSite.ts), never
 * from the page.
 */
export type HiveSiteGrant = { origin: string; account: string; grantedAt: string };
type Store = { get(key: string): Promise<any>; set(key: string, value: any): Promise<void> };

export const HIVE_SITES_KEY = 'hiveConnectedOrigins';

const normalizeOrigin = (origin: unknown): string | null => {
  if (typeof origin !== 'string') return null;
  try {
    const u = new URL(origin);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin;
  } catch {
    return null;
  }
};

export function createHiveSitePermissions(store: Store, now: () => number = () => Date.now()) {
  const all = async (): Promise<Record<string, HiveSiteGrant>> => {
    const v = await store.get(HIVE_SITES_KEY);
    return v && typeof v === 'object' ? v : {};
  };
  return {
    normalizeOrigin,
    async isGranted(origin: unknown, account: string): Promise<boolean> {
      const o = normalizeOrigin(origin);
      if (!o) return false;
      return (await all())[o]?.account === account;
    },
    async grant(origin: unknown, account: string): Promise<void> {
      const o = normalizeOrigin(origin);
      if (!o) throw new Error('Unknown site');
      const grants = await all();
      grants[o] = { origin: o, account, grantedAt: new Date(now()).toISOString() };
      await store.set(HIVE_SITES_KEY, grants);
    },
    async revoke(origin: unknown): Promise<void> {
      const o = normalizeOrigin(origin);
      if (!o) return;
      const grants = await all();
      delete grants[o];
      await store.set(HIVE_SITES_KEY, grants);
    },
    async list(): Promise<HiveSiteGrant[]> {
      return Object.values(await all()).sort((a, b) => a.origin.localeCompare(b.origin));
    },
  };
}
