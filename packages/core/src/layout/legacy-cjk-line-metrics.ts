// Legacy CJK faces can declare a one-em box with no leading. Word reserves extra
// space above and below those glyphs. Keep this narrow: faces with their own
// leading, taller face boxes, and explicit substitution metrics stay unchanged.
import { trustedFontBytes, type ResolvedFont } from './font-resource.ts';

const cjkFaces = new WeakMap<ResolvedFont, boolean>();
function hasCjkCodePages(font: ResolvedFont): boolean {
  const cached = cjkFaces.get(font);
  if (cached !== undefined) return cached;
  const bytes = trustedFontBytes(font);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let supported = false;
  // Admission validates the selected sfnt/TTC directory. These checks also bound
  // reads of optional OS/2 fields that old fonts can omit.
  const base = view.getUint32(0) === 0x74746366 ? view.getUint32(12 + font.faceIndex * 4) : 0;
  const count = view.getUint16(base + 4);
  for (let index = 0; index < count; index++) {
    const record = base + 12 + index * 16;
    if (view.getUint32(record) !== 0x4f532f32) continue;
    const offset = view.getUint32(record + 8);
    const length = view.getUint32(record + 12);
    if (length >= 86 && offset <= bytes.byteLength - length && view.getUint16(offset) >= 1) {
      // Windows code pages 932, 936, 949, and 950 (OS/2 bits 17–20).
      supported = (view.getUint32(offset + 78) & 0x001e0000) !== 0;
    }
    break;
  }
  cjkFaces.set(font, supported);
  return supported;
}

export function legacyCjkLineMetrics(
  font: ResolvedFont,
  sizePt: number,
  metrics: { height: number; baseline: number },
  lineGap: number,
  roundingTolerance: number
): { height: number; baseline: number } {
  if (
    lineGap > roundingTolerance ||
    Math.abs(metrics.height - sizePt) > roundingTolerance ||
    !hasCjkCodePages(font)
  )
    return metrics;
  // Saved Word MS Gothic lines at 11pt occupy 14.28pt before paragraph spacing.
  // The continuous 1.3em box differs only by Word's device-grid rounding.
  const leading = sizePt * 0.3;
  return { height: metrics.height + leading, baseline: metrics.baseline + leading / 2 };
}
