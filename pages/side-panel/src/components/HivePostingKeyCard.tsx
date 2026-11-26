/**
 * Browser posting key (Hive screen): KeepKey stays the vault for owner +
 * active; an optional posting key in this browser publishes what the KeepKey
 * cannot fit (long posts). Stored encrypted by the KeepKey; unlocking needs it.
 */
import { useState } from 'react';
import { Button, Flex, Input, Text, Box } from '@chakra-ui/react';
import { tokens, fonts } from '../styles/tokens';
import { Chip, KvRow, Muted, SectionLabel, Surface } from '../approval/ui';
import { setNamedAccount, shortKey, useBrowserKey } from './hiveBrowserKeyUi';
import { EnableLongPosts } from './EnableLongPosts';

export const BROWSER_KEY_TRADEOFF =
  'This key can post, vote and comment — never move funds. Anyone using this browser while it is unlocked could post as you. Owner and active stay on the KeepKey.';

export function HivePostingKeyCard() {
  const { status, preview, busy, message, run, refresh, stage } = useBrowserKey();
  const [accountInput, setAccountInput] = useState('');

  if (!status) return null;
  if (!status.ok) {
    return (
      <Surface marginTop="12px">
        <SectionLabel>Browser posting key</SectionLabel>
        <Muted>{status.error}</Muted>
        {status.details?.needsAccountName && (
          <Flex gap="8px" marginTop="10px">
            <Input
              size="sm"
              placeholder="account name"
              value={accountInput}
              onChange={e => setAccountInput(e.target.value)}
              autoCapitalize="none"
              spellCheck={false}
            />
            <Button
              size="sm"
              variant="keycapSecondary"
              isDisabled={!accountInput.trim()}
              onClick={() => {
                setNamedAccount(accountInput);
                refresh();
              }}>
              Continue
            </Button>
          </Flex>
        )}
      </Surface>
    );
  }

  const key = status.pubkey ?? status.pendingPubkey ?? null;
  const authorized = !!preview?.alreadyAuthorized;

  return (
    <Surface
      marginTop="12px"
      data-hive-browser-key={status.stored ? (status.unlocked ? 'unlocked' : 'locked') : 'none'}>
      <Flex justifyContent="space-between" alignItems="center" gap="8px">
        <SectionLabel>Browser posting key</SectionLabel>
        {status.stored && (
          <Chip tone={status.unlocked ? 'warn' : 'good'}>{status.unlocked ? 'unlocked' : 'locked'}</Chip>
        )}
      </Flex>
      <Muted>
        For posts the KeepKey can't fit, as @{status.account}. {BROWSER_KEY_TRADEOFF}
      </Muted>

      {(!key || !authorized) && (
        <Box marginTop="12px">
          <EnableLongPosts
            account={status.account}
            stage={stage}
            preview={preview}
            publish={false}
            onChanged={refresh}
          />
        </Box>
      )}

      {key && (
        <Box marginTop="10px">
          <KvRow label="Public key" title={key}>
            <Text
              as="button"
              fontFamily={fonts.mono}
              onClick={() => navigator.clipboard.writeText(key)}
              title="Copy — paste it in KeepKey Vault when creating or bringing an account">
              {shortKey(key)} ⧉
            </Text>
          </KvRow>
          <KvRow label="On chain" last={!status.stored}>
            {authorized ? 'Authorized for posting' : 'Not authorized yet'}
          </KvRow>
          {status.stored && (
            <Flex alignItems="center" justifyContent="space-between" padding="10px 0" gap="10px">
              <Text
                fontFamily={fonts.mono}
                fontSize="10.5px"
                letterSpacing="0.16em"
                textTransform="uppercase"
                color={tokens.faint}>
                Sign posts with
              </Text>
              <Flex gap="6px">
                {(['keepkey', 'client', 'ask'] as const).map(m => (
                  <Button
                    key={m}
                    size="xs"
                    variant={status.mode === m ? 'solid' : 'keycapSecondary'}
                    onClick={() => run('setMode', { mode: m })}
                    data-hive-mode={m}>
                    {m === 'keepkey' ? 'KeepKey' : m === 'client' ? 'Browser key' : 'Ask'}
                  </Button>
                ))}
              </Flex>
            </Flex>
          )}
        </Box>
      )}

      {status.stored && (
        <Flex gap="8px" marginTop="12px" flexWrap="wrap">
          {status.unlocked ? (
            <Button size="sm" variant="keycapSecondary" onClick={() => run('lock')}>
              Lock
            </Button>
          ) : (
            <Button size="sm" variant="keycapSecondary" isLoading={busy === 'unlock'} onClick={() => run('unlock')}>
              Unlock with KeepKey
            </Button>
          )}
          {authorized && (
            <Button
              size="sm"
              variant="keycapSecondary"
              isLoading={busy === 'revoke'}
              onClick={() => run('revoke', {}, 'Posting returned to your KeepKey; the browser key was deleted.')}>
              Revoke
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => run('forget', {}, 'Deleted from this browser. The chain is unchanged.')}>
            Delete from browser
          </Button>
        </Flex>
      )}

      {message && (
        <Text fontSize="12px" color={tokens.dim} marginTop="10px" data-hive-browser-key-message>
          {message}
        </Text>
      )}
    </Surface>
  );
}

export default HivePostingKeyCard;
