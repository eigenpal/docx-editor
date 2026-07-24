// Word and block selection from model-derived semantic index (interactive-paginated-editing 5.3).

import type {
  InteractionAffinity,
  SemanticTarget,
  WordSegmentRecord,
} from '@docx-editor.dev/core-contract/interaction';

/** Resolve the word segment range for a text hit using affinity at segment boundaries. */
export function resolveWordRangeAtHit(
  wordSegments: readonly WordSegmentRecord[],
  graphemeOffset: number,
  affinity: InteractionAffinity,
  paragraphGraphemeCount: number,
): { readonly graphemeFrom: number; readonly graphemeTo: number } {
  if (paragraphGraphemeCount === 0) {
    return { graphemeFrom: 0, graphemeTo: 0 };
  }

  if (graphemeOffset >= paragraphGraphemeCount) {
    if (wordSegments.length === 0) {
      return {
        graphemeFrom: Math.max(0, paragraphGraphemeCount - 1),
        graphemeTo: paragraphGraphemeCount,
      };
    }
    const last = wordSegments[wordSegments.length - 1]!;
    return { graphemeFrom: last.graphemeFrom, graphemeTo: last.graphemeTo };
  }

  for (let i = 0; i < wordSegments.length; i += 1) {
    const seg = wordSegments[i]!;
    const next = wordSegments[i + 1];
    if (next && seg.graphemeTo === graphemeOffset && next.graphemeFrom === graphemeOffset) {
      const chosen = affinity === 'upstream' ? seg : next;
      return { graphemeFrom: chosen.graphemeFrom, graphemeTo: chosen.graphemeTo };
    }
  }

  const containing = wordSegments.find(
    (seg) => seg.graphemeFrom <= graphemeOffset && graphemeOffset < seg.graphemeTo,
  );
  if (containing) {
    return { graphemeFrom: containing.graphemeFrom, graphemeTo: containing.graphemeTo };
  }

  const from = Math.min(graphemeOffset, paragraphGraphemeCount - 1);
  return { graphemeFrom: from, graphemeTo: from + 1 };
}

function textTarget(
  base: Extract<SemanticTarget, { kind: 'text' }>,
  graphemeOffset: number,
  affinity: InteractionAffinity,
): Extract<SemanticTarget, { kind: 'text' }> {
  return { ...base, graphemeOffset, affinity };
}

/** Build a forward word selection from a collapsed editable text hit. */
export function wordSelectionFromHit(
  hit: Extract<SemanticTarget, { kind: 'text' }>,
  wordSegments: readonly WordSegmentRecord[],
  paragraphGraphemeCount: number,
): { anchor: Extract<SemanticTarget, { kind: 'text' }>; head: Extract<SemanticTarget, { kind: 'text' }> } {
  const range = resolveWordRangeAtHit(
    wordSegments,
    hit.graphemeOffset,
    hit.affinity,
    paragraphGraphemeCount,
  );
  const anchorAffinity: InteractionAffinity = 'downstream';
  const headAffinity: InteractionAffinity =
    range.graphemeTo >= paragraphGraphemeCount ? 'downstream' : 'upstream';
  return {
    anchor: textTarget(hit, range.graphemeFrom, anchorAffinity),
    head: textTarget(hit, range.graphemeTo, headAffinity),
  };
}

/** Build a full editable-paragraph block selection (triple-click). */
export function blockSelectionFromHit(
  hit: Extract<SemanticTarget, { kind: 'text' }>,
  paragraphGraphemeCount: number,
): { anchor: Extract<SemanticTarget, { kind: 'text' }>; head: Extract<SemanticTarget, { kind: 'text' }> } {
  return {
    anchor: textTarget(hit, 0, 'downstream'),
    head: textTarget(hit, paragraphGraphemeCount, 'downstream'),
  };
}

/** Every endpoint in a word range lies on a grapheme boundary of the paragraph. */
export function endpointsOnGraphemeBoundaries(
  paragraphGraphemeCount: number,
  graphemeFrom: number,
  graphemeTo: number,
): boolean {
  const valid = (offset: number) =>
    Number.isInteger(offset) && offset >= 0 && offset <= paragraphGraphemeCount;
  return valid(graphemeFrom) && valid(graphemeTo);
}
