// Opt-in OOXML punctuation/kana compression and hanging punctuation. All advances
// are measured here and travel in layout records to browser paint and exporters.
import type { FieldAwarePiece } from './field-projection.ts';
import { segmentGraphemes } from './grapheme.ts';
import { measureDisplayText, type ResolvedRunStyle } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import type { TextMeasurer } from './semantic-records.ts';
import { eastAsianLanguage, type CjkParagraphTypography } from './cjk-typography.ts';

const FULLWIDTH_PUNCTUATION =
  /^[、。〈〉《》「」『』【】〔〕〖〗〘〙〚〛！（），．：；？［］｛｝]$/u;
const KANA = /^[\u3041-\u3096\u30a1-\u30fa][\u3099\u309a]?$/u;

const compressible = (piece: FieldAwarePiece): boolean =>
  !piece.projected &&
  piece.measureText === undefined &&
  !piece.positionalTab &&
  !piece.equation &&
  !piece.inlineDrawing &&
  piece.end - piece.start === piece.text.length;

interface CompressionSlice {
  readonly from: number;
  readonly to: number;
  readonly reduction: number;
}

function compressionSlices(
  pieces: readonly FieldAwarePiece[],
  includeKana: boolean,
  measurer: TextMeasurer
): ReadonlyMap<FieldAwarePiece, readonly CompressionSlice[]> {
  const starts: number[] = [];
  let length = 0;
  const text = pieces
    .map((piece) => {
      starts.push(length);
      const visible = compressible(piece) ? piece.text : '\ufffc';
      length += visible.length;
      return visible;
    })
    .join('');
  const slices = new Map<FieldAwarePiece, CompressionSlice[]>();
  let pieceIndex = 0;
  for (const cluster of segmentGraphemes(text)) {
    const fraction = FULLWIDTH_PUNCTUATION.test(cluster.text)
      ? 0.5
      : includeKana && KANA.test(cluster.text)
        ? 0.125
        : 0;
    if (!fraction) continue;
    while (pieceIndex + 1 < pieces.length && starts[pieceIndex + 1]! <= cluster.utf16From)
      pieceIndex++;
    const base = pieces[pieceIndex]!;
    // Measure the complete cluster with its base character's font. Apply the
    // same per-unit reduction to every fragment, including split combining marks.
    const advance = measureDisplayText(
      cluster.text,
      styleForFontSlot(base.style, base.fontSlot),
      measurer
    );
    const reduction = Math.max(0, advance * fraction) / cluster.text.length;
    for (
      let index = pieceIndex;
      index < pieces.length && starts[index]! < cluster.utf16To;
      index++
    ) {
      const piece = pieces[index]!;
      const from = Math.max(0, cluster.utf16From - starts[index]!);
      const to = Math.min(piece.text.length, cluster.utf16To - starts[index]!);
      if (from === to) continue;
      let list = slices.get(piece);
      if (!list) {
        list = [];
        slices.set(piece, list);
      }
      list.push({ from, to, reduction });
    }
  }
  return slices;
}

export function compressCjkPieces(
  pieces: readonly FieldAwarePiece[],
  policy: CjkParagraphTypography,
  measurer: TextMeasurer
): readonly FieldAwarePiece[] {
  const compression = policy.settings?.compression;
  if (!compression || compression === 'doNotCompress') return pieces;
  const result: FieldAwarePiece[] = [];
  const derived = new WeakMap<ResolvedRunStyle, Map<number, ResolvedRunStyle>>();
  const slices = compressionSlices(
    pieces,
    compression === 'compressPunctuationAndJapaneseKana',
    measurer
  );
  for (const piece of pieces) {
    const compressedSlices = slices.get(piece);
    if (!compressedSlices) {
      result.push(piece);
      continue;
    }
    let from = 0;
    for (const slice of compressedSlices) {
      if (slice.from > from)
        result.push({
          ...piece,
          text: piece.text.slice(from, slice.from),
          start: piece.start + from,
          end: piece.start + slice.from,
        });
      // Compress whitespace, never horizontally scale the glyph. The same letter
      // spacing reaches measurement, paint, caret edges, and export.
      const spacing = piece.style.characterSpacingPt - slice.reduction;
      let bySpacing = derived.get(piece.style);
      if (!bySpacing) {
        bySpacing = new Map();
        derived.set(piece.style, bySpacing);
      }
      let compressed = bySpacing.get(spacing);
      if (!compressed) {
        compressed = { ...piece.style, characterSpacingPt: spacing };
        bySpacing.set(spacing, compressed);
      }
      result.push({
        ...piece,
        text: piece.text.slice(slice.from, slice.to),
        start: piece.start + slice.from,
        end: piece.start + slice.to,
        style: compressed,
      });
      from = slice.to;
    }
    if (from === 0) result.push(piece);
    else if (from < piece.text.length)
      result.push({ ...piece, text: piece.text.slice(from), start: piece.start + from });
  }
  return result;
}

export function canHangCjkPunctuation(
  text: string,
  piece: FieldAwarePiece,
  remaining: number,
  width: number,
  measurer: TextMeasurer
): boolean {
  if (piece.projected || piece.measureText !== undefined) return false;
  // Hanging is enabled by default. Ordinary Latin words/spaces must not allocate
  // a grapheme array on every placement candidate just to discover no punctuation.
  const tail = text[text.length - 1];
  if (!tail || !/^[\p{Pe}\p{Pf}\p{Po}]$/u.test(tail)) return false;
  if (!FULLWIDTH_PUNCTUATION.test(tail) && !eastAsianLanguage(piece.props)) return false;
  const last = segmentGraphemes(text).at(-1)?.text;
  if (!last || !/^[\p{Pe}\p{Pf}\p{Po}]$/u.test(last)) return false;
  const advance = measureDisplayText(last, styleForFontSlot(piece.style, piece.fontSlot), measurer);
  return width - advance <= remaining + 0.001 && remaining >= -0.001;
}
