import { paragraphFragmentsOfBlocks } from './semantic-records.ts';
import type {
  BlockFragmentRecord,
  LayoutBox,
  SemanticLayout,
  TableCellFragmentRecord,
} from './semantic-records.ts';
import type { CaretGeometry } from './semantic-interaction.ts';
import type { OoxmlElement } from '../store/package/ooxml-tree.ts';

/** Supported `w:textDirection` value, with horizontal layout as the safe default. */
export function readCellTextDirection(
  cellProperties: OoxmlElement | undefined
): 'horizontal' | 'btLr' {
  const node = cellProperties?.children.find(
    (child) => child.kind !== 'textValue' && child.localName === 'textDirection'
  );
  if (!node || node.kind === 'textValue') return 'horizontal';
  const value = node?.attributes.find((attribute) => attribute.localName === 'val')?.value;
  return value === 'btLr' ? 'btLr' : 'horizontal';
}

/** Furthest laid inline edge, excluding the unused width of paragraph line bands. */
export function blockInlineRight(blocks: readonly BlockFragmentRecord[], fallback: number): number {
  let right = fallback;
  for (const block of blocks) {
    if (block.kind === 'table') {
      right = Math.max(right, block.box.x + block.box.width);
      continue;
    }
    for (const line of block.lines) {
      right = Math.max(right, line.contentX);
      for (const span of line.spans) right = Math.max(right, span.box.x + span.box.width);
      for (const drawing of line.drawings ?? []) right = Math.max(right, drawing.advanceEnd);
    }
  }
  return right;
}

/** Map a sheet point into the horizontal local plane used to lay out `btLr` content. */
export function pointInBottomToTopCell(point: LayoutBoxPoint, cell: LayoutBox): LayoutBoxPoint {
  return {
    x: cell.x + cell.height - (point.y - cell.y),
    y: cell.y + (point.x - cell.x),
  };
}

interface BottomToTopCellLocation {
  readonly pageIndex: number;
  readonly cell: TableCellFragmentRecord;
}

const locationsByLayout = new WeakMap<
  SemanticLayout,
  ReadonlyMap<string, readonly BottomToTopCellLocation[]>
>();
const bottomToTopCarets = new WeakSet<CaretGeometry>();

function bottomToTopLocations(
  layout: SemanticLayout
): ReadonlyMap<string, readonly BottomToTopCellLocation[]> {
  const cached = locationsByLayout.get(layout);
  if (cached) return cached;
  const found = new Map<string, BottomToTopCellLocation[]>();
  const visit = (blocks: readonly BlockFragmentRecord[], pageIndex: number): void => {
    for (const block of blocks) {
      if (block.kind !== 'table') continue;
      for (const row of block.rows) {
        for (const cell of row.cells) {
          if (cell.textDirection === 'btLr') {
            for (const paragraph of paragraphFragmentsOfBlocks(cell.blocks)) {
              const locations = found.get(paragraph.paragraphId) ?? [];
              locations.push({ pageIndex, cell });
              found.set(paragraph.paragraphId, locations);
            }
          } else {
            visit(cell.blocks, pageIndex);
          }
        }
      }
    }
  };
  for (const page of layout.pages) {
    visit(page.fragments, page.index);
    if (page.header) visit(page.header.fragments, page.index);
    if (page.footer) visit(page.footer.fragments, page.index);
    for (const area of [page.footnotes, page.endnotes]) {
      if (!area) continue;
      if (area.separator) visit(area.separator.fragments, page.index);
      for (const note of area.notes) visit(note.fragments, page.index);
    }
  }
  locationsByLayout.set(layout, found);
  return found;
}

function locationFor(
  layout: SemanticLayout,
  pageIndex: number,
  paragraphId: string
): BottomToTopCellLocation | undefined {
  const locations = bottomToTopLocations(layout).get(paragraphId) ?? [];
  return locations.find((location) => location.pageIndex === pageIndex) ?? locations[0];
}

/** Rotate virtual horizontal caret geometry into its painted table-cell plane. */
export function bottomToTopCaretInLayout(
  layout: SemanticLayout,
  caret: CaretGeometry
): CaretGeometry {
  const location = locationFor(layout, caret.pageIndex, caret.position.paragraphId);
  if (!location) return caret;
  const point = pointFromBottomToTopCell(caret, location.cell.box);
  const transformed = { ...caret, ...point };
  bottomToTopCarets.add(transformed);
  return transformed;
}

/** Whether caret paint must follow the `btLr` plane used for its geometry. */
export function isBottomToTopCaret(caret: CaretGeometry): boolean {
  return bottomToTopCarets.has(caret);
}

/** Rotate one virtual selection band into page-content coordinates. */
export function bottomToTopRectInLayout<T extends LayoutBox & { readonly pageIndex: number }>(
  layout: SemanticLayout,
  paragraphId: string,
  rect: T
): T {
  const location = locationFor(layout, rect.pageIndex, paragraphId);
  if (!location) return rect;
  const cell = location.cell.box;
  return {
    ...rect,
    x: cell.x + (rect.y - cell.y),
    y: cell.y + cell.height - (rect.x - cell.x) - rect.width,
    width: rect.height,
    height: rect.width,
  };
}

function pointFromBottomToTopCell(point: LayoutBoxPoint, cell: LayoutBox): LayoutBoxPoint {
  return {
    x: cell.x + (point.y - cell.y),
    y: cell.y + cell.height - (point.x - cell.x),
  };
}

export interface LayoutBoxPoint {
  readonly x: number;
  readonly y: number;
}
