/**
 * The Hive clear-sign op table and its approval-card summaries.
 *
 * A leaf module on purpose: hiveHandler.ts imports @extension/storage, which
 * touches chrome.* at import time and so cannot load under vitest. Keeping the
 * table and the pure formatter here is what lets hiveOpSummary.test.ts import
 * them at all.
 */

// Firmware clear-sign op table — phase 1 + phase 2
// (handoff-hive-sign-operations-phase2.md). The vault serializer and the
// firmware both re-enforce this; the check here just fails fast with a
// clear dApp-facing error.
export const SUPPORTED_OPS = new Set([
  'vote',
  'comment',
  'custom_json',
  'transfer_to_vesting',
  'withdraw_vesting',
  'convert',
  'comment_options',
  'transfer_to_savings',
  'transfer_from_savings',
  'claim_reward_balance',
  'delegate_vesting_shares',
  'account_update2',
  'limit_order_create',
  'limit_order_cancel',
]);

/** Hive's own defaults for comment_options — anything else is worth showing. */
const DEFAULT_MAX_PAYOUT = '1000000.000 HBD';
const DEFAULT_PERCENT_HBD = 10000;

/**
 * Cap a value for one-line display, always marking the cut.
 *
 * Silent truncation renders two different payloads sharing a 120-char prefix
 * as the same string, so the marker carries the dropped length. The full value
 * is in the Raw tab (hiveHandler stashes `params` verbatim) — this is the
 * one-line view, not the record.
 */
function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}… (+${s.length - max} more chars)`;
}

/**
 * The exact JSON the vault will serialize — mirrors hive-ops.ts:151.
 *
 * A dApp may pass `json` as an object; `String(obj)` yields "[object Object]"
 * while the object's actual contents are what gets signed. The approval must
 * show the signed bytes, not a placeholder for them.
 */
function serializedJson(json: any): string {
  return typeof json === 'string' ? json : JSON.stringify(json ?? {});
}

/** One-line device-preview summary per op for the side-panel approval. */
export function opSummary(name: string, p: Record<string, any>): string {
  switch (name) {
    case 'vote':
      return `@${p.voter} → @${p.author}/${p.permlink} (${(Number(p.weight) / 100).toFixed(0)}%)`;
    case 'comment':
      return `@${p.author}: ${p.title || p.permlink}`;
    case 'custom_json':
      return `${p.id}: ${truncate(serializedJson(p.json), 120)}`;
    case 'transfer_to_vesting':
      return `Power up ${p.amount} → @${p.to}`;
    case 'withdraw_vesting':
      return String(p.vesting_shares).startsWith('0.000000')
        ? `Stop power down (@${p.account})`
        : `Power down ${p.vesting_shares} from @${p.account}`;
    case 'convert':
      return `Convert ${p.amount} → HIVE (request ${p.requestid})`;
    case 'comment_options': {
      // Every payout control the device screen shows, whenever it differs from
      // the Hive default. Showing only the post + beneficiaries made two
      // comment_options with materially different payout behaviour — capped
      // payout, all-HIVE split, votes or curation disabled — render
      // identically in the browser.
      const percentHbd = Number(p.percent_hbd ?? p.percent_steem_dollars);
      const controls: string[] = [];
      if (p.max_accepted_payout != null && p.max_accepted_payout !== DEFAULT_MAX_PAYOUT) {
        controls.push(`max payout ${p.max_accepted_payout}`);
      }
      if (Number.isFinite(percentHbd) && percentHbd !== DEFAULT_PERCENT_HBD) {
        controls.push(`${(percentHbd / 100).toFixed(1)}% HBD`);
      }
      if (p.allow_votes === false) controls.push('votes disabled');
      if (p.allow_curation_rewards === false) controls.push('curation rewards disabled');
      const beneficiaries = (p.extensions?.[0]?.[1]?.beneficiaries ?? [])
        .map((b: any) => ` · ${(Number(b.weight) / 100).toFixed(1)}% → @${b.account}`)
        .join('');
      return `Payout options for @${p.author}/${p.permlink}${
        controls.length ? ` · ${controls.join(' · ')}` : ''
      }${beneficiaries}`;
    }
    case 'transfer_to_savings':
      return `Savings deposit ${p.amount} → @${p.to}`;
    case 'transfer_from_savings':
      return `Savings withdraw ${p.amount} → @${p.to}`;
    case 'claim_reward_balance':
      return `Claim ${p.reward_hive}, ${p.reward_hbd}, ${p.reward_vests}`;
    case 'delegate_vesting_shares':
      return String(p.vesting_shares).startsWith('0.000000')
        ? `Remove delegation from @${p.delegatee}`
        : `Delegate ${p.vesting_shares} → @${p.delegatee}`;
    case 'account_update2':
      return `Update profile @${p.account}`;
    case 'limit_order_create':
      return `Sell ${p.amount_to_sell} for ${p.min_to_receive}${p.fill_or_kill ? ' (fill or kill)' : ''}`;
    case 'limit_order_cancel':
      return `Cancel order ${p.orderid} (@${p.owner})`;
    default:
      return name;
  }
}
