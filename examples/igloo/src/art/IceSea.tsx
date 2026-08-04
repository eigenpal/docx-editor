// The sea the editor floats on: drifting ice floes on a canvas behind everything.
//
// A canvas rather than DOM nodes because the floes are pure decoration that must never
// enter the accessibility tree, take a hit test, or invalidate layout — one element, one
// paint per frame, `aria-hidden`, `pointer-events: none`.
//
// It does not scroll with the document. The page is a thing floating ON the sea; a sea that
// scrolled away under it would read as the water being part of the page.

import { useEffect, useRef } from 'react';
import { makeRandom } from './random';

/** One floe: a jagged polygon, drifting right and bobbing. */
interface Floe {
  /** Centre, in fractions of the canvas, so a resize does not restart the drift. */
  x: number;
  y: number;
  readonly radius: number;
  /** Fractions of canvas width per second. Bigger floes ride lower and slower. */
  readonly drift: number;
  readonly bob: number;
  readonly phase: number;
  readonly rotation: number;
  readonly spin: number;
  readonly opacity: number;
  /** Per-vertex radius multipliers — the jaggedness, fixed at birth. */
  readonly vertices: readonly number[];
}

const FLOE_COUNT = 26;

function makeFloes(): Floe[] {
  const random = makeRandom(0x1ce);
  return Array.from({ length: FLOE_COUNT }, () => {
    const radius = 14 + random() * 74;
    const vertexCount = 6 + Math.floor(random() * 4);
    return {
      x: random(),
      y: random(),
      radius,
      // Small floes skate, big ones lumber — the parallax that gives the sea depth.
      drift: (0.004 + random() * 0.012) * (90 / (radius + 40)),
      bob: 2 + random() * 6,
      phase: random() * Math.PI * 2,
      rotation: random() * Math.PI * 2,
      spin: (random() - 0.5) * 0.05,
      opacity: 0.3 + random() * 0.45,
      vertices: Array.from({ length: vertexCount }, () => 0.62 + random() * 0.38),
    };
  });
}

function drawFloe(context: CanvasRenderingContext2D, floe: Floe, x: number, y: number): void {
  const { radius, vertices } = floe;
  context.beginPath();
  vertices.forEach((scale, index) => {
    const angle = floe.rotation + (index / vertices.length) * Math.PI * 2;
    const px = x + Math.cos(angle) * radius * scale;
    const py = y + Math.sin(angle) * radius * scale * 0.55;
    if (index === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
  });
  context.closePath();
  context.fillStyle = `rgba(232, 249, 255, ${floe.opacity})`;
  context.fill();
  // A brighter rim: the lit edge is what makes a flat polygon read as floating ice.
  context.strokeStyle = `rgba(255, 255, 255, ${Math.min(1, floe.opacity * 1.6)})`;
  context.lineWidth = 1;
  context.stroke();
}

/**
 * The animated sea. Sits behind the whole editor shell, absolutely positioned.
 *
 * Honours `prefers-reduced-motion`: the floes are drawn once and the loop never starts.
 * Drifting ice is exactly the kind of continuous background motion that setting exists for.
 */
export function IceSea() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return undefined;

    const floes = makeFloes();
    let width = 0;
    let height = 0;
    let frame = 0;
    let last = performance.now();

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      const box = canvas.getBoundingClientRect();
      width = box.width;
      height = box.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      // Reset before scaling: `setTransform` replaces rather than compounds, so repeated
      // resizes cannot multiply the ratio in.
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const paint = (elapsed: number) => {
      context.clearRect(0, 0, width, height);
      for (const floe of floes) {
        const x = floe.x * (width + floe.radius * 2) - floe.radius;
        const y = floe.y * height + Math.sin(elapsed * 0.0006 + floe.phase) * floe.bob;
        drawFloe(context, floe, x, y);
      }
    };

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

    const step = (now: number) => {
      const delta = Math.min(now - last, 64) / 1000;
      last = now;
      for (const floe of floes) {
        floe.x += floe.drift * delta;
        // Wrap on the far side, so the sea is endless rather than emptying out.
        if (floe.x > 1.1) floe.x -= 1.2;
        (floe as { rotation: number }).rotation += floe.spin * delta;
      }
      paint(now);
      frame = requestAnimationFrame(step);
    };

    const start = () => {
      cancelAnimationFrame(frame);
      resize();
      if (reduced.matches) {
        paint(0);
        return;
      }
      last = performance.now();
      frame = requestAnimationFrame(step);
    };

    start();
    const observer = new ResizeObserver(() => {
      resize();
      if (reduced.matches) paint(0);
    });
    observer.observe(canvas);
    reduced.addEventListener('change', start);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      reduced.removeEventListener('change', start);
    };
  }, []);

  return <canvas ref={canvasRef} className="igloo-sea" aria-hidden="true" />;
}
