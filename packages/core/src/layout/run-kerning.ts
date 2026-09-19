import type { ResolvedRunStyle } from './run-style.ts';

/** OOXML kern is opt-in and applies only at or above its authored size threshold. */
export function isRunKerningEnabled(style: ResolvedRunStyle): boolean {
  return (
    (style.kerningEnabled ?? style.kerningMinPt > 0) &&
    style.kerningMinPt >= 0 &&
    style.fontSizePt >= style.kerningMinPt
  );
}
