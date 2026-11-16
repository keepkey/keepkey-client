/**
 * One shared, gateway-registered Pioneer query key for every keyed call to
 * api.keepkey.info (portfolio, HIVE price, broadcasts, the swap SSE stream).
 *
 * The gateway answers 401/404/405 by replaying the request to the old green
 * Pioneer, so the client never sees a gateway 401: an unknown or disabled key
 * shows up as green's answer (`x-kk-served-by: green`). That header is the
 * re-register signal.
 *
 * Register rules (gateway): JSON body `{ username: key.slice(0,32), queryKey }`,
 * key 32-512 chars, idempotent 200, 400 = bad key, 403 = credential_disabled,
 * 5/min per IP. Auth is the raw key in `Authorization` (no Bearer).
 */
const PIONEER_API = 'https://api.keepkey.info';
const KEY = 'keepkey-pioneer-query-key'; // same storage key as 0.0.39
const REG = 'keepkey-pioneer-query-key-registered'; // `${PIONEER_API}\n${key}` after a 200/409
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
let inflight: Promise<string> | null = null;

async function loadKey(): Promise<string> {
  const s = await chrome.storage.local.get(KEY);
  let key = s[KEY];
  if (typeof key !== 'string' || key !== key.trim() || key.length < 32 || key.length > 512) {
    key = `bex:${crypto.randomUUID()}`;
    await chrome.storage.local.set({ [KEY]: key });
  }
  return key;
}

async function register(key: string): Promise<'ok' | 'disabled'> {
  for (const wait of [0, 2_000, 5_000, 15_000]) {
    // short: MV3 worker can die after ~30 s idle
    if (wait) await sleep(wait);
    let res: Response;
    try {
      res = await fetch(`${PIONEER_API}/api/v1/user/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: key.slice(0, 32), queryKey: key }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      continue;
    }
    if (res.ok || res.status === 409) {
      await chrome.storage.local.set({ [REG]: `${PIONEER_API}\n${key}` });
      return 'ok';
    }
    if (res.status === 403) return 'disabled';
    if (res.status === 429) {
      await sleep(Math.min(30, Number(res.headers.get('Retry-After')) || 12) * 1000);
      continue;
    }
    if (res.status === 400) throw new Error('pioneer register rejected key');
  }
  throw new Error('pioneer register failed');
}

export function ensureQueryKey(force = false): Promise<string> {
  if (inflight) return inflight;
  inflight = (async () => {
    let key = await loadKey();
    const s = await chrome.storage.local.get(REG);
    if (!force && s[REG] === `${PIONEER_API}\n${key}`) return key;
    if ((await register(key)) === 'disabled') {
      // rotate once
      key = `bex:${crypto.randomUUID()}`;
      await chrome.storage.local.set({ [KEY]: key });
      if ((await register(key)) !== 'ok') throw new Error('pioneer key disabled');
    }
    return key;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/**
 * Keyed IDEMPOTENT READ only (e.g. /portfolio/balances, /market/info). Raw key, no Bearer.
 * NEVER use for /broadcast, /hive/broadcast*, or any other write: it re-sends the body.
 * A keyed path answered by green means the gateway didn't recognise the key (it replays
 * its 401 to green, so we never see the 401). Re-register once and retry once.
 */
export async function pioneerFetch(path: string, init: RequestInit = {}): Promise<Response> {
  for (const force of [false, true]) {
    const headers = new Headers(init.headers);
    headers.set('Authorization', await ensureQueryKey(force));
    headers.delete('x-api-key');
    const res = await fetch(`${PIONEER_API}${path}`, { ...init, headers });
    if (res.headers.get('x-kk-served-by') !== 'green') return res;
    if (force) {
      console.warn('[pioneer] keyed call still served by green', path, res.status); // defect
      return res; // caller handles it; green still answers while DO is up
    }
    await res.body?.cancel();
  }
  throw new Error('unreachable');
}
