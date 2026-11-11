import { describe, it, expect } from 'vitest';
import { pickEvmAddress } from './utils';

const A0 = '0x909Ef6B32DfDc12CA86aA710b54c991af3C5F82E';
const A1 = '0xE64207e139d3a0348bB00651AC408CA9FB5F98DB';
const OTHER_DEVICE = '0x0c4726793c35eB45a91247bc58112A9A0649A214';

describe('pickEvmAddress', () => {
  it('restores the saved account (case-insensitive)', () => {
    expect(pickEvmAddress([A0, A1], A1.toLowerCase())).toBe(A1);
  });
  it("ignores a saved address that isn't on this device", () => {
    expect(pickEvmAddress([A0, A1], OTHER_DEVICE)).toBe(A0);
  });
  it('defaults to account 0, or nothing when there are no EVM pubkeys', () => {
    expect(pickEvmAddress([A0, A1])).toBe(A0);
    expect(pickEvmAddress([], A0)).toBeUndefined();
  });
});
