declare module 'canvas-confetti' {
  export interface ConfettiOptions {
    particleCount?: number;
    spread?: number;
    origin?: { x?: number; y?: number };
    colors?: string[];
    disableForReducedMotion?: boolean;
    zIndex?: number;
  }

  export default function confetti(options?: ConfettiOptions): Promise<unknown> | null;
}
