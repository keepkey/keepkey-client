export function swapTiming(startedAt: number, now: number, estimatedSeconds?: number, completedAt?: number) {
  const elapsed = Math.max(0, Math.floor(((completedAt ?? now) - startedAt) / 1000));
  const duration = (seconds: number) =>
    `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const estimate =
    Number.isFinite(estimatedSeconds) && estimatedSeconds! > 0 ? Math.ceil(estimatedSeconds!) : undefined;
  return {
    elapsed: duration(elapsed),
    estimate: estimate === undefined ? undefined : duration(estimate),
    overdue: !completedAt && estimate !== undefined && elapsed > estimate,
  };
}
