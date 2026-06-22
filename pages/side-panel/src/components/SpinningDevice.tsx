// 360° spinning KeepKey — a 6-face CSS-3D box (no Three.js, no WebGL, no deps).
// Ported from keepkey-vault-v11's SpinningDevice and parameterized by `scale`
// so it fits the narrow side panel. The front OLED face is a slot: pass a
// contextual `screen` (or a short `label`) so the same shell reads as
// "fetching balances", "confirm on your KeepKey", "confirm swap", etc.
import React, { type CSSProperties, type ReactNode } from 'react';

export interface SpinningDeviceProps {
  /** Scales the whole device. 1 ≈ 380px long axis (vault hero). Default 0.36
   *  (~137px) for the side panel. */
  scale?: number;
  /** Seconds per full revolution. Default 12. */
  durationSeconds?: number;
  /** Pause the spin (e.g. on hover). */
  paused?: boolean;
  /** Full custom OLED content. Overrides `label`. */
  screen?: ReactNode;
  /** Convenience: a short uppercase label rendered centered on the OLED. */
  label?: string;
  /** Show the etched "keepkey" wordmark on the back face. Default true. */
  showWordmark?: boolean;
  /** Container style passthrough (margin, width override, etc.). */
  style?: CSSProperties;
}

const FONT_OLED = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

const MATTE_ALU = 'linear-gradient(180deg, #6a6a70 0%, #57575c 35%, #46464a 65%, #38383c 100%)';
const ALU_SPARKLE =
  'radial-gradient(ellipse at 30% 35%, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 55%), radial-gradient(ellipse at 75% 70%, rgba(120,140,170,0.06) 0%, rgba(0,0,0,0) 60%)';
const ALU_GRAIN =
  'repeating-linear-gradient(92deg, rgba(255,255,255,0.022) 0px, rgba(255,255,255,0.022) 1px, rgba(0,0,0,0.03) 1px, rgba(0,0,0,0.03) 2px)';
const GLOSS_BLACK = 'linear-gradient(180deg, #16161a 0%, #0a0a0c 40%, #050507 100%)';
const GLOSS_HIGHLIGHT =
  'linear-gradient(120deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0) 28%, rgba(255,255,255,0) 72%, rgba(255,255,255,0.06) 100%)';

// Shell split: glossy black half (~56%) + anodized aluminum half on the edges.
const SHELL_BLACK = 0.56;

function Face({
  w,
  h,
  transform,
  children,
  style,
}: {
  w: number;
  h: number;
  transform: string;
  children?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: w,
        height: h,
        marginLeft: -w / 2,
        marginTop: -h / 2,
        transform,
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
        boxSizing: 'border-box',
        ...style,
      }}>
      {children}
    </div>
  );
}

export function SpinningDevice({
  scale = 0.36,
  durationSeconds = 12,
  paused = false,
  screen,
  label,
  showWordmark = true,
  style,
}: SpinningDeviceProps) {
  // Real KeepKey is ~93×38×12mm. Base pixel scale matches the vault hero (L=380).
  const L = 380 * scale; // long axis
  const W = 158 * scale; // short axis
  const D = 44 * scale; // thickness
  const persp = 2400 * scale;
  const containerW = L * 1.6; // enough horizontal room for the spin + floor shadow

  const oledContent =
    screen ??
    (label ? (
      <div
        style={{
          width: '100%',
          textAlign: 'center',
          fontSize: 13 * scale * 1.6,
          fontWeight: 600,
          letterSpacing: 2 * scale * 1.6,
          opacity: 0.82,
        }}>
        {label}
      </div>
    ) : null);

  return (
    <div
      style={{
        width: containerW,
        aspectRatio: '800 / 420',
        perspective: persp,
        perspectiveOrigin: '50% 42%',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...style,
      }}>
      {/* Stationary floor shadow */}
      <div
        style={{
          position: 'absolute',
          bottom: '14%',
          left: '50%',
          width: L * 0.88,
          height: 30 * scale,
          marginLeft: -(L * 0.88) / 2,
          background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0) 65%)',
          filter: `blur(${7 * scale}px)`,
          pointerEvents: 'none',
        }}
      />

      {/* 3D box stage */}
      <div
        style={{
          position: 'relative',
          width: L,
          height: W,
          transformStyle: 'preserve-3d',
          animation: `kkSpin360 ${durationSeconds}s linear infinite`,
          animationPlayState: paused ? 'paused' : 'running',
          willChange: 'transform',
        }}>
        {/* FRONT — glossy black OLED with caller-provided screen content */}
        <Face w={L} h={W} transform={`translateZ(${D / 2}px)`}>
          <div
            style={{
              width: '100%',
              height: '100%',
              background: GLOSS_BLACK,
              borderRadius: 3,
              boxShadow:
                'inset 0 1px 0 rgba(255,255,255,0.10), inset 0 -1px 0 rgba(0,0,0,0.7), 0 0 0 1px rgba(0,0,0,0.6)',
              position: 'relative',
              overflow: 'hidden',
              color: '#e8e6dc',
              fontFamily: FONT_OLED,
              padding: `${14 * scale}px ${22 * scale}px`,
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'center',
            }}>
            {/* OLED pixel grid */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background:
                  'repeating-linear-gradient(0deg, rgba(232,230,220,0.035) 0px, rgba(232,230,220,0.035) 1px, transparent 1px, transparent 2px)',
                pointerEvents: 'none',
              }}
            />
            {/* Diagonal gloss sweep */}
            <div style={{ position: 'absolute', inset: 0, background: GLOSS_HIGHLIGHT, pointerEvents: 'none' }} />
            {/* Specular highlight blob */}
            <div
              style={{
                position: 'absolute',
                left: '-8%',
                top: '-30%',
                width: '55%',
                height: '90%',
                background: 'radial-gradient(ellipse at center, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0) 60%)',
                pointerEvents: 'none',
              }}
            />
            <div style={{ position: 'relative', width: '100%' }}>{oledContent}</div>
          </div>
        </Face>

        {/* BACK — matte anodized aluminum + etched wordmark */}
        <Face w={L} h={W} transform={`translateZ(${-D / 2}px) rotateY(180deg)`}>
          <div
            style={{
              width: '100%',
              height: '100%',
              background: MATTE_ALU,
              borderRadius: 3,
              position: 'relative',
              overflow: 'hidden',
              boxShadow:
                'inset 0 1px 0 rgba(255,255,255,0.18), inset 0 -1px 0 rgba(0,0,0,0.4), 0 0 0 1px rgba(0,0,0,0.5)',
            }}>
            <div style={{ position: 'absolute', inset: 0, background: ALU_SPARKLE, pointerEvents: 'none' }} />
            <div
              style={{ position: 'absolute', inset: 0, background: ALU_GRAIN, opacity: 0.55, pointerEvents: 'none' }}
            />
            {showWordmark && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
                  fontWeight: 600,
                  fontSize: L * 0.1,
                  letterSpacing: -L * 0.004,
                  color: 'rgba(0,0,0,0.42)',
                  textShadow: '0 1px 0 rgba(255,255,255,0.18)',
                }}>
                keepkey
              </div>
            )}
          </div>
        </Face>

        {/* TOP edge — glossy/aluminum split + confirm button bump */}
        <Face w={L} h={D} transform={`rotateX(90deg) translateZ(${W / 2}px)`}>
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              borderRadius: 2,
              overflow: 'hidden',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), 0 0 0 1px rgba(0,0,0,0.5)',
              position: 'relative',
            }}>
            <div style={{ width: `${SHELL_BLACK * 100}%`, height: '100%', background: GLOSS_BLACK }} />
            <div
              style={{
                width: `${(1 - SHELL_BLACK) * 100}%`,
                height: '100%',
                background: MATTE_ALU,
                position: 'relative',
              }}>
              <div style={{ position: 'absolute', inset: 0, background: ALU_GRAIN, opacity: 0.6 }} />
            </div>
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${SHELL_BLACK * 100}%`,
                width: 1,
                background: 'rgba(0,0,0,0.7)',
              }}
            />
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '72%',
                transform: 'translateY(-50%)',
                width: L * 0.074,
                height: D * 0.55,
                borderRadius: 2,
                background: 'linear-gradient(180deg, #4a4a4e 0%, #2a2a2c 100%)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18)',
              }}
            />
          </div>
        </Face>

        {/* BOTTOM edge — same split + USB-C cutout */}
        <Face w={L} h={D} transform={`rotateX(-90deg) translateZ(${W / 2}px)`}>
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              borderRadius: 2,
              overflow: 'hidden',
              boxShadow: 'inset 0 -1px 0 rgba(255,255,255,0.06), 0 0 0 1px rgba(0,0,0,0.5)',
              position: 'relative',
            }}>
            <div style={{ width: `${SHELL_BLACK * 100}%`, height: '100%', background: GLOSS_BLACK }} />
            <div
              style={{
                width: `${(1 - SHELL_BLACK) * 100}%`,
                height: '100%',
                background: MATTE_ALU,
                position: 'relative',
              }}>
              <div style={{ position: 'absolute', inset: 0, background: ALU_GRAIN, opacity: 0.6 }} />
            </div>
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${SHELL_BLACK * 100}%`,
                width: 1,
                background: 'rgba(0,0,0,0.7)',
              }}
            />
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '10%',
                transform: 'translateY(-50%)',
                width: L * 0.084,
                height: D * 0.45,
                borderRadius: 4,
                background: '#050507',
                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(255,255,255,0.05)',
              }}
            />
          </div>
        </Face>

        {/* LEFT short end */}
        <Face w={D} h={W} transform={`rotateY(-90deg) translateZ(${L / 2}px)`}>
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              borderRadius: 2,
              overflow: 'hidden',
              boxShadow: 'inset 1px 0 0 rgba(255,255,255,0.06), 0 0 0 1px rgba(0,0,0,0.5)',
              position: 'relative',
            }}>
            <div style={{ width: '100%', height: `${SHELL_BLACK * 100}%`, background: GLOSS_BLACK }} />
            <div
              style={{
                width: '100%',
                height: `${(1 - SHELL_BLACK) * 100}%`,
                background: MATTE_ALU,
                position: 'relative',
              }}>
              <div style={{ position: 'absolute', inset: 0, background: ALU_GRAIN, opacity: 0.6 }} />
            </div>
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: `${SHELL_BLACK * 100}%`,
                height: 1,
                background: 'rgba(0,0,0,0.7)',
              }}
            />
          </div>
        </Face>

        {/* RIGHT short end */}
        <Face w={D} h={W} transform={`rotateY(90deg) translateZ(${L / 2}px)`}>
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              borderRadius: 2,
              overflow: 'hidden',
              boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.06), 0 0 0 1px rgba(0,0,0,0.5)',
              position: 'relative',
            }}>
            <div style={{ width: '100%', height: `${SHELL_BLACK * 100}%`, background: GLOSS_BLACK }} />
            <div
              style={{
                width: '100%',
                height: `${(1 - SHELL_BLACK) * 100}%`,
                background: MATTE_ALU,
                position: 'relative',
              }}>
              <div style={{ position: 'absolute', inset: 0, background: ALU_GRAIN, opacity: 0.6 }} />
            </div>
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: `${SHELL_BLACK * 100}%`,
                height: 1,
                background: 'rgba(0,0,0,0.7)',
              }}
            />
          </div>
        </Face>
      </div>

      <style>{`@keyframes kkSpin360 { from { transform: rotateY(0deg); } to { transform: rotateY(360deg); } }`}</style>
    </div>
  );
}

export default SpinningDevice;
