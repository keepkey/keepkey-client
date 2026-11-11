import { describe, expect, it } from 'vitest';
import { deviceReadout } from '../../../pages/side-panel/src/components/v2/DeviceReadout';

describe('device and API status labels', () => {
  it('keeps a cached wallet usable while its KeepKey is locked', () => {
    expect(deviceReadout(5, undefined, true)).toMatchObject({ label: 'LOCKED', ready: true, pulsing: false });
  });
  it('shows an online Vault when wallet data has not yet been loaded', () => {
    expect(deviceReadout(6)).toMatchObject({ label: 'VAULT ONLINE', ready: false, pulsing: false });
    expect(deviceReadout(6, undefined, true)).toMatchObject({ label: 'LOCKED', ready: false });
  });
  it('reserves the offline label for an unavailable API', () => {
    expect(deviceReadout(4)).toMatchObject({ label: 'OFFLINE', ready: false });
  });
});
