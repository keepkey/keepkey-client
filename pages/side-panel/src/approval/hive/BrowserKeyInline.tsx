/**
 * Long posts on the Hive approval card: when the KeepKey cannot fit the post,
 * one button ("Enable long posts for @account") sets up the browser posting
 * key and, once it can sign, publishes the pending post without another click.
 * Every step pings `approval_activity` so the dApp request stays open.
 */
import { useEffect } from 'react';
import { Text } from '@chakra-ui/react';
import { tokens } from '../../styles/tokens';
import { Muted, SectionLabel, Surface } from '../ui';
import { useBrowserKey, type BrowserKeyStage } from '../../components/hiveBrowserKeyUi';
import { EnableLongPosts } from '../../components/EnableLongPosts';

export function BrowserKeyInline({
  eventId,
  deviceBlocked,
  onState,
  onEnabled,
}: {
  eventId: string;
  deviceBlocked: boolean;
  onState: (s: { stage: BrowserKeyStage; mode?: 'keepkey' | 'client' | 'ask' }) => void;
  /** The key can sign now: publish the pending request with it. */
  onEnabled: () => void;
}) {
  const ping = () => {
    try {
      chrome.runtime.sendMessage({ action: 'approval_activity', eventId })?.catch?.(() => {});
    } catch {
      /* the request clock is best-effort */
    }
  };
  const { status, preview, refresh, stage } = useBrowserKey(ping);
  useEffect(() => {
    onState({ stage, mode: status?.mode });
  }, [stage, status?.mode, onState]);

  if (stage === 'loading' || stage === 'ready') return null;
  if (stage === 'error')
    return deviceBlocked && status?.error ? <Muted data-hive-inline="error">{status.error}</Muted> : null;
  if (!deviceBlocked && stage === 'none') return null;

  return (
    <Surface padding="12px 14px" data-hive-inline={stage}>
      <SectionLabel>Long posts</SectionLabel>
      {deviceBlocked && (
        <Text fontSize="12.5px" fontWeight={600} color={tokens.text} marginBottom="4px">
          {stage === 'locked'
            ? 'Unlock your browser posting key to publish this'
            : 'Your KeepKey can’t fit this post. Publish it with a browser posting key.'}
        </Text>
      )}
      <EnableLongPosts
        account={status?.account}
        stage={stage}
        preview={preview}
        publish={deviceBlocked}
        ping={ping}
        onReady={onEnabled}
        onChanged={refresh}
      />
    </Surface>
  );
}
