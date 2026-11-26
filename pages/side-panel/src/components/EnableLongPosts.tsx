/**
 * One button: "Enable long posts for @account". Shown on the approval card of
 * a post the KeepKey cannot fit, and on the Hive screen. Progress in steps;
 * importing an existing key is the secondary path.
 */
import { useState } from 'react';
import { Box, Button, Checkbox, Flex, Text } from '@chakra-ui/react';
import { tokens } from '../styles/tokens';
import { Muted, ToneDot, type Tone } from '../approval/ui';
import { ImportKeyForm, sendBrowserKey, type BrowserKeyPreview, type BrowserKeyStage } from './hiveBrowserKeyUi';
import { enableLongPosts, FIRMWARE_BLOCKED_MESSAGE, type EnableStep, type StepStatus } from './longPostsFlow';

export const LONG_POSTS_TRADEOFF =
  'A posting key is created in this browser and protected by your KeepKey. It can post, vote and comment — never move funds. Anyone using this browser while it is unlocked could post as you. Owner and active stay on the KeepKey; the KeepKey stops signing posts for this account.';

export type FlowStep = EnableStep | 'publish';
const LABELS: Record<FlowStep, string> = {
  check: 'Checking the account',
  generate: 'Generating a posting key in the browser',
  authorize: 'Approve in KeepKey Vault, then press the button on your KeepKey',
  confirm: 'Confirming on the Hive chain',
  unlock: 'Unlocking the browser key (press the KeepKey button)',
  publish: 'Publishing your post',
};
const tone = (s: StepStatus): Tone =>
  s === 'done' ? 'good' : s === 'failed' ? 'bad' : s === 'active' ? 'warn' : 'neutral';

export type EnableLongPostsViewProps = {
  account?: string;
  stage: BrowserKeyStage;
  preview: BrowserKeyPreview | null;
  steps: Partial<Record<FlowStep, StepStatus>>;
  running: boolean;
  error: string | null;
  allowDropApps: boolean;
  publish: boolean;
  importing: boolean;
  importBusy: boolean;
  onToggleApps: (v: boolean) => void;
  onEnable: () => void;
  onShowImport: () => void;
  onImport: (wif: string) => void;
  onCancelImport: () => void;
};

/** Pure view (render-tested). */
export function EnableLongPostsView(p: EnableLongPostsViewProps) {
  const order: FlowStep[] = [
    'generate',
    'authorize',
    'confirm',
    ...(p.stage === 'locked' ? (['unlock'] as FlowStep[]) : []),
    ...(p.publish ? (['publish'] as FlowStep[]) : []),
  ];
  const started = Object.keys(p.steps).length > 0;
  const label = p.stage === 'locked' ? 'Unlock with KeepKey' : `Enable long posts for @${p.account ?? 'this account'}`;
  const apps = p.preview?.droppedApps ?? [];
  const blockedByActive = p.preview?.ok && !p.preview.activeIsKeepKey && p.stage !== 'locked';
  // Firmware cannot authorize an external key: say so before anything is created.
  const blockedByFirmware = p.preview?.ok && p.preview.dedicateSupported === false && p.stage !== 'locked';
  return (
    <Box data-enable-long-posts={p.stage}>
      {p.stage !== 'locked' && <Muted>{LONG_POSTS_TRADEOFF}</Muted>}
      {apps.length > 0 && p.stage !== 'locked' && (
        <Box paddingTop="8px">
          <Text fontSize="12px" color={tokens.bad} fontWeight={600}>
            These apps lose posting access: {apps.join(', ')}
          </Text>
          <Checkbox
            size="sm"
            isChecked={p.allowDropApps}
            onChange={e => p.onToggleApps(e.target.checked)}
            marginTop="6px">
            <Text fontSize="12px">Remove their access</Text>
          </Checkbox>
        </Box>
      )}
      {blockedByFirmware && (
        <Box marginTop="8px" data-enable-blocked="firmware">
          <Text fontSize="12px" color={tokens.bad} fontWeight={600}>
            {FIRMWARE_BLOCKED_MESSAGE}
          </Text>
          <Muted marginTop="4px">
            Accounts created or brought in KeepKey Vault can include a KeepKey Client posting key from the start; those
            work today.
          </Muted>
        </Box>
      )}
      {!blockedByFirmware && blockedByActive && (
        <Text fontSize="12px" color={tokens.bad} marginTop="8px">
          This account's active key is not only this KeepKey, so the KeepKey can't authorize a browser key for it.
        </Text>
      )}
      <Button
        size="sm"
        variant="solid"
        marginTop="10px"
        width="100%"
        isLoading={p.running}
        loadingText={label}
        isDisabled={
          p.running ||
          !!blockedByFirmware ||
          !!blockedByActive ||
          (apps.length > 0 && p.stage !== 'locked' && !p.allowDropApps)
        }
        onClick={p.onEnable}
        data-action="enable-long-posts">
        {label}
      </Button>
      {started && (
        <Box marginTop="10px" data-enable-steps>
          {order.map(step => {
            const s = p.steps[step] ?? 'pending';
            if (s === 'skipped') return null;
            return (
              <Flex key={step} gap="8px" alignItems="baseline" padding="3px 0" data-step={step} data-step-status={s}>
                <Box transform="translateY(-1px)">
                  <ToneDot tone={tone(s)} size={7} />
                </Box>
                <Text fontSize="12px" color={s === 'pending' ? tokens.faint : tokens.text}>
                  {LABELS[step]}
                </Text>
              </Flex>
            );
          })}
        </Box>
      )}
      {p.error && (
        <Text fontSize="12px" color={tokens.bad} marginTop="8px" data-enable-error>
          {p.error}
        </Text>
      )}
      {p.stage !== 'locked' && (
        <Box marginTop="10px">
          {p.importing ? (
            <ImportKeyForm account={p.account} busy={p.importBusy} onImport={p.onImport} onCancel={p.onCancelImport} />
          ) : (
            <Text
              as="button"
              fontSize="11.5px"
              color={tokens.dim}
              textDecoration="underline"
              onClick={p.onShowImport}
              data-action="show-import">
              I already have an authorized posting key
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}

/**
 * Container. `onReady` runs once the key can sign (the approval card then
 * publishes the pending post with it, without another click).
 */
export function EnableLongPosts({
  account,
  stage,
  preview,
  publish,
  ping,
  onReady,
  onChanged,
}: {
  account?: string;
  stage: BrowserKeyStage;
  preview: BrowserKeyPreview | null;
  publish: boolean;
  ping?: () => void;
  onReady?: () => void;
  onChanged: () => void;
}) {
  const [steps, setSteps] = useState<Partial<Record<FlowStep, StepStatus>>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allowDropApps, setAllowDropApps] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importBusy, setImportBusy] = useState(false);

  const run = async () => {
    setRunning(true);
    setError(null);
    setSteps({});
    const result = await enableLongPosts(sendBrowserKey, {
      allowDropApps,
      ping,
      onStep: (step, status) => setSteps(s => ({ ...s, [step]: status })),
    });
    setRunning(false);
    onChanged();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (publish) {
      setSteps(s => ({ ...s, publish: 'active' }));
      onReady?.();
    }
  };

  return (
    <EnableLongPostsView
      account={account}
      stage={stage}
      preview={preview}
      steps={steps}
      running={running}
      error={error}
      allowDropApps={allowDropApps}
      publish={publish}
      importing={importing}
      importBusy={importBusy}
      onToggleApps={setAllowDropApps}
      onEnable={run}
      onShowImport={() => setImporting(true)}
      onCancelImport={() => setImporting(false)}
      onImport={async wif => {
        ping?.();
        setImportBusy(true);
        const r = await sendBrowserKey('import', { wif });
        setImportBusy(false);
        setImporting(false);
        setError(
          !r.ok
            ? r.error
            : r.needsAuthorization
              ? `${r.reason} Use “Enable long posts” to authorize a new key instead.`
              : null,
        );
        onChanged();
      }}
    />
  );
}
