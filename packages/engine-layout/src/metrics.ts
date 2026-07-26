// Font metrics port (document-engine task 8.1 boundary / design D7). Measurement
// reads advances through this port, never a browser font stack, so layout is
// runtime-neutral. The real production port wraps HarfBuzz/fontkit (the section-8
// bake-off); the deterministic port here gives every character a fixed advance so
// layout output is exactly reproducible for the cross-runtime comparator.

import type {
  ShapingCapability,
  LigatureInteriorCaret,
  CharacterAdvanceProvable,
} from './shaping.ts';
import { ASCII_LATIN_SHAPING, PER_GRAPHEME_SHAPING } from './shaping.ts';

export interface MetricsPort {
  /** Advance width (fixed-point) of a character in a run. */
  advance(char: string, bold: boolean, italic: boolean): number;
  /** Line height (fixed-point). */
  readonly lineHeight: number;
  /** Width of a space (fixed-point). */
  readonly spaceWidth: number;
  /** Explicit caret-edge capability for keyboard navigation provenance. */
  readonly shaping: ShapingCapability;
  /** When shaping.ligatures is opaque, marks interior ligature caret stops non-navigable. */
  readonly ligatureInteriorCaret?: LigatureInteriorCaret;
  /** When set, interior caret stops require every code unit in the grapheme to pass this probe. */
  readonly provesCharacterAdvance?: CharacterAdvanceProvable;
}

/**
 * Deterministic metrics: every glyph advances a fixed amount (bold slightly
 * wider). Reproducible across every runtime — the basis for exact display-list
 * comparison until real shaping is wired in.
 */
export class DeterministicMetrics implements MetricsPort {
  readonly lineHeight = 240; // fixed-point units (e.g. 1/20 pt scale)
  readonly spaceWidth = 60;
  readonly shaping: ShapingCapability = PER_GRAPHEME_SHAPING;

  advance(_char: string, bold: boolean, _italic = false): number {
    return bold ? 130 : 120;
  }

  provesCharacterAdvance(_char: string): boolean {
    return true;
  }
}

// Helvetica AFM advance widths (units per 1000 em) for ASCII — a close standard
// approximation used until real HarfBuzz shaping is wired in. Unknown code points
// fall back to the average lowercase width.
// prettier-ignore
const HELVETICA_1000: Readonly<Record<string, number>> = {
  ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556,
  '8': 556, '9': 556, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556,
  '@': 1015, A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722,
  I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611, '[': 278,
  '\\': 278, ']': 278, '^': 469, _: 556, '`': 333, a: 556, b: 556, c: 500, d: 556,
  e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833, n: 556,
  o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500,
  y: 500, z: 500, '{': 334, '|': 260, '}': 334, '~': 584,
};
const HELVETICA_DEFAULT = 556;

/**
 * Proportional Helvetica metrics: advance = width/1000 * font size. Positions now
 * match the Helvetica the DOM/PDF backends actually render, so words no longer
 * drift. Still deterministic (integer fixed-point) and reproducible cross-runtime.
 */
export class HelveticaMetrics implements MetricsPort {
  readonly lineHeight: number;
  private readonly fontSize: number;
  readonly spaceWidth: number;
  readonly shaping: ShapingCapability = ASCII_LATIN_SHAPING;

  constructor(lineHeightTwips = 240) {
    this.lineHeight = lineHeightTwips;
    this.fontSize = Math.round(lineHeightTwips * 0.9); // matches the backends' glyph size
    this.spaceWidth = this.advance(' ', false, false);
  }

  advance(char: string, bold: boolean, _italic = false): number {
    const w = HELVETICA_1000[char] ?? HELVETICA_DEFAULT;
    const base = Math.round((w / 1000) * this.fontSize);
    return bold ? Math.round(base * 1.06) : base;
  }

  provesCharacterAdvance(char: string): boolean {
    return char in HELVETICA_1000;
  }
}
