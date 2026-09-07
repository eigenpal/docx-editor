// Paragraph-wide boundary analysis. A formatting, revision, or font-slot seam is
// not a Unicode boundary: segment the visible text once, then map cuts to pieces.
import type { FieldAwarePiece } from './field-projection.ts';
import { segmentGraphemes } from './grapheme.ts';
import {
  CJK_NO_BREAK_AFTER,
  CJK_NO_BREAK_BEFORE,
  isIdeographicForLineBreak,
  lastCodePointOf,
  wordBoundaries,
  type LineOpenDecision,
} from './cjk-line-break.ts';
import {
  eastAsianLanguage,
  kinsokuCharacters,
  type CjkParagraphTypography,
} from './cjk-typography.ts';

export function isHangul(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x11ff) ||
    (cp >= 0x3130 && cp <= 0x318f) ||
    (cp >= 0xa960 && cp <= 0xa97f) ||
    (cp >= 0xac00 && cp <= 0xd7ff)
  );
}
export const isCjk = (cp: number): boolean => isIdeographicForLineBreak(cp) || isHangul(cp);
export const hasCjkText = (text: string): boolean =>
  /[\u1100-\u11ff\u2e80-\u318f\u31c0-\u9fff\ua960-\ua97f\uac00-\ud7ff\uf900-\ufaff\ufe30-\ufe4f\uff01-\uff9f\u{20000}-\u{323af}]/u.test(
    text
  );
const isFullwidthAlphanumeric = (cp: number): boolean =>
  (cp >= 0xff10 && cp <= 0xff19) ||
  (cp >= 0xff21 && cp <= 0xff3a) ||
  (cp >= 0xff41 && cp <= 0xff5a);
const isText = (piece: FieldAwarePiece): boolean =>
  !piece.projected &&
  !piece.positionalTab &&
  !piece.inlineDrawing &&
  !piece.equation &&
  piece.end - piece.start === piece.text.length;

export interface CjkParagraphBreaks {
  boundaries(piece: FieldAwarePiece): readonly number[];
  decision(piece: FieldAwarePiece, offset: number): LineOpenDecision;
  cutAllowed(piece: FieldAwarePiece, candidateStart: number, index: number): boolean;
}

export function cjkParagraphBreaks(
  pieces: readonly FieldAwarePiece[],
  policy: CjkParagraphTypography
): CjkParagraphBreaks | null {
  if (
    !policy.characterWrap &&
    !pieces.some(
      (piece) =>
        /[\u1100-\u11ff\u2e80-\ud7ff\uf900-\uffef\u{20000}-\u{323af}]/u.test(piece.text) ||
        eastAsianLanguage(piece.props)
    )
  )
    return null;
  const starts = new Map<FieldAwarePiece, number>();
  const strings: string[] = [];
  let total = 0;
  for (const piece of pieces) {
    starts.set(piece, total);
    // Layout-owned atoms form barriers. Their display characters have no one-to-one
    // model mapping and must not become inter-character placement candidates.
    const text = isText(piece) ? piece.text : '\ufffc'.repeat(Math.min(piece.text.length, 1));
    strings.push(text);
    total += text.length;
  }
  const text = strings.join('');
  const clusters = segmentGraphemes(text);
  const decisions = new Map<number, LineOpenDecision>([
    [0, 'opens'],
    [text.length, 'opens'],
  ]);
  const latinCuts = new Set(wordBoundaries(text, false));
  // Numeric expressions and full-width alphabetic words are units, even when
  // runs split a decimal separator or currency sign from its digits.
  const numeric = new Set<number>();
  const figures =
    /[＄￥￡￦＋－$£¥+\-]?[0-9０-９]+(?:[．，：／.,:/][0-9０-９]+)*(?:[％%‰])?|[Ａ-Ｚａ-ｚ]+/gu;
  for (const match of text.matchAll(figures)) {
    if (!/[０-９Ａ-Ｚａ-ｚ]/u.test(match[0])) continue;
    for (let index = match.index + 1; index < match.index + match[0].length; index++)
      numeric.add(index);
  }
  let pieceIndex = 0;
  let leftPieceIndex = 0;
  const hasKorean = clusters.some((cluster) => isHangul(cluster.text.codePointAt(0)!));
  const detectedLanguage = hasKorean
    ? 'ko-kr'
    : /[\u3040-\u30ff\uff66-\uff9f]/u.test(text)
      ? 'ja-jp'
      : 'zh-cn';
  // Carry script context through punctuation, but never across a Latin word or space.
  const eastAsianContext: boolean[] = [];
  let context = false;
  for (const cluster of clusters) {
    if (!/^[\p{P}\p{S}\p{M}]+$/u.test(cluster.text)) context = isCjk(cluster.text.codePointAt(0)!);
    eastAsianContext.push(context || isCjk(cluster.text.codePointAt(0)!));
  }
  const languages = pieces.map((piece) => eastAsianLanguage(piece.props));
  const tables = new Map<string, ReturnType<typeof kinsokuCharacters>>();
  const tableFor = (language: string) => {
    let table = tables.get(language);
    if (!table) {
      table = kinsokuCharacters(language, policy.settings);
      tables.set(language, table);
    }
    return table;
  };
  for (let index = 1; index < clusters.length; index++) {
    const left = clusters[index - 1]!;
    const right = clusters[index]!;
    const at = right.utf16From;
    while (pieceIndex + 1 < pieces.length && starts.get(pieces[pieceIndex + 1]!)! <= at)
      pieceIndex++;
    while (
      leftPieceIndex + 1 < pieces.length &&
      starts.get(pieces[leftPieceIndex + 1]!)! <= left.utf16From
    )
      leftPieceIndex++;
    const before = lastCodePointOf(left.text)!;
    const beforeBase = left.text.codePointAt(0)!;
    const after = right.text.codePointAt(0)!;
    if (/[\t\n\f\ufffc]/u.test(left.text + right.text)) {
      decisions.set(at, 'opens');
      continue;
    }
    // Glue is independent of language and kinsoku. Neither character wrapping
    // nor emergency chopping may separate a non-breaking character's neighbours.
    if (/[\u00a0\u202f\u2060\ufeff]/u.test(left.text + right.text)) {
      decisions.set(at, 'forbidden');
      continue;
    }
    let forbidden = false;
    if (policy.kinsoku) {
      const language =
        languages[pieceIndex] ??
        (policy.settings &&
        (isCjk(after) || (eastAsianContext[index - 1] && /^[\p{P}\p{S}]+$/u.test(right.text)))
          ? detectedLanguage
          : undefined);
      const previousLanguage =
        languages[leftPieceIndex] ??
        (policy.settings &&
        (isCjk(beforeBase) || (isCjk(after) && /^[\p{P}\p{S}]+$/u.test(left.text)))
          ? detectedLanguage
          : undefined);
      if (language || previousLanguage) {
        forbidden =
          (language
            ? tableFor(language).before.includes(String.fromCodePoint(after))
            : CJK_NO_BREAK_BEFORE.has(after)) ||
          (previousLanguage
            ? tableFor(previousLanguage).after.includes(String.fromCodePoint(before))
            : CJK_NO_BREAK_AFTER.has(before));
      } else {
        forbidden = CJK_NO_BREAK_BEFORE.has(after) || CJK_NO_BREAK_AFTER.has(before);
        // ASCII/scientific punctuation participates only beside East Asian text.
        // A Latin paragraph containing ℃ retains its ordinary word boundaries.
        if (eastAsianContext[index - 1] || isCjk(after)) {
          const inferred = isHangul(before) || isHangul(after) ? 'ko-kr' : 'ja-jp';
          const table = tableFor(inferred);
          forbidden ||=
            (eastAsianContext[index - 1]! && table.before.includes(String.fromCodePoint(after))) ||
            (isCjk(after) && table.after.includes(String.fromCodePoint(before)));
        }
      }
    }
    if (forbidden) {
      decisions.set(at, 'forbidden');
      continue;
    }
    // Figure/letter groups move as words. Like an oversized Latin word, an
    // extremely long group can still use emergency chopping at safe boundaries.
    if (numeric.has(at)) {
      decisions.set(at, 'continues');
      continue;
    }
    const eastAsian =
      (isCjk(beforeBase) && !isFullwidthAlphanumeric(beforeBase)) ||
      (isCjk(after) && !isFullwidthAlphanumeric(after)) ||
      (eastAsianContext[index - 1]! && /^[\p{P}\p{S}]+$/u.test(left.text));
    const wrapCharacters =
      policy.characterWrap && (!hasKorean || (isHangul(beforeBase) && isHangul(after)));
    const koreanWord = isHangul(beforeBase) && isHangul(after) && !wrapCharacters;
    const opens =
      latinCuts.has(at) ||
      /\s$/u.test(left.text) ||
      /^\s/u.test(right.text) ||
      (eastAsian && !koreanWord) ||
      wrapCharacters;
    decisions.set(at, opens ? 'opens' : 'continues');
  }
  const boundaries = new Map<FieldAwarePiece, readonly number[]>();
  for (const piece of pieces) {
    const start = starts.get(piece)!;
    if (!isText(piece)) {
      boundaries.set(piece, wordBoundaries(piece.text, false));
      continue;
    }
    const cuts: number[] = [];
    // Walk each piece once; decisions are O(1), including cluster-interior vetoes.
    for (let offset = 1; offset < piece.text.length; offset++) {
      const decision = decisions.get(start + offset);
      if (decision === 'opens' || (numeric.has(start + offset) && decision === 'continues'))
        cuts.push(offset);
    }
    cuts.push(piece.text.length);
    boundaries.set(piece, cuts);
  }
  return {
    boundaries: (piece) => boundaries.get(piece)!,
    decision: (piece, offset) =>
      !isText(piece) ? 'opens' : (decisions.get(starts.get(piece)! + offset) ?? 'forbidden'),
    cutAllowed: (piece, candidateStart, index) =>
      decisions.get(starts.get(piece)! + candidateStart + index) !== 'forbidden' &&
      decisions.has(starts.get(piece)! + candidateStart + index),
  };
}
