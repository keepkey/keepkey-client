/**
 * "Enable long posts for @account" — one click on the client, one approval in
 * KeepKey Vault, one KeepKey button press:
 *
 *   check     preconditions (active is this KeepKey; apps on posting confirmed)
 *   generate  a posting key in the browser, wrapped by the KeepKey (no press)
 *   authorize account_update signed by the KeepKey owner key (vault locks + diff)
 *   confirm   the new posting key is on chain
 *   unlock    only if the key was saved earlier and is locked (one press)
 *
 * Pure orchestration over the background's HIVE_BROWSER_KEY actions, so every
 * failure point is testable: it stops at the failing step and leaves whatever
 * already happened (a stored, not-yet-authorized key) for the next attempt to
 * pick up — it never deletes or re-creates on its own. It never touches the
 * pending dApp request; `ping` keeps that request's approval clock alive.
 */
export type EnableStep = 'check' | 'generate' | 'authorize' | 'confirm' | 'unlock';
export type StepStatus = 'pending' | 'active' | 'done' | 'skipped' | 'failed';
export type EnableResult =
  | { ok: true; pubkey: string | null }
  | { ok: false; step: EnableStep; error: string; details?: Record<string, unknown> };

type Send = (action: string, extra?: Record<string, unknown>) => Promise<any>;

export const FIRMWARE_BLOCKED_MESSAGE =
  "Your KeepKey's firmware can't authorize a browser posting key yet: when it updates a Hive account it always installs its own keys. This needs a firmware update.";

export async function enableLongPosts(
  send: Send,
  opts: {
    allowDropApps?: boolean;
    onStep?: (step: EnableStep, status: StepStatus) => void;
    ping?: () => void;
    confirmTries?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<EnableResult> {
  const onStep = opts.onStep ?? (() => {});
  const ping = opts.ping ?? (() => {});
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const fail = (step: EnableStep, error: string, details?: Record<string, unknown>): EnableResult => {
    onStep(step, 'failed');
    return { ok: false, step, error, details };
  };

  // 1. Preconditions — nothing is created until they hold.
  ping();
  onStep('check', 'active');
  const status = await send('status');
  if (!status?.ok)
    return fail('check', status?.error || 'KeepKey Client could not read the Hive account', status?.details);
  const preview = await send('authorizePreview');
  if (!preview?.ok) return fail('check', preview?.error || 'Could not read the account on chain');
  const ready = !!status.stored && !!preview.alreadyAuthorized;
  if (!ready) {
    if (preview.dedicateSupported === false) {
      return fail('check', FIRMWARE_BLOCKED_MESSAGE, { firmwareSupportsDedicate: false });
    }
    if (!preview.activeIsKeepKey) {
      return fail(
        'check',
        "This account's active key is not only this KeepKey, so the KeepKey can't authorize a browser key for it.",
      );
    }
    if (preview.droppedApps?.length && !opts.allowDropApps) {
      return fail(
        'check',
        `Posting access for ${preview.droppedApps.join(', ')} would be removed. Confirm to continue.`,
        {
          droppedApps: preview.droppedApps,
        },
      );
    }
  }
  onStep('check', 'done');

  // 2. Generate (skipped when a key is already stored, authorized or not).
  let pubkey: string | null = status.pubkey ?? null;
  if (status.stored) onStep('generate', 'skipped');
  else {
    ping();
    onStep('generate', 'active');
    const created = await send('create');
    if (!created?.ok) return fail('generate', created?.error || 'Could not create the key');
    pubkey = created.pubkey ?? null;
    onStep('generate', 'done');
  }

  // 3. Authorize on chain with the KeepKey owner key (vault approval + button).
  let confirmed = ready;
  if (ready) onStep('authorize', 'skipped');
  else {
    ping();
    onStep('authorize', 'active');
    const auth = await send('authorize', { allowDropApps: !!opts.allowDropApps });
    ping();
    if (!auth?.ok) return fail('authorize', auth?.error || 'Authorization was not completed', auth?.details);
    confirmed = !!auth.confirmed;
    onStep('authorize', 'done');
  }

  // 4. Confirm on chain (the vault already waits a few blocks; keep checking).
  if (ready) onStep('confirm', 'skipped');
  else {
    onStep('confirm', 'active');
    for (let i = 0; !confirmed && i < (opts.confirmTries ?? 10); i++) {
      ping();
      await sleep(3000);
      const p = await send('authorizePreview');
      confirmed = !!p?.ok && !!p.alreadyAuthorized;
    }
    if (!confirmed)
      return fail('confirm', 'Not visible on chain yet. Wait a moment and try again — nothing needs to be redone.');
    onStep('confirm', 'done');
  }

  // 5. Unlock only if needed (a freshly generated key is already in memory).
  const now = await send('status');
  if (now?.ok && now.unlocked) onStep('unlock', 'skipped');
  else {
    ping();
    onStep('unlock', 'active');
    const un = await send('unlock');
    if (!un?.ok) return fail('unlock', un?.error || 'Could not unlock the browser key');
    onStep('unlock', 'done');
  }
  return { ok: true, pubkey: now?.pubkey ?? pubkey };
}
