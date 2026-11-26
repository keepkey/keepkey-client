/**
 * Who signs a Hive request: the KeepKey (always for active/owner) or the
 * browser posting key (posting-only batches, by setting or by choice when the
 * KeepKey cannot fit the transaction). Pure — the decision is unit-tested.
 */
import { CLIENT_POSTING_OPS, type HiveOp } from './hiveTx';
import type { SignWith } from './hiveBrowserKey';

export type HiveSigner = 'keepkey' | 'client';

export function isPostingOnly(ops: HiveOp[]): boolean {
  return (
    ops.length > 0 &&
    ops.every(
      ([name, p]) =>
        CLIENT_POSTING_OPS.has(name) &&
        !(name === 'custom_json' && Array.isArray(p?.required_auths) && p.required_auths.length > 0),
    )
  );
}

export function chooseHiveSigner(input: {
  ops: HiveOp[];
  /** Account setting. */
  mode: SignWith;
  /** A browser key is stored for this account. */
  browserKeyStored: boolean;
  /** The KeepKey would refuse this tx (size, op count, op table…). */
  deviceBlocked: boolean;
  /** What the user picked on the approval card, if anything. */
  choice?: HiveSigner;
}): { signer: HiveSigner } | { error: string } {
  const { ops, mode, browserKeyStored, deviceBlocked, choice } = input;
  const postingOnly = isPostingOnly(ops);
  if (!postingOnly) {
    // Active/owner (or anything not in the browser key's table): KeepKey only.
    if (choice === 'client')
      return { error: 'This request needs the KeepKey — the browser key only signs posting operations' };
    return { signer: 'keepkey' };
  }
  if (choice === 'client' || choice === 'keepkey') {
    if (choice === 'client' && !browserKeyStored) return { error: 'No browser posting key for this account' };
    if (choice === 'keepkey' && deviceBlocked)
      return { error: 'KeepKey cannot sign this transaction — choose the browser key' };
    return { signer: choice };
  }
  if (browserKeyStored && mode === 'client') return { signer: 'client' };
  // Over the device limit the approval card offers the browser key; without an
  // explicit pick (or the "client" setting) it is never used silently.
  if (deviceBlocked) {
    return {
      error: browserKeyStored
        ? 'KeepKey cannot sign this transaction — choose the browser key on the approval card'
        : 'KeepKey cannot sign this transaction and there is no browser posting key',
    };
  }
  return { signer: 'keepkey' };
}
