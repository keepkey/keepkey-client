/**
 * agentRequests — bex_request: the agent decides pending requests with TOOLS,
 * not by clicking the approval card.
 *
 * The approval UI is a client of one record per request: the event in
 * requestStorage, which the UI renders and edits (fee choice), then answers
 * with eth_sign_response. The agent is a second client of that same record,
 * with the same gates the UI enforces — so an agent cannot approve something
 * a user's Approve button would refuse.
 *
 * Only options that actually change what gets signed are exposed. Today that
 * is the EVM fee-warning choice (read back by applyFeeChoiceFromStorage). The
 * approval UI's EVM gas selector and UTXO fee-rate selector are NOT exposed:
 * signing never reads what they write, so offering them would repeat the UI's
 * lie. Wire them into signing first, then add them here.
 *
 * Gate: set/approve need the "Allow agent control" setting (default on — it
 * only matters once Agent mode, default off, is enabled). Reject is always
 * allowed: refusing can't move funds. Every signature still needs the device.
 */
import { agentControlStorage, requestStorage } from '@extension/storage';
import { getPendingRequests } from './providerLog';
import { decidePendingApproval } from './methods';
import type { FeeChoice, FeeWarning } from './chains/feeFloors';

const err = (code: string, message: string) => Object.assign(new Error(message), { code });
const HEX_WEI = /^0x[0-9a-fA-F]+$/;

export const REQUEST_TOOL = {
  name: 'bex_request',
  description:
    'Decide a pending wallet request (see bex_pending_requests) without the UI. ' +
    'get: the full request the approval card renders (decoded data, fee warning, nonce info…), the options that change what is signed, and anything blocking approval. ' +
    "set: choose an option — today feeChoice {source: 'dapp'|'suggested'|'custom', maxFeePerGas?, maxPriorityFeePerGas? (hex wei, custom only)} when the request has a fee warning. " +
    'approve / reject: answer the request, with the same gates as the Approve button; signing still needs the KeepKey device button. ' +
    'Omit key when exactly one request is pending.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['get', 'set', 'approve', 'reject'] },
      key: { type: 'string', description: 'Pending request key from bex_pending_requests' },
      feeChoice: {
        type: 'object',
        properties: {
          source: { type: 'string', enum: ['dapp', 'suggested', 'custom'] },
          maxFeePerGas: { type: 'string' },
          maxPriorityFeePerGas: { type: 'string' },
        },
        required: ['source'],
        additionalProperties: false,
      },
    },
    required: ['action'],
    additionalProperties: false,
  },
};

function pendingEntry(key?: string) {
  const all = getPendingRequests();
  if (key) {
    const hit = all.find(p => p.key === key);
    if (!hit) throw err('request_not_found', `no pending request with key ${key}`);
    return hit;
  }
  if (all.length === 1) return all[0];
  if (all.length === 0) throw err('no_pending_request', 'no request is waiting for approval');
  throw err('ambiguous_request', `${all.length} requests are pending — pass key (see bex_pending_requests)`);
}

/** What stands between this request and Approve — mirrors the approval card's own gates. */
function blockers(event: any): string[] {
  const out: string[] = [];
  if (event?.feeWarning && !event?.feeChoice) out.push('fee_choice_required: pick a feeChoice with action=set');
  return out;
}

function options(event: any) {
  const w: FeeWarning | undefined = event?.feeWarning;
  if (!w) return {};
  return {
    feeChoice: {
      reason: w.reason,
      current: event.feeChoice ?? null,
      dapp: { maxFeePerGas: w.dappMaxFeePerGas, maxPriorityFeePerGas: w.dappMaxPriorityFeePerGas },
      suggested: { maxFeePerGas: w.suggestedMaxFeePerGas, maxPriorityFeePerGas: w.suggestedMaxPriorityFeePerGas },
      floor: { maxFeePerGas: w.floorWei, maxPriorityFeePerGas: w.priorityFloorWei },
    },
  };
}

async function requireControl(action: string): Promise<void> {
  if (!(await agentControlStorage.get())) {
    throw err('agent_control_off', `bex_request ${action} needs "Allow agent control" (KeepKey Settings → Agent Mode)`);
  }
}

export async function executeRequestTool(args: any): Promise<any> {
  const entry = pendingEntry(args?.key);
  const event = await requestStorage.getEventById(entry.id);

  switch (args?.action) {
    case 'get':
      return { key: entry.key, origin: entry.origin, event, options: options(event), blockedBy: blockers(event) };

    case 'set': {
      await requireControl('set');
      const c = args?.feeChoice;
      if (!c) throw err('nothing_to_set', 'pass feeChoice');
      if (!event?.feeWarning)
        throw err('option_unavailable', 'this request has no fee warning, so no fee choice applies');
      const next: FeeChoice = { source: c.source };
      if (c.source === 'custom') {
        if (!HEX_WEI.test(c.maxFeePerGas ?? '') || !HEX_WEI.test(c.maxPriorityFeePerGas ?? '')) {
          throw err('invalid_fee', 'custom needs maxFeePerGas and maxPriorityFeePerGas as hex wei');
        }
        if (BigInt(c.maxPriorityFeePerGas) > BigInt(c.maxFeePerGas)) {
          throw err('invalid_fee', 'maxPriorityFeePerGas cannot exceed maxFeePerGas');
        }
        next.customMaxFeePerGas = c.maxFeePerGas;
        next.customMaxPriorityFeePerGas = c.maxPriorityFeePerGas;
      }
      await requestStorage.updateEventById(entry.id, { feeChoice: next });
      return { key: entry.key, feeChoice: next };
    }

    case 'approve': {
      await requireControl('approve');
      const blocked = blockers(event);
      if (blocked.length) throw err('approve_blocked', blocked.join('; '));
      if (!decidePendingApproval(entry.key, true)) {
        throw err('request_gone', 'the request is no longer waiting (answered, timed out, or the worker restarted)');
      }
      return { key: entry.key, approved: true, next: 'confirm on the KeepKey device' };
    }

    case 'reject': {
      const decided = decidePendingApproval(entry.key, false);
      // Same cleanup as the card's Reject: drop the event so the UI dismisses it.
      await requestStorage.removeEventById(entry.id);
      return { key: entry.key, rejected: decided };
    }

    default:
      throw err('unknown_action', `bex_request has no action ${args?.action}`);
  }
}
