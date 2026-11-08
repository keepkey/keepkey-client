import { expect, it } from 'vitest';
import { agentApprovalBlockers } from './agentApprovalBlockers';
it('cannot bypass native ClearSign or SIWE warnings through agent approval', () => {
  expect(agentApprovalBlockers({ clearSignReport: { protectionLevel: 'P0' } })[0]).toContain('vault_blocked');
  expect(agentApprovalBlockers({ siwe: { warnings: [{ level: 'danger' }] } })[0]).toContain('native_warning_required');
  expect(agentApprovalBlockers({ feeWarning: {} })[0]).toContain('fee_choice_required');
});
it('allows requests whose native approval gates are satisfied', () => {
  expect(
    agentApprovalBlockers({
      clearSignReport: { protectionLevel: 'P2' },
      siwe: { warnings: [{ level: 'warning' }] },
      feeWarning: {},
      feeChoice: { source: 'suggested' },
    }),
  ).toEqual([]);
});
