// A face's ordinary hyphen draws a non-breaking hyphen that the face has no glyph for.
// Preserve the source character and clusters: its no-break semantics stay in Core layout.
import { createShapedRun, type ShapeInput, type ShapedRun, type TextShaper } from './shaped-run.ts';

export function shapeHyphenGlyphFallback(
  shaper: TextShaper,
  input: ShapeInput,
  primary: ShapedRun
): ShapedRun {
  if (!input.text.includes('\u2011')) return primary;
  const missing = new Set(
    primary.glyphs.filter((glyph) => glyph.id === 0).map((glyph) => glyph.cluster)
  );
  if (!missing.size) return primary;
  const text = input.text.replace(/\u2011/g, (character, offset: number) =>
    missing.has(offset) ? '-' : character
  );
  if (text === input.text) return primary;
  try {
    const replacement = shaper.shape({ ...input, text });
    return createShapedRun({ ...replacement, text: input.text }, input.environment);
  } catch {
    return primary;
  }
}
