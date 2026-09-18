// Header device readout (KEEPKEY_STYLE.md §0).
//
// v2 retires the gradient shield button. Device state is now a readout: an 8px
// LED plus a mono label, sitting flush in the 56px header. The LED is the only
// element in the panel that changes hue with state — dim when there is nothing
// attached, a gold pulse while the transport is working, a green glow once the
// device is paired and usable.
//
// The readout must never lie (§9): it reflects the real transport status the
// background reports and nothing else.
import React from 'react';
import { Box, Button, Text } from '@chakra-ui/react';
import { tokens, fonts } from '../../styles/tokens';

/** Background connection states (see CLAUDE.md "State Management"). */
export const KeepKeyState = {
  Unknown: 0,
  Disconnected: 1,
  Connected: 2,
  Busy: 3,
  Errored: 4,
  Paired: 5,
} as const;

export interface DeviceReadoutModel {
  label: string;
  color: string;
  glow: string;
  /** Gold pulse while the transport is mid-handshake. */
  pulsing: boolean;
  title: string;
  /** True once the device is paired and an address is available. */
  ready: boolean;
}

/**
 * Maps the background's numeric state onto the readout.
 *
 * `Connected` (2) is deliberately *not* green: the device is on the wire but
 * not yet paired, so no address exists and nothing can be signed. Showing green
 * there would promise more than the transport can deliver.
 *
 * `Errored` (4) is set for three different causes: the KeepKey Vault's local
 * endpoint doesn't answer, the Vault is up but there is no device and no cached
 * pubkeys, or wallet init failed (e.g. the Vault rejected our pairing). The
 * state alone can't tell them apart, so the readout names none of them as fact
 * and the hint covers all three.
 */
export function deviceReadout(state: number | null, deviceLabel?: string): DeviceReadoutModel {
  // The design shows a real device id ("KK-2A91 · ONLINE"). Until the
  // background reports one, prefixing every state with a constant "KEEPKEY ·"
  // adds width without adding information — and in a 400px header that width
  // is exactly what the readout is short of. Fall back to the bare state word.
  const id = deviceLabel?.trim();
  const tag = (word: string) => (id ? `${id} · ${word}` : word);
  const device = id ? `${id}` : 'Your KeepKey';
  const gold = { color: tokens.accent, glow: 'none', pulsing: true };
  const dim = { color: tokens.line3, glow: 'none', pulsing: false };

  switch (state) {
    case KeepKeyState.Paired:
      return {
        label: tag('ONLINE'),
        color: tokens.good,
        glow: '0 0 10px rgba(61,190,107,.6)',
        pulsing: false,
        title: `${device} is connected and paired`,
        ready: true,
      };
    case KeepKeyState.Busy:
      return { ...gold, label: tag('BUSY'), title: 'Device is working — check the KeepKey screen', ready: false };
    case KeepKeyState.Connected:
      return { ...gold, label: tag('PAIRING'), title: 'Device found — pairing', ready: false };
    case KeepKeyState.Errored:
      return {
        label: 'OFFLINE',
        color: tokens.bad,
        glow: 'none',
        pulsing: false,
        title: 'KeepKey unavailable — check the KeepKey Vault app is running and your device is plugged in and paired',
        ready: false,
      };
    case KeepKeyState.Disconnected:
      return { ...dim, label: 'NO DEVICE', title: 'No KeepKey connected', ready: false };
    default:
      return { ...gold, label: 'CONNECTING', title: 'Looking for your KeepKey', ready: false };
  }
}

interface DeviceReadoutProps {
  state: number | null;
  deviceLabel?: string;
  onClick?: () => void;
}

export const DeviceReadout = ({ state, deviceLabel, onClick }: DeviceReadoutProps) => {
  const m = deviceReadout(state, deviceLabel);

  return (
    <Button
      onClick={onClick}
      title={m.title}
      aria-label="Home"
      variant="unstyled"
      display="flex"
      alignItems="center"
      gap="10px"
      height="36px"
      minWidth={0}
      paddingRight="8px"
      color={tokens.dim}
      _hover={{ color: tokens.text }}>
      <Box
        as="span"
        width="8px"
        height="8px"
        borderRadius="50%"
        flex="none"
        background={m.color}
        boxShadow={m.glow}
        animation={m.pulsing ? 'kk-led 1.4s ease-out infinite' : undefined}
        transition="background .3s ease"
      />
      <Text
        as="span"
        fontFamily={fonts.mono}
        fontSize="11px"
        letterSpacing="0.12em"
        whiteSpace="nowrap"
        overflow="hidden"
        textOverflow="ellipsis">
        {m.label}
      </Text>
    </Button>
  );
};

export default DeviceReadout;
