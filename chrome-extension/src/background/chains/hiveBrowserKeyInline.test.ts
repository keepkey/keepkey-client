/**
 * "Enable long posts for @account": one click in the client, one approval in
 * the vault, one KeepKey press. Each failing step stops the chain with the
 * state consistent (nothing deleted, nothing published) and keeps the pending
 * dApp request alive (pings).
 */
import { describe, expect, it, vi } from 'vitest';
import { enableLongPosts } from '../../../../pages/side-panel/src/components/longPostsFlow';
import { renderEnableLongPosts } from '../../../../pages/side-panel/src/components/EnableLongPosts.render';
import { browserKeyStage } from '../../../../pages/side-panel/src/components/hiveBrowserKeyUi';

const KEY = 'STM7abcdefghijkLMNOPQRSTUVWXYZ123456789abcdefghijkmnop';
const preview = (over: Record<string, unknown> = {}) => ({
  ok: true,
  candidate: null,
  before: { key_auths: [['STM6keepkey', 1]], account_auths: [] },
  droppedApps: [] as string[],
  alreadyAuthorized: false,
  activeIsKeepKey: true,
  ...over,
});

/** A scripted background: answers each action from a queue (last answer repeats). */
function background(script: Record<string, any[]>) {
  const calls: string[] = [];
  const send = vi.fn(async (action: string, extra?: Record<string, unknown>) => {
    calls.push(extra && Object.keys(extra).length ? `${action}:${JSON.stringify(extra)}` : action);
    const q = script[action] ?? [{ ok: false, error: `unexpected ${action}` }];
    return q.length > 1 ? q.shift() : q[0];
  });
  return { send, calls };
}
const fast = { sleep: async () => {}, confirmTries: 3 };

describe('enableLongPosts', () => {
  it('happy path: check → generate → authorize (confirmed) → already unlocked; no extra press', async () => {
    const bg = background({
      status: [
        { ok: true, stored: false },
        { ok: true, stored: true, unlocked: true, pubkey: KEY },
      ],
      authorizePreview: [preview()],
      create: [{ ok: true, pubkey: KEY }],
      authorize: [{ ok: true, confirmed: true }],
    });
    const steps: string[] = [];
    const ping = vi.fn();
    const r = await enableLongPosts(bg.send, { ...fast, ping, onStep: (s, st) => steps.push(`${s}:${st}`) });
    expect(r).toEqual({ ok: true, pubkey: KEY });
    expect(bg.calls).toEqual(['status', 'authorizePreview', 'create', 'authorize:{"allowDropApps":false}', 'status']);
    expect(steps).toEqual([
      'check:active',
      'check:done',
      'generate:active',
      'generate:done',
      'authorize:active',
      'authorize:done',
      'confirm:active',
      'confirm:done',
      'unlock:skipped',
    ]);
    expect(ping.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('waits for the chain when the vault returned before confirmation', async () => {
    const bg = background({
      status: [
        { ok: true, stored: false },
        { ok: true, stored: true, unlocked: true, pubkey: KEY },
      ],
      authorizePreview: [preview(), preview(), preview({ alreadyAuthorized: true })],
      create: [{ ok: true, pubkey: KEY }],
      authorize: [{ ok: true, confirmed: false }],
    });
    expect(await enableLongPosts(bg.send, fast)).toEqual({ ok: true, pubkey: KEY });
    expect(bg.calls.filter(c => c === 'authorizePreview')).toHaveLength(3);
  });

  it('an authorized but locked key just unlocks (one press)', async () => {
    const bg = background({
      status: [{ ok: true, stored: true, unlocked: false, pubkey: KEY }],
      authorizePreview: [preview({ alreadyAuthorized: true, candidate: KEY })],
      unlock: [{ ok: true, pubkey: KEY }],
    });
    expect((await enableLongPosts(bg.send, fast)).ok).toBe(true);
    expect(bg.calls).toEqual(['status', 'authorizePreview', 'status', 'unlock']);
  });

  it('a stored but unauthorized key (earlier attempt) is reused, never re-generated', async () => {
    const bg = background({
      status: [{ ok: true, stored: true, unlocked: true, pubkey: KEY }],
      authorizePreview: [preview({ candidate: KEY })],
      authorize: [{ ok: true, confirmed: true }],
    });
    expect((await enableLongPosts(bg.send, fast)).ok).toBe(true);
    expect(bg.calls).not.toContain('create');
  });

  it('firmware that cannot authorize an external posting key → stops at check, nothing generated, nothing sent to the vault', async () => {
    const bg = background({
      status: [{ ok: true, stored: false }],
      authorizePreview: [preview({ dedicateSupported: false })],
    });
    const r = await enableLongPosts(bg.send, fast);
    expect(r).toMatchObject({ ok: false, step: 'check', details: { firmwareSupportsDedicate: false } });
    expect(bg.calls).toEqual(['status', 'authorizePreview']);
  });

  it('…but a key already authorized on chain still works on that firmware (unlock only)', async () => {
    const bg = background({
      status: [{ ok: true, stored: true, unlocked: false, pubkey: KEY }],
      authorizePreview: [preview({ dedicateSupported: false, alreadyAuthorized: true })],
      unlock: [{ ok: true, pubkey: KEY }],
    });
    expect((await enableLongPosts(bg.send, fast)).ok).toBe(true);
  });

  describe('failures stop the chain and leave the state consistent', () => {
    it('active key is not only this KeepKey → nothing is created', async () => {
      const bg = background({
        status: [{ ok: true, stored: false }],
        authorizePreview: [preview({ activeIsKeepKey: false })],
      });
      const r = await enableLongPosts(bg.send, fast);
      expect(r).toMatchObject({ ok: false, step: 'check' });
      expect(bg.calls).toEqual(['status', 'authorizePreview']);
    });

    it('apps on posting without consent → nothing is created; with consent the flag reaches the vault', async () => {
      const apps = preview({ droppedApps: ['peakd.app'] });
      const no = background({ status: [{ ok: true, stored: false }], authorizePreview: [apps] });
      expect(await enableLongPosts(no.send, fast)).toMatchObject({
        ok: false,
        step: 'check',
        details: { droppedApps: ['peakd.app'] },
      });
      expect(no.calls).not.toContain('create');
      const yes = background({
        status: [
          { ok: true, stored: false },
          { ok: true, stored: true, unlocked: true, pubkey: KEY },
        ],
        authorizePreview: [apps],
        create: [{ ok: true, pubkey: KEY }],
        authorize: [{ ok: true, confirmed: true }],
      });
      expect((await enableLongPosts(yes.send, { ...fast, allowDropApps: true })).ok).toBe(true);
      expect(yes.calls).toContain('authorize:{"allowDropApps":true}');
    });

    it('key generation fails → no authorization attempted', async () => {
      const bg = background({
        status: [{ ok: true, stored: false }],
        authorizePreview: [preview()],
        create: [{ ok: false, error: 'Vault not connected' }],
      });
      expect(await enableLongPosts(bg.send, fast)).toMatchObject({
        ok: false,
        step: 'generate',
        error: 'Vault not connected',
      });
      expect(bg.calls).not.toContain('authorize:{"allowDropApps":false}');
    });

    it('vault/KeepKey rejects the authorization → stops; the stored key stays for a retry; nothing published', async () => {
      const bg = background({
        status: [{ ok: true, stored: false }],
        authorizePreview: [preview()],
        create: [{ ok: true, pubkey: KEY }],
        authorize: [{ ok: false, error: 'Signing rejected by user' }],
      });
      const r = await enableLongPosts(bg.send, fast);
      expect(r).toMatchObject({ ok: false, step: 'authorize', error: 'Signing rejected by user' });
      expect(bg.calls).not.toContain('forget');
      expect(bg.calls).not.toContain('unlock');
    });

    it('chain never confirms → stops at confirm (the next click resumes at authorize-check)', async () => {
      const bg = background({
        status: [{ ok: true, stored: false }],
        authorizePreview: [preview()],
        create: [{ ok: true, pubkey: KEY }],
        authorize: [{ ok: true, confirmed: false }],
      });
      const ping = vi.fn();
      expect(await enableLongPosts(bg.send, { ...fast, ping })).toMatchObject({ ok: false, step: 'confirm' });
      expect(ping.mock.calls.length).toBeGreaterThanOrEqual(5); // the pending post's clock kept alive while waiting
    });

    it('unlock refused → stops before any publish', async () => {
      const bg = background({
        status: [{ ok: true, stored: true, unlocked: false, pubkey: KEY }],
        authorizePreview: [preview({ alreadyAuthorized: true })],
        unlock: [{ ok: false, error: 'Action cancelled by user' }],
      });
      expect(await enableLongPosts(bg.send, fast)).toMatchObject({ ok: false, step: 'unlock' });
    });
  });
});

describe('Enable long posts — card render', () => {
  const base = {
    account: 'sopadevs',
    preview: preview() as any,
    steps: {},
    running: false,
    error: null,
    allowDropApps: false,
    publish: true,
    importing: false,
    importBusy: false,
    onToggleApps: vi.fn(),
    onEnable: vi.fn(),
    onShowImport: vi.fn(),
    onImport: vi.fn(),
    onCancelImport: vi.fn(),
  };

  it('no key: one primary button; import is the secondary link (no WIF field by default)', () => {
    const html = renderEnableLongPosts({ ...base, stage: 'none' });
    expect(html).toContain('Enable long posts for @sopadevs');
    expect(html).toContain('I already have an authorized posting key');
    expect(html).not.toContain('Posting private key');
    expect(html).toContain('never move funds');
  });

  it('progress shows the steps, with publish when on the approval card', () => {
    const html = renderEnableLongPosts({
      ...base,
      stage: 'none',
      running: true,
      steps: { check: 'done', generate: 'done', authorize: 'active' },
    });
    for (const t of [
      'Generating a posting key in the browser',
      'Approve in KeepKey Vault, then press the button on your KeepKey',
      'Confirming on the Hive chain',
      'Publishing your post',
    ]) {
      expect(html).toContain(t);
    }
    expect(html).toContain('data-step="authorize" data-step-status="active"');
  });

  it('apps on posting: listed, and the button waits for the checkbox', () => {
    const html = renderEnableLongPosts({
      ...base,
      stage: 'unauthorized',
      preview: preview({ droppedApps: ['peakd.app'] }) as any,
    });
    expect(html).toContain('These apps lose posting access: peakd.app');
    expect(html).toMatch(/data-action="enable-long-posts"[^>]*disabled|disabled[^>]*data-action="enable-long-posts"/);
  });

  it('firmware blocked: says so, button disabled, import of an already-authorized key still offered', () => {
    const html = renderEnableLongPosts({
      ...base,
      stage: 'none',
      preview: preview({ dedicateSupported: false }) as any,
    });
    expect(html).toContain('data-enable-blocked="firmware"');
    expect(html).toContain('authorize a browser posting key yet');
    expect(html).toMatch(/data-action="enable-long-posts"[^>]*disabled|disabled[^>]*data-action="enable-long-posts"/);
    expect(html).toContain('I already have an authorized posting key');
  });

  it('locked: a single Unlock action, no tradeoff block or import link', () => {
    const html = renderEnableLongPosts({ ...base, stage: 'locked' });
    expect(html).toContain('Unlock with KeepKey');
    expect(html).not.toContain('I already have an authorized posting key');
  });

  it('import is still reachable as a secondary path', () => {
    expect(renderEnableLongPosts({ ...base, stage: 'none', importing: true })).toContain('Posting private key');
  });
});

describe('browserKeyStage', () => {
  const ok = { ok: true, account: 'sopadevs' };
  it('walks none → unauthorized → locked → ready', () => {
    expect(browserKeyStage(null, null)).toBe('loading');
    expect(browserKeyStage({ ok: false, error: 'x' }, null)).toBe('error');
    expect(browserKeyStage({ ...ok, stored: false }, preview() as any)).toBe('none');
    expect(browserKeyStage({ ...ok, stored: true, pubkey: KEY, unlocked: false }, preview() as any)).toBe(
      'unauthorized',
    );
    expect(
      browserKeyStage(
        { ...ok, stored: true, pubkey: KEY, unlocked: false },
        preview({ alreadyAuthorized: true }) as any,
      ),
    ).toBe('locked');
    expect(
      browserKeyStage(
        { ...ok, stored: true, pubkey: KEY, unlocked: true },
        preview({ alreadyAuthorized: true }) as any,
      ),
    ).toBe('ready');
  });
});
