import { BTC_SCRIPT_LABELS } from '../../components/header/headerConstants';

/** The account KeepKey Desktop built a UTXO send from, labelled like the
 * extension's own rows ("Native SegWit · Account 2"). Read from Desktop's build
 * summary, never from the request, so a dApp cannot name what is shown.
 * Undefined when Desktop did not say (it predates the field). */
export function builtAccountLabel(summary?: { scriptType?: string; accountIndex?: number }): string | undefined {
  if (typeof summary?.scriptType !== 'string' || typeof summary.accountIndex !== 'number') return undefined;
  return `${BTC_SCRIPT_LABELS[summary.scriptType] || summary.scriptType} · Account ${summary.accountIndex}`;
}
