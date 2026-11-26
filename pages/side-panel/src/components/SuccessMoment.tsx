/**
 * The success moment (~900 ms) for a broadcast transaction: a gold check drawn
 * in one stroke, a ring that expands and fades, a few thin gold sparks with
 * light gravity, and the network's official logo glowing once. KeepKey gold
 * only; colour comes from the logo. Hand-made (SVG + CSS + a small canvas),
 * no library.
 *
 * Never blocks: pointer-events none, nothing waits on it, unmount cancels it.
 * prefers-reduced-motion: the check alone, already drawn, no ring or sparks.
 */
import { useEffect, useRef, useState } from 'react';
import { networkIdToIcon } from '@extension/shared';
import { tokens } from '../styles/tokens';
import { networkLogo } from '../styles/networkLogos';
import { AssetIcon } from './AssetIcon';

export const SUCCESS_MOMENT_MS = 900;
const SPARK_COLORS = [tokens.accentHi, tokens.accent, '#FFF3D1'];

export type Spark = { x: number; y: number; vx: number; vy: number; len: number; life: number; color: string };

/** A small, deliberate burst: few sparks, upward-biased, varied speed. */
export function makeSparks(count = 14, rand: () => number = Math.random): Spark[] {
  return Array.from({ length: count }, (_, i) => {
    // Spread around the circle, skewed upward so gravity gives a soft arc.
    const angle = -Math.PI / 2 + ((i / count) * 2 - 1) * Math.PI * 0.85 + (rand() - 0.5) * 0.35;
    const speed = 0.09 + rand() * 0.07; // px per ms
    return {
      x: 0,
      y: 0,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      len: 6 + rand() * 7,
      life: 0.65 + rand() * 0.35, // fraction of the moment it stays visible
      color: SPARK_COLORS[i % SPARK_COLORS.length],
    };
  });
}

const GRAVITY = 0.00016; // px per ms²
const DRAG = 0.0024; // per ms

/** Advance one spark by dt ms (pure, for tests). */
export function stepSpark(s: Spark, dt: number): Spark {
  const k = Math.max(0, 1 - DRAG * dt);
  const vx = s.vx * k;
  const vy = s.vy * k + GRAVITY * dt;
  return { ...s, x: s.x + vx * dt, y: s.y + vy * dt, vx, vy };
}

export function usePrefersReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

function Sparks({ size }: { size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext?.('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);
    let sparks = makeSparks();
    let raf = 0;
    let last = 0;
    let start = 0;
    const delay = 140; // sparks leave as the check lands
    const frame = (t: number) => {
      if (!start) start = last = t;
      const elapsed = t - start;
      const dt = Math.min(32, t - last);
      last = t;
      ctx.clearRect(0, 0, size, size);
      if (elapsed >= delay) {
        const p = (elapsed - delay) / (SUCCESS_MOMENT_MS - delay);
        sparks = sparks.map(s => stepSpark(s, dt));
        ctx.lineCap = 'round';
        ctx.lineWidth = 1.4;
        for (const s of sparks) {
          const alpha = Math.max(0, 1 - p / s.life);
          if (alpha <= 0) continue;
          const v = Math.hypot(s.vx, s.vy) || 1;
          const cx = size / 2 + s.x;
          const cy = size / 2 + s.y;
          ctx.globalAlpha = alpha;
          ctx.strokeStyle = s.color;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx - (s.vx / v) * s.len * alpha, cy - (s.vy / v) * s.len * alpha);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      if (elapsed < SUCCESS_MOMENT_MS) raf = requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, size, size);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size]);
  return (
    <canvas
      ref={ref}
      aria-hidden
      data-success-sparks
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: size,
        height: size,
        transform: 'translate(-50%,-50%)',
        pointerEvents: 'none',
      }}
    />
  );
}

export function SuccessMoment({
  networkId,
  size = 88,
  reducedMotion,
}: {
  networkId?: string;
  size?: number;
  /** Override for tests; otherwise follows the OS setting. */
  reducedMotion?: boolean;
}) {
  const osReduced = usePrefersReducedMotion();
  const reduced = reducedMotion ?? osReduced;
  const logo = networkId ? (networkLogo(networkId) ?? networkIdToIcon(networkId.split('/')[0])) : undefined;
  const badge = Math.round(size * 0.36);
  const anim = (name: string) => (reduced ? undefined : name);
  return (
    <div
      role="img"
      aria-label="Transaction sent"
      data-success-moment
      data-motion={reduced ? 'reduced' : 'full'}
      style={{ position: 'relative', width: size, height: size, margin: '0 auto', pointerEvents: 'none' }}>
      {!reduced && <span className="kk-sm-ring" data-success-ring aria-hidden />}
      <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden style={{ position: 'relative' }}>
        <circle cx="32" cy="32" r="29" fill={tokens.accentDim} />
        <circle
          className={anim('kk-sm-circle')}
          cx="32"
          cy="32"
          r="29"
          fill="none"
          stroke={tokens.accent}
          strokeWidth="1.6"
          strokeDasharray="183"
          strokeDashoffset="0"
          transform="rotate(-90 32 32)"
        />
        <path
          className={anim('kk-sm-check')}
          d="M20 33.5 L28.5 42 L45 24.5"
          fill="none"
          stroke={tokens.accentHi}
          strokeWidth="3.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="40"
          strokeDashoffset="0"
        />
      </svg>
      {logo && (
        <span
          className={anim('kk-sm-logo')}
          data-success-logo
          style={{
            position: 'absolute',
            right: -badge * 0.12,
            bottom: -badge * 0.12,
            borderRadius: '50%',
            boxShadow: `0 0 0 3px ${tokens.bg}`,
            lineHeight: 0,
          }}>
          <AssetIcon src={logo} size={badge} />
        </span>
      )}
      {!reduced && <Sparks size={Math.round(size * 2.6)} />}
    </div>
  );
}
