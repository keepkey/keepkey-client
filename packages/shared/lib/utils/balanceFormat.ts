/**
 * Display formatters for balance rows. Pure (no DOM, no chrome.*) so they are
 * unit-testable and shared by the side panel.
 */

const toNumber = (value: unknown): number => {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : 0;
};

const fixed = (n: number, digits: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/**
 * Native quantity for a balance row: rounded (never truncated) to 4 decimals,
 * widening to 6 when 4 would read as zero, and "<0.000001" for dust below
 * that. Accepts numbers or numeric strings, including exponent notation
 * ("5e-7"); never returns exponent notation itself. Thousands are grouped.
 */
export function formatQuantity(value: unknown): string {
  const n = toNumber(value);
  if (n === 0) return '0';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (Number(abs.toFixed(4)) > 0) return sign + fixed(abs, 4);
  if (Number(abs.toFixed(6)) > 0) return sign + fixed(abs, 6);
  return `${sign}<0.000001`;
}

/** USD amount with en-US thousands separators and 2 decimals, e.g. "3,071.29". No "$". */
export function formatUsdAmount(value: unknown): string {
  return fixed(toNumber(value), 2);
}
