// OS/2 strikeout stroke, read from an admitted face's own bytes.
//
// Word paints `w:separator` as a strikeout stroke: the footnote rule's thickness and its
// offset above the baseline are the face's `yStrikeoutSize` and `yStrikeoutPosition` scaled
// to the run's size, not a fixed hairline at one quarter of the font size. Calibri 11pt
// gives 0.720pt at 2.75pt; Arial at the same 11pt gives 0.548pt at 2.847pt.

/** A strikeout stroke, as a fraction of the em. `offsetEm` is the stroke TOP. */
export interface StrikeoutStrokeEm {
  /** `yStrikeoutPosition` over `unitsPerEm`. Positive is above the baseline. */
  readonly offsetEm: number;
  /** `yStrikeoutSize` over `unitsPerEm`. Always positive. */
  readonly thicknessEm: number;
}

/** A strikeout stroke at the drawn size, in points. `offsetPt` is the stroke TOP. @public */
export interface StrikeoutStrokePt {
  /** Distance from the baseline UP to the top of the stroke. */
  readonly offsetPt: number;
  /** Stroke height. Always positive. */
  readonly thicknessPt: number;
}

const TTC_TAG = 0x74746366;
const HEAD_TAG = 0x68656164;
const OS2_TAG = 0x4f532f32;
/** Most table records one face may declare. A directory is file-supplied. */
const MAX_TABLE_RECORDS = 4096;
/**
 * Em bounds on the two int16 the face supplies.
 *
 * Both are attacker-controlled: `yStrikeoutSize = 32767` over `unitsPerEm = 16` is a stroke
 * 2048 em tall. A stroke taller than the em, or offset further than an em from the baseline,
 * is not a strikeout, so the face is refused rather than clamped and the caller keeps its
 * own default.
 */
const MAX_THICKNESS_EM = 1;
const MAX_ABS_OFFSET_EM = 1;

function tableDirectoryBase(view: DataView, byteLength: number, faceIndex: number): number | null {
  if (byteLength < 12) return null;
  if (view.getUint32(0) !== TTC_TAG) return 0;
  const index = Number.isSafeInteger(faceIndex) && faceIndex > 0 ? faceIndex : 0;
  const entry = 12 + index * 4;
  if (entry + 4 > byteLength) return null;
  const base = view.getUint32(entry);
  return base + 12 <= byteLength ? base : null;
}

function tableOffset(
  view: DataView,
  byteLength: number,
  base: number,
  tag: number,
  minimumLength: number
): number | null {
  const count = view.getUint16(base + 4);
  if (count > MAX_TABLE_RECORDS || base + 12 + count * 16 > byteLength) return null;
  for (let index = 0; index < count; index += 1) {
    const record = base + 12 + index * 16;
    if (view.getUint32(record) !== tag) continue;
    const offset = view.getUint32(record + 8);
    const length = view.getUint32(record + 12);
    if (length < minimumLength || offset + length > byteLength) return null;
    return offset;
  }
  return null;
}

/**
 * Read `yStrikeoutSize` / `yStrikeoutPosition` from a face, as em fractions.
 *
 * Returns null for a face with no `OS/2` table, a malformed directory, or values outside the
 * em bounds above. The bytes are file-supplied, so every offset is range-checked here.
 */
export function sfntStrikeoutStrokeEm(
  bytes: Uint8Array,
  faceIndex: number
): StrikeoutStrokeEm | null {
  const byteLength = bytes.byteLength;
  const view = new DataView(bytes.buffer, bytes.byteOffset, byteLength);
  const base = tableDirectoryBase(view, byteLength, faceIndex);
  if (base === null) return null;
  const head = tableOffset(view, byteLength, base, HEAD_TAG, 54);
  if (head === null) return null;
  const unitsPerEm = view.getUint16(head + 18);
  if (unitsPerEm <= 0) return null;
  // `yStrikeoutSize` is at 26 and `yStrikeoutPosition` at 28 in every OS/2 version.
  const os2 = tableOffset(view, byteLength, base, OS2_TAG, 30);
  if (os2 === null) return null;
  const thicknessEm = view.getInt16(os2 + 26) / unitsPerEm;
  const offsetEm = view.getInt16(os2 + 28) / unitsPerEm;
  if (!(thicknessEm > 0) || thicknessEm > MAX_THICKNESS_EM) return null;
  if (!(Math.abs(offsetEm) <= MAX_ABS_OFFSET_EM)) return null;
  return { offsetEm, thicknessEm };
}
