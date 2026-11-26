/** Sites allowed to read the Hive account name (Keychain requestAccount); revocable. */
import { useCallback, useEffect, useState } from 'react';
import { Button, Flex, Text } from '@chakra-ui/react';
import { tokens, fonts } from '../styles/tokens';
import { Muted, SectionLabel, Surface } from '../approval/ui';

type Grant = { origin: string; account: string; grantedAt: string };

const send = (action: string, extra: Record<string, unknown> = {}): Promise<any> =>
  new Promise(resolve =>
    chrome.runtime.sendMessage({ type: 'HIVE_CONNECTED_SITES', action, ...extra }, r =>
      resolve(chrome.runtime.lastError ? { ok: false } : (r ?? { ok: false })),
    ),
  );

export function HiveConnectedSites() {
  const [sites, setSites] = useState<Grant[] | null>(null);
  const load = useCallback(async (action = 'list', extra: Record<string, unknown> = {}) => {
    const r = await send(action, extra);
    setSites(r?.ok ? r.sites : []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  if (!sites || sites.length === 0) return null;
  return (
    <Surface marginTop="12px" data-hive-connected-sites>
      <SectionLabel>Sites that can see your Hive account</SectionLabel>
      <Muted>They can read the account name only. Signing always asks.</Muted>
      {sites.map(s => (
        <Flex
          key={s.origin}
          justifyContent="space-between"
          alignItems="center"
          padding="8px 0"
          borderBottom={`1px solid ${tokens.line}`}>
          <Text fontFamily={fonts.mono} fontSize="12px" color={tokens.text} wordBreak="break-all">
            {s.origin.replace(/^https?:\/\//, '')} · @{s.account}
          </Text>
          <Button
            size="xs"
            variant="keycapSecondary"
            onClick={() => load('revoke', { origin: s.origin })}
            data-hive-revoke-site={s.origin}>
            Revoke
          </Button>
        </Flex>
      ))}
    </Surface>
  );
}

export default HiveConnectedSites;
