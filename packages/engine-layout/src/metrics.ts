// Font metrics port (document-engine task 8.1 boundary / design D7). Measurement
// reads advances through this port, never a browser font stack, so layout is
// runtime-neutral. The real production port wraps HarfBuzz/fontkit (the section-8
// bake-off); the deterministic port here gives every character a fixed advance so
// layout output is exactly reproducible for the cross-runtime comparator.

export interface MetricsPort {
  /** Advance width (fixed-point) of a character in a run. */
  advance(char: string, bold: boolean, italic: boolean): number;
  /** Line height (fixed-point). */
  readonly lineHeight: number;
  /** Width of a space (fixed-point). */
  readonly spaceWidth: number;
}

/**
 * Deterministic metrics: every glyph advances a fixed amount (bold slightly
 * wider). Reproducible across every runtime — the basis for exact display-list
 * comparison until real shaping is wired in.
 */
export class DeterministicMetrics implements MetricsPort {
  readonly lineHeight = 240; // fixed-point units (e.g. 1/20 pt scale)
  readonly spaceWidth = 60;

  advance(_char: string, bold: boolean): number {
    return bold ? 130 : 120;
  }
}
