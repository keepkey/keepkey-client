// Deterministic monogram color for assets/networks that don't carry an icon.
// Shared by <AssetIcon> and the swap TokenGlyph so both draw from one palette.
const PALETTE = ['#f7931a', '#8a92b2', '#9945ff', '#23dcc8', '#2775ca', '#6f7390', '#c2a633', '#e84142', '#16c784'];

export const colorForSymbol = (sym: string): string => {
  let h = 0;
  for (let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
};
