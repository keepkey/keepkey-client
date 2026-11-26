/**
 * Browser posting key (Hive) — shared state + pieces for the Hive screen card
 * and the inline flow on the approval card. All key operations run in the
 * background (HIVE_BROWSER_KEY); the panel never sees a private key except the
 * WIF the user types into the import field, which goes straight to the
 * background and is cleared.
 */
import { useCallback, useEffect, useState } from 'react';
import { Box, Button, Checkbox, Flex, Input, Stack, Text } from '@chakra-ui/react';
import { tokens, fonts } from '../styles/tokens';
import { KvRow, Muted } from '../approval/ui';

export type BrowserKeyStatus = {
  ok: boolean;
  error?: string;
  details?: { needsAccountName?: boolean };
  account?: string;
  stored?: boolean;
  pubkey?: string | null;
  unlocked?: boolean;
  mode?: 'keepkey' | 'client' | 'ask';
  pendingPubkey?: string | null;
};
export type BrowserKeyPreview = {
  ok: boolean;
  error?: string;
  candidate: string | null;
  before: { key_auths: [string, number][]; account_auths: [string, number][] };
  droppedApps: string[];
  alreadyAuthorized: boolean;
  activeIsKeepKey: boolean;
  /** False when this KeepKey's firmware cannot authorize a browser key (vault-reported). */
  dedicateSupported?: boolean;
};
export type BrowserKeyStage = 'loading' | 'error' | 'none' | 'unauthorized' | 'locked' | 'ready';

// Account name typed by the user while this KeepKey has no Hive account yet.
let namedAccount = '';
export const setNamedAccount = (name: string) => {
  namedAccount = name.trim().replace(/^@/, '').toLowerCase();
};

export const sendBrowserKey = (action: string, extra: Record<string, unknown> = {}): Promise<any> =>
  new Promise(resolve =>
    chrome.runtime.sendMessage({ type: 'HIVE_BROWSER_KEY', action, account: namedAccount || undefined, ...extra }, r =>
      resolve(
        chrome.runtime.lastError
          ? { ok: false, error: chrome.runtime.lastError.message }
          : (r ?? { ok: false, error: 'No response' }),
      ),
    ),
  );

export const shortKey = (k?: string | null) => (k ? `${k.slice(0, 10)}…${k.slice(-6)}` : '—');

/** Where the user is: what the next step is before the browser key can sign. */
export function browserKeyStage(status: BrowserKeyStatus | null, preview: BrowserKeyPreview | null): BrowserKeyStage {
  if (!status) return 'loading';
  if (!status.ok) return 'error';
  if (!status.stored && !status.pendingPubkey) return 'none';
  if (!preview?.ok || !preview.alreadyAuthorized) return 'unauthorized';
  if (!status.stored) return 'unauthorized';
  return status.unlocked ? 'ready' : 'locked';
}

/** State + actions. `onActivity` fires on every user action (keeps a pending request alive). */
export function useBrowserKey(onActivity?: () => void) {
  const [status, setStatus] = useState<BrowserKeyStatus | null>(null);
  const [preview, setPreview] = useState<BrowserKeyPreview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const s: BrowserKeyStatus = await sendBrowserKey('status');
    setStatus(s);
    // Always: the Enable button needs apps/active preconditions before any key exists.
    setPreview(s.ok ? await sendBrowserKey('authorizePreview') : null);
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const run = useCallback(
    async (action: string, extra: Record<string, unknown> = {}, note?: string) => {
      onActivity?.();
      setBusy(action);
      setMessage(null);
      const r = await sendBrowserKey(action, extra);
      setBusy(null);
      if (!r.ok) setMessage(r.error || 'Something went wrong');
      else if (r.needsAuthorization) setMessage(r.reason);
      else if (note) setMessage(note);
      onActivity?.();
      await refresh();
      return r;
    },
    [onActivity, refresh],
  );

  return { status, preview, busy, message, run, refresh, stage: browserKeyStage(status, preview) };
}

export function ImportKeyForm({
  account,
  busy,
  onImport,
  onCancel,
}: {
  account?: string;
  busy: boolean;
  onImport: (wif: string) => void;
  onCancel?: () => void;
}) {
  const [wif, setWif] = useState('');
  return (
    <Stack spacing="8px" data-hive-import-form>
      <Input
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder="Posting private key (5…)"
        value={wif}
        onChange={e => setWif(e.target.value)}
        fontFamily={fonts.mono}
        fontSize="12px"
      />
      <Muted>
        Encrypted by your KeepKey before it is saved. It must be {account ? `@${account}'s` : 'the account’s'} posting
        key — it is checked against the chain.
      </Muted>
      <Flex gap="8px">
        <Button
          size="sm"
          variant="solid"
          isDisabled={!wif.trim()}
          isLoading={busy}
          onClick={() => {
            onImport(wif.trim());
            setWif('');
          }}>
          Import
        </Button>
        {onCancel && (
          <Button
            size="sm"
            variant="keycapSecondary"
            onClick={() => {
              setWif('');
              onCancel();
            }}>
            Cancel
          </Button>
        )}
      </Flex>
    </Stack>
  );
}

/** Authorize (dedicate posting) with the KeepKey's owner key, showing the authority diff first. */
export function AuthorizeBox({
  account,
  keyPub,
  preview,
  busy,
  onAuthorize,
}: {
  account?: string;
  keyPub: string | null;
  preview: BrowserKeyPreview | null;
  busy: boolean;
  onAuthorize: (allowDropApps: boolean) => void;
}) {
  const [dropApps, setDropApps] = useState(false);
  if (!preview?.ok) return <Muted>{preview?.error || 'Checking the account…'}</Muted>;
  return (
    <Box padding="10px 12px" borderRadius="10px" border={`1px solid ${tokens.line}`} data-hive-authorize>
      <Text fontSize="12.5px" fontWeight={600} color={tokens.text}>
        Authorize on @{account}
      </Text>
      <Muted marginTop="2px">
        Your KeepKey signs with its owner key. Posting becomes this browser key only: the KeepKey stops signing posts.
        Owner, active and memo stay exactly the same (the vault refuses otherwise).
      </Muted>
      <KvRow label="Posting now">{preview.before.key_auths.map(([k]) => shortKey(k)).join(', ') || '—'}</KvRow>
      <KvRow label="Posting after" last={!preview.droppedApps.length}>
        {shortKey(keyPub)}
      </KvRow>
      {preview.droppedApps.length > 0 && (
        <Box paddingTop="8px">
          <Text fontSize="12px" color={tokens.bad} fontWeight={600}>
            These apps lose posting access: {preview.droppedApps.join(', ')}
          </Text>
          <Checkbox size="sm" isChecked={dropApps} onChange={e => setDropApps(e.target.checked)} marginTop="6px">
            <Text fontSize="12px">Remove their access</Text>
          </Checkbox>
        </Box>
      )}
      {!preview.activeIsKeepKey && (
        <Text fontSize="12px" color={tokens.bad} marginTop="8px">
          This account's active key is not only this KeepKey, so the KeepKey can't authorize it. Add the key when
          creating or bringing the account in KeepKey Vault.
        </Text>
      )}
      <Button
        size="sm"
        variant="solid"
        marginTop="10px"
        isDisabled={!preview.activeIsKeepKey || (preview.droppedApps.length > 0 && !dropApps)}
        isLoading={busy}
        onClick={() => onAuthorize(dropApps)}>
        Authorize with KeepKey
      </Button>
    </Box>
  );
}
