import type { ResolvedRunStyle } from './run-style.ts';

/** A positive kern threshold opts in; zero disables inherited kerning. */
export function isRunKerningEnabled(style: ResolvedRunStyle): boolean {
  return (
    (style.kerningEnabled ?? style.kerningMinPt > 0) &&
    style.kerningMinPt > 0 &&
    style.fontSizePt >= style.kerningMinPt
  );
}
