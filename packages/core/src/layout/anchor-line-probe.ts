// Which line an anchored drawing lands on, predicted before the paragraph is placed.
//
// `synthesizeParagraphWrapExclusionZones` and `zoneApplies` need an anchor's line start
// while that line is still being built, so this walks the pieces once with the placement
// loop's own word state — the SAME open decision (`lineOpenDecisionAt`) and the same
// mid-word carry — and reports where each anchor offset would land. Any rule the two
// loops do not share puts the predicted start one character off, and text then wraps
// around a hole one line early: a veto-less probe did exactly that whenever a closing
// mark wrapped down with its carrier.
//
// It stays an ESTIMATE on the paths it has always approximated: the oversized-word chop
// and horizontal float passages are placement-time decisions this pass cannot see.

import { PAGE_BREAK_CHAR } from '@docx-editor.dev/core/store';
import type { FieldAwarePiece } from './field-projection.ts';
import { lineOpenDecisionAt, wordBoundaries } from './cjk-line-break.ts';
import type { CjkParagraphBreaks } from './cjk-paragraph-breaks.ts';
import { canHangCjkPunctuation } from './cjk-spacing.ts';
import type { CjkParagraphTypography } from './cjk-typography.ts';
import { measureInlineDrawing } from './drawing-layout.ts';
import { styleForFontSlot } from './script-itemization.ts';
import type { EquationSpanRecord } from './equation-layout.ts';
import type { TextMeasurer } from './semantic-records.ts';

/** Model offset of the first character of the line each anchor start falls on. */
export function anchorLineStartsByModelOffset(input: {
  readonly cjkBreaks?: CjkParagraphBreaks | null;
  readonly typography?: CjkParagraphTypography;
  readonly pieces: readonly FieldAwarePiece[];
  readonly measurer: TextMeasurer;
  readonly available: number;
  readonly firstLineOffset: number;
  readonly anchorStarts: readonly number[];
  readonly equationLayoutOf: (piece: FieldAwarePiece) => EquationSpanRecord | null;
}): Map<number, number> {
  const { pieces, measurer, available, firstLineOffset, anchorStarts, equationLayoutOf } = input;
  const out = new Map<number, number>();
  if (anchorStarts.length === 0) return out;
  let probeLineStart = pieces[0]?.start ?? 0;
  const lineStarts = [probeLineStart];
  let probeWidth = 0;
  let probeLineIndex = 0;
  // Mirrors the placement loop's word state — the same open decision (`lineOpenDecisionAt`)
  // and the same mid-word carry — so the probe's predicted line starts cannot diverge
  // from real placement on a kinsoku line. A veto-less probe put the predicted start
  // one character off whenever a closing mark wrapped down with its carrier, and
  // `zoneApplies` then keyed off the wrong line.
  let probeLastEmitted = '';
  let probeWordStart = 0;
  let probeWordStartWidth = -1;
  const probeLineOffset = (): number => (probeLineIndex === 0 ? firstLineOffset : 0);
  const probeLineAvail = (): number => Math.max(1, available - probeLineOffset());
  const closeProbeLine = (nextStart: number): void => {
    probeLineStart = nextStart;
    lineStarts.push(nextStart);
    probeWidth = 0;
    probeLineIndex += 1;
  };
  for (const piece of pieces) {
    const equation = equationLayoutOf(piece);
    if (equation) {
      const width = equation.geometry.box.width;
      if (probeWidth > 0 && probeWidth + width > probeLineAvail()) closeProbeLine(piece.start);
      probeWidth += width;
      probeLastEmitted = '';
      probeWordStartWidth = -1;
      continue;
    }
    if (piece.inlineDrawing) {
      const width = measureInlineDrawing(piece.inlineDrawing.projection).totalWidth;
      if (probeWidth > 0 && probeWidth + width > probeLineAvail()) closeProbeLine(piece.start);
      probeWidth += width;
      probeLastEmitted = '';
      probeWordStartWidth = -1;
      continue;
    }
    if (piece.text === '\n' || piece.text === PAGE_BREAK_CHAR) {
      closeProbeLine(piece.end);
      continue;
    }
    const probePieceLayoutOwned =
      Boolean(piece.projected) ||
      Boolean(piece.positionalTab) ||
      piece.end - piece.start !== piece.text.length;
    let consumed = 0;
    for (const boundary of input.cjkBreaks?.boundaries(piece) ??
      wordBoundaries(piece.text, !probePieceLayoutOwned)) {
      const candidate = piece.text.slice(consumed, boundary);
      if (candidate.length === 0) continue;
      const style = styleForFontSlot(piece.style, piece.fontSlot);
      const width = measurer.measure(candidate, style);
      const modelStart = piece.start + consumed;
      const probeDecision =
        input.cjkBreaks?.decision(piece, consumed) ??
        lineOpenDecisionAt(probeLastEmitted, candidate, consumed > 0);
      const opens = probeDecision === 'opens';
      if (opens) {
        probeWordStart = modelStart;
        probeWordStartWidth = probeWidth;
      }
      const hangs =
        input.typography?.overflowPunctuation &&
        canHangCjkPunctuation(candidate, piece, probeLineAvail() - probeWidth, width, measurer);
      if (!hangs && probeWidth > 0 && probeWidth + width > probeLineAvail()) {
        if (probeDecision === 'forbidden' && probeWordStartWidth <= 0) {
          // Placement pushes the group out past the measure rather than opening a line
          // before it, so this probe line does not end here either.
        } else if (opens || probeWordStartWidth <= 0) {
          closeProbeLine(modelStart);
        } else {
          // Mid-word overflow: placement carries the whole word down, so the next
          // probe line starts at the word start, not at this candidate.
          const carried = probeWidth - probeWordStartWidth;
          closeProbeLine(probeWordStart);
          probeWidth = carried;
        }
        probeWordStartWidth = 0;
      }
      probeWidth += width;
      probeLastEmitted = candidate;
      consumed = boundary;
    }
  }
  for (const anchorStart of anchorStarts) {
    // Resolve after mid-word carries have finalized line starts. Eager assignment
    // retained a stale line for carried anchors and overwrote a piece-start anchor
    // with the final line of every multi-line piece.
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (lineStarts[mid]! <= anchorStart) low = mid;
      else high = mid - 1;
    }
    out.set(anchorStart, lineStarts[low]!);
  }
  return out;
}
