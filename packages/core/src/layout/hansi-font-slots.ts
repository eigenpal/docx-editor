// The hAnsi face is independent of ascii. Keep authored properties and model
// ranges intact; only derived layout pieces select a different measurement face.
import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import { themeFontFamilyOf } from '../store/package/theme-font-scheme.ts';
import { isEastAsiaHintSymbol, hasEastAsiaSymbolHint } from './east-asia-symbol-hint.ts';
import type { FieldAwarePiece } from './field-pieces.ts';
import { segmentGraphemes } from './grapheme.ts';
import { withFontFamily, type ThemeFonts } from './run-style.ts';
import { isSymbolEncodedFamily } from './symbol-encoding.ts';

function hAnsiFamily(props: readonly OoxmlProperty[], theme?: ThemeFonts): string | undefined {
  let family: string | undefined;
  for (const prop of props) {
    if (prop.localName !== 'rFonts') continue;
    const attrs = prop.attributes;
    if (attrs?.hAnsi === undefined && attrs?.hAnsiTheme === undefined) continue;
    const face = (theme ? themeFontFamilyOf(attrs?.hAnsiTheme, theme) : null) ?? attrs?.hAnsi;
    if (face && face.length <= 128) family = face;
  }
  return family;
}

/** The definite hAnsi ranges. Conditional East Asian characters stay in their existing lane. */
function usesHAnsi(code: number, hint: boolean, chinese: boolean): boolean {
  // The no-break space keeps the ascii face, like the space it stands for.
  if (code < 0x80 || code === 0xa0 || code > 0xffff) return false;
  if (
    (code >= 0x590 && code <= 0x7bf) ||
    (code >= 0xfb1d && code <= 0xfdff) ||
    (code >= 0xfe70 && code <= 0xfefe)
  )
    return false;
  if (
    (code >= 0x1100 && code <= 0x11ff) ||
    (code >= 0x2f00 && code <= 0x2fdf) ||
    (code >= 0x2ff0 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xdfff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xffef)
  )
    return false;
  if (
    hint &&
    (isEastAsiaHintSymbol(code) ||
      (code >= 0x2b0 && code <= 0x3cf) ||
      (code >= 0x400 && code <= 0x4ff) ||
      (code >= 0x2000 && code <= 0x27bf) ||
      (code >= 0x2e80 && code <= 0x2eff) ||
      (code >= 0xe000 && code <= 0xf8ff) ||
      (code >= 0xfb00 && code <= 0xfb1c))
  )
    return false;
  // Font-table charset alone cannot establish this condition in the layout lane.
  // Leave the conditional range alone under an East Asian hint.
  if (hint && code >= 0x100 && code <= 0x2af) return false;
  if (
    hint &&
    chinese &&
    ((code >= 0x1e00 && code <= 0x1eff) ||
      [0xe0, 0xe1, 0xe8, 0xe9, 0xea, 0xec, 0xed, 0xf2, 0xf3, 0xf9, 0xfa, 0xfc].includes(code))
  )
    return false;
  return true;
}

/** Select hAnsi after the paragraph's existing East Asian slot pass. */
export function applyHAnsiFontSlots(
  pieces: FieldAwarePiece[],
  theme?: ThemeFonts
): FieldAwarePiece[] {
  const eligible = (piece: FieldAwarePiece) =>
    !piece.style.latinLane &&
    piece.fontSlot !== 'eastAsia' &&
    !isSymbolEncodedFamily(piece.style.fontFamily) &&
    !piece.positionalTab &&
    !piece.breakKind &&
    !piece.inlineDrawing &&
    !piece.anchoredAtom &&
    !piece.equation;
  // Skip Basic Latin and text which the previous pass already assigned to eastAsia.
  if (!pieces.some((piece) => eligible(piece) && /[^\u0000-\u007f]/.test(piece.text)))
    return pieces;
  let offset = 0;
  const text: string[] = [];
  const segments = pieces.map((piece) => {
    const participates = eligible(piece);
    const segment = participates && piece.text ? piece.text : '\u0000';
    let language: string | undefined;
    for (const prop of piece.props)
      if (prop.localName === 'lang')
        language = prop.attributes?.eastAsia ?? prop.attributes?.val ?? language;
    const from = offset;
    offset += segment.length;
    text.push(segment);
    return {
      from,
      to: offset,
      eligible: participates,
      family: hAnsiFamily(piece.props, theme),
      hint: hasEastAsiaSymbolHint(piece.props),
      chinese: /^zh(?:-|$)/i.test(language ?? ''),
    };
  });
  if (!segments.some((segment) => segment.eligible && segment.family)) return pieces;
  // Equal slots need no split. A mark at a run boundary can still inherit another face.
  if (
    !segments.some(
      (segment, index) =>
        segment.eligible &&
        segment.family &&
        (segment.family !== pieces[index]!.style.fontFamily ||
          (index > 0 && /^[\p{Mark}\u200d]/u.test(pieces[index]!.text)))
    )
  )
    return pieces;
  const rangesByPiece: { from: number; to: number; family: string | undefined }[][] = pieces.map(
    () => []
  );
  let first = 0;
  // Classify the complete stream once. A combining mark in another w:r must
  // keep the base character's face instead of starting another font cluster.
  for (const cluster of segmentGraphemes(text.join(''))) {
    while (first < segments.length && segments[first]!.to <= cluster.utf16From) first++;
    const base = segments[first];
    if (!base || !base.eligible) continue;
    const family = usesHAnsi(cluster.text.codePointAt(0)!, base.hint, base.chinese)
      ? base.family
      : undefined;
    for (
      let index = first;
      index < segments.length && segments[index]!.from < cluster.utf16To;
      index++
    ) {
      const segment = segments[index]!;
      if (!segment.eligible) continue;
      const from = Math.max(cluster.utf16From, segment.from) - segment.from;
      const to = Math.min(cluster.utf16To, segment.to) - segment.from;
      const ranges = rangesByPiece[index]!,
        tail = ranges.at(-1);
      if (tail && tail.family === family && tail.to === from) tail.to = to;
      else ranges.push({ from, to, family });
    }
  }
  let out: FieldAwarePiece[] | undefined;
  for (let index = 0; index < pieces.length; index++) {
    const piece = pieces[index]!,
      ranges = rangesByPiece[index]!;
    const literal =
      !piece.projected &&
      !piece.fieldAtom &&
      !piece.noteNav &&
      piece.measureText === undefined &&
      piece.end - piece.start === piece.text.length;
    if (
      !ranges.some((range) => range.family && range.family !== piece.style.fontFamily) ||
      (!literal && ranges.length !== 1)
    ) {
      out?.push(piece);
      continue;
    }
    out ??= pieces.slice(0, index);
    if (!literal) {
      out.push({
        ...piece,
        style: withFontFamily(piece.style, ranges[0]!.family!),
        fontSlot: 'hAnsi',
      });
      continue;
    }
    for (const range of ranges)
      out.push({
        ...piece,
        text: piece.text.slice(range.from, range.to),
        start: piece.start + range.from,
        end: piece.start + range.to,
        ...(range.family
          ? { style: withFontFamily(piece.style, range.family), fontSlot: 'hAnsi' as const }
          : {}),
      });
  }
  return out ?? pieces;
}
