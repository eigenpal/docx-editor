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

export function compressCjkPieces(
  pieces: readonly FieldAwarePiece[],
  policy: CjkParagraphTypography,
  measurer: TextMeasurer
): readonly FieldAwarePiece[] {
  const compression = policy.settings?.compression;
  if (!compression || compression === 'doNotCompress') return pieces;
  const result: FieldAwarePiece[] = [];
  const derived = new WeakMap<ResolvedRunStyle, Map<number, ResolvedRunStyle>>();
  for (const piece of pieces) {
    if (
      piece.projected ||
      piece.measureText !== undefined ||
      piece.positionalTab ||
      piece.equation ||
      piece.inlineDrawing ||
      piece.end - piece.start !== piece.text.length
    ) {
      result.push(piece);
      continue;
    }
    const style = styleForFontSlot(piece.style, piece.fontSlot);
    let from = 0;
    for (const cluster of segmentGraphemes(piece.text)) {
      const fraction = FULLWIDTH_PUNCTUATION.test(cluster.text)
        ? 0.5
        : compression === 'compressPunctuationAndJapaneseKana' && KANA.test(cluster.text)
          ? 0.125
          : 0;
      if (!fraction) continue;
      if (cluster.utf16From > from)
        result.push({
          ...piece,
          text: piece.text.slice(from, cluster.utf16From),
          start: piece.start + from,
          end: piece.start + cluster.utf16From,
        });
      // Compress whitespace, never horizontally scale the glyph. The same letter
      // spacing reaches measurement, paint, caret edges, and export.
      const advance = measureDisplayText(cluster.text, style, measurer);
      const spacing =
        piece.style.characterSpacingPt - Math.max(0, advance * fraction) / cluster.text.length;
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
        text: cluster.text,
        start: piece.start + cluster.utf16From,
        end: piece.start + cluster.utf16To,
        style: compressed,
      });
      from = cluster.utf16To;
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
