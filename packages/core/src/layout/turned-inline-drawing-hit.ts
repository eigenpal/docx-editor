// The turned inline shapes a press can reach outside their own line. An inline shape turns
// about the centre of its extent and paints over the lines around it, so a press on that
// painted part is on the shape, though the line under the pointer is another one.

import type { InlineDrawingRecord } from './drawing-layout.ts';
import type {
  BlockFragmentRecord,
  LineRecord,
  TableCellFragmentRecord,
  TableFragmentRecord,
  TableRowFragmentRecord,
} from './semantic-records.ts';

/** A turned inline shape with the line it sits on and the innermost cell holding it. */
export interface TurnedInlineDrawing {
  readonly drawing: InlineDrawingRecord;
  readonly line: LineRecord;
  readonly cell: {
    readonly table: TableFragmentRecord;
    readonly row: TableRowFragmentRecord;
    readonly cell: TableCellFragmentRecord;
  } | null;
}

/** Fragment lists are immutable records, so one walk per published page list serves every press. */
const turnedCache = new WeakMap<readonly BlockFragmentRecord[], readonly TurnedInlineDrawing[]>();

/** Every turned inline shape on `fragments`, in paint order (later ones paint on top). */
export function turnedInlineDrawings(
  fragments: readonly BlockFragmentRecord[]
): readonly TurnedInlineDrawing[] {
  const cached = turnedCache.get(fragments);
  if (cached) return cached;
  const found: TurnedInlineDrawing[] = [];
  const walk = (blocks: readonly BlockFragmentRecord[], cell: TurnedInlineDrawing['cell']) => {
    for (const block of blocks) {
      if (block.kind === 'paragraph') {
        for (const line of block.lines) {
          for (const drawing of line.drawings ?? []) {
            if (drawing.vectorShape?.rotationDegrees) found.push({ drawing, line, cell });
          }
        }
        continue;
      }
      for (const row of block.rows) {
        for (const inner of row.cells) walk(inner.blocks, { table: block, row, cell: inner });
      }
    }
  };
  walk(fragments, null);
  const frozen = Object.freeze(found);
  turnedCache.set(fragments, frozen);
  return frozen;
}

/** The topmost turned inline shape whose painted geometry `reaches` the point, if any. */
export function turnedInlineDrawingAt(
  fragments: readonly BlockFragmentRecord[],
  reaches: (drawing: InlineDrawingRecord) => boolean
): TurnedInlineDrawing | null {
  const drawings = turnedInlineDrawings(fragments);
  for (let index = drawings.length - 1; index >= 0; index -= 1) {
    if (reaches(drawings[index]!.drawing)) return drawings[index]!;
  }
  return null;
}
