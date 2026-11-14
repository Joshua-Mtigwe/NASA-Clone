import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from '@/lib/capabilities';
import { cn } from '@/lib/utils';

interface Star {
  x: number;
  y: number;
  r: number;
  phase: number;
  speed: number;
  drift: number;
}

/** Deterministic pseudo-random sequence so the sky is the same on every visit (decoration only). */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function makeStars(count: number): Star[] {
  const rand = seeded(20270301);
  return Array.from({ length: count }, () => ({
    x: rand(),
    y: rand(),
    r: rand() < 0.08 ? 1.4 + rand() * 0.8 : 0.4 + rand() * 0.8,
    phase: rand() * Math.PI * 2,
    speed: 0.4 + rand() * 1.2,
    drift: 0.002 + rand() * 0.006,
  }));
}

/**
 * Decorative animated star field on a canvas. It is hidden from assistive tech,
 * pauses when the tab is hidden, and draws one still frame when reduced motion is
 * requested.
 */
export function Starfield({
  className,
  density = 0.00018,
}: {
  className?: string;
  density?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext?.('2d');
    if (!canvas || !ctx) return;
    const still = prefersReducedMotion();
    let stars: Star[] = [];
    let width = 0;
    let height = 0;
    let frame = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars = makeStars(Math.max(60, Math.round(width * height * density)));
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, width, height);
      for (const s of stars) {
        const twinkle = still ? 0.8 : 0.55 + 0.45 * Math.sin(s.phase + (t / 1000) * s.speed);
        const y = still ? s.y : (s.y + (t / 1000) * s.drift) % 1;
        ctx.globalAlpha = twinkle;
        ctx.fillStyle = s.r > 1.3 ? '#cfe9ff' : '#e6edf7';
        ctx.beginPath();
        ctx.arc(s.x * width, y * height, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const loop = (t: number) => {
      draw(t);
      frame = requestAnimationFrame(loop);
    };

    resize();
    if (still) draw(0);
    else frame = requestAnimationFrame(loop);

    const onVisibility = () => {
      cancelAnimationFrame(frame);
      if (!still && document.visibilityState === 'visible') frame = requestAnimationFrame(loop);
    };
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [density]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 h-full w-full', className)}
    />
  );
}
