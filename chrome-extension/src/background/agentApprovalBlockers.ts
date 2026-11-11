/** Agent decisions must honor every native approval gate. Dangerous SIWE needs the native warning acknowledgment. */
export function agentApprovalBlockers(event: any): string[] {
  const out: string[] = [];
  if (event?.feeWarning && !event?.feeChoice) out.push('fee_choice_required: pick a feeChoice with action=set');
  if (event?.clearSignReport?.protectionLevel === 'P0') out.push('vault_blocked: Vault blocked this transaction');
  if (event?.siwe?.warnings?.some((w: any) => w.level === 'danger'))
    out.push('native_warning_required: review and acknowledge the sign-in warning in KeepKey');
  return out;
}
