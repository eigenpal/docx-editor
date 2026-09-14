import { takeAnchors, type AnchorProjection } from './markdown-media.ts';
import type {
  AnchoredDrawingRecord,
  InlineDrawingRecord,
  LineSegment,
  StyleSpanRecord,
} from '@docx-editor.dev/core/layout';
import type { MarkdownTextToken } from './markdown-inline.ts';

export type MarkdownAtom =
  | {
      readonly kind: 'span';
      readonly start: number;
      readonly order: number;
      readonly span: StyleSpanRecord;
      readonly sourceText?: string;
      readonly sourceOffset?: number;
    }
  | {
      readonly kind: 'drawing';
      readonly start: number;
      readonly order: number;
      readonly drawing: InlineDrawingRecord | AnchoredDrawingRecord;
    };

export function sourceTextOf(span: StyleSpanRecord): string {
  return span.equation?.fallbackText ?? span.text;
}

export function atomToken(atom: Extract<MarkdownAtom, { kind: 'span' }>): MarkdownTextToken {
  return {
    span: atom.span,
    paragraphId: atom.span.range.paragraphId,
    sourceText: atom.sourceText ?? sourceTextOf(atom.span),
    sourceOffset: atom.sourceOffset,
    ...(atom.sourceText === undefined
      ? {}
      : {
          exact:
            atom.span.projected !== true &&
            atom.span.equation === undefined &&
            sourceTextOf(atom.span).length === atom.span.range.end - atom.span.range.start,
        }),
  };
}

export function markdownAtoms(segment: LineSegment): MarkdownAtom[] {
  const atoms: MarkdownAtom[] = [];
  for (const [index, span] of segment.spans.entries())
    atoms.push({ kind: 'span', start: span.range.start, order: index * 2 + 1, span });
  for (const [index, drawing] of segment.drawings.entries())
    atoms.push({ kind: 'drawing', start: drawing.start, order: index * 2, drawing });
  return atoms.sort((a, b) => a.start - b.start || a.order - b.order);
}

/** Insert anchors without modifying shared Core records or changing existing atom order. */
export function insertAnchors(
  atoms: readonly MarkdownAtom[],
  anchors: readonly AnchoredDrawingRecord[]
): readonly MarkdownAtom[] {
  if (!anchors.length) return atoms;
  const existing = new Set(
    atoms.flatMap((atom) =>
      atom.kind === 'drawing'
        ? [`${atom.drawing.ownerPartName}\0${atom.drawing.drawingNodeId}`]
        : []
    )
  );
  const pending = anchors.filter(
    (drawing) => !existing.has(`${drawing.ownerPartName}\0${drawing.drawingNodeId}`)
  );
  const result: MarkdownAtom[] = [];
  let next = 0;
  const emit = () => {
    const drawing = pending[next++]!;
    result.push({ kind: 'drawing', start: drawing.start, order: 0, drawing });
  };
  for (const atom of atoms) {
    while (next < pending.length && pending[next]!.start <= atom.start) emit();
    if (
      atom.kind !== 'span' ||
      atom.span.noteNav ||
      atom.span.equation ||
      atom.span.projected === true
    ) {
      result.push(atom);
      continue;
    }
    const text = atom.sourceText ?? sourceTextOf(atom.span);
    let offset = 0;
    while (next < pending.length && pending[next]!.start < atom.start + text.length) {
      const end = pending[next]!.start - atom.start;
      if (end > offset)
        result.push({
          ...atom,
          start: atom.start + offset,
          sourceText: text.slice(offset, end),
          sourceOffset: (atom.sourceOffset ?? 0) + offset,
        });
      emit();
      offset = end;
    }
    if (offset === 0) result.push(atom);
    else if (offset < text.length)
      result.push({
        ...atom,
        start: atom.start + offset,
        sourceText: text.slice(offset),
        sourceOffset: (atom.sourceOffset ?? 0) + offset,
      });
  }
  while (next < pending.length) emit();
  return result;
}

/** Merged revision paragraphs may contain several independent source-offset spaces. */
export function paragraphAtomsWithAnchors(
  atoms: readonly MarkdownAtom[],
  projection: AnchorProjection | undefined,
  emptyParagraphId: string
): readonly MarkdownAtom[] {
  if (!projection?.byParagraph.size) return atoms;
  if (!atoms.length) return insertAnchors(atoms, takeAnchors(projection, emptyParagraphId));
  const result: MarkdownAtom[] = [];
  let group: MarkdownAtom[] = [];
  let paragraphId = '';
  const flush = () => {
    result.push(...insertAnchors(group, takeAnchors(projection, paragraphId)));
    group = [];
  };
  for (const atom of atoms) {
    const nextId = atom.kind === 'span' ? atom.span.range.paragraphId : atom.drawing.paragraphId;
    if (group.length && paragraphId !== nextId) flush();
    paragraphId = nextId;
    group.push(atom);
  }
  flush();
  return result;
}
