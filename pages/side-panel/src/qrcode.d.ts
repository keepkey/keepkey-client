// Minimal ambient typing for `qrcode` (no @types/qrcode installed). Covers
// the `toDataURL` overloads used in components/Receive.tsx.
declare module 'qrcode' {
  interface QRCodeToDataURLOptions {
    margin?: number;
    width?: number;
    color?: { dark?: string; light?: string };
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
  }

  function toDataURL(text: string, options?: QRCodeToDataURLOptions): Promise<string>;
  function toDataURL(
    text: string,
    options: QRCodeToDataURLOptions,
    callback: (error: Error | null | undefined, url: string) => void,
  ): void;
  function toDataURL(text: string, callback: (error: Error | null | undefined, url: string) => void): void;

  const _default: { toDataURL: typeof toDataURL };
  export default _default;
}
