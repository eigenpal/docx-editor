// Reusing layout across a renumbering edit.
//
// Inserting a list item renumbers every later item of the list. When each new number is as
// wide as the old one ("[0003]" for "[0002]"), nothing a line break or a placement reads has
// moved: the marker occupies the same slot and the first line starts at the same place. Only
// the label differs. Keying those blocks on the marker TEXT made every later item a changed
// block, so a single Enter near the top of a long numbered list laid the rest of the list out
// again.
//
// For the editor's body lists, the layout keys therefore read the marker's measured GEOMETRY
// instead of its text, and the published records get their labels from the current list
// items afterwards. A number whose width moves still changes the key and is laid out again.

import { framedTokenJoin } from './framed-token.ts';
import { rtlListMarkerPieces } from './list-marker-bidi.ts';
import { listMarkerWidth } from './list-marker-geometry.ts';
import type { ResolvedListItem } from './list-resolve.ts';
import type {
  BlockFragmentRecord,
  ListMarkerRecord,
  PageRecord,
  SemanticLayout,
  TextMeasurer,
} from './semantic-records.ts';

/** Each item's `cacheToken` without its marker text; recorded where the token is built. */
const shapeTokens = new WeakMap<ResolvedListItem, string>();

/** Record the parts of `item`'s cache token that are not the marker text. */
export function rememberListItemShape(item: ResolvedListItem, shapeToken: string): void {
  shapeTokens.set(item, shapeToken);
}

const geometryTokens = new WeakMap<
  ResolvedListItem,
  { readonly measurer: TextMeasurer; readonly token: string }
>();

/**
 * Key every item of `listItems` on its marker geometry under `measurer`.
 *
 * Called once per layout pass, before anything reads {@link listLayoutToken}, so a token
 * always describes the measurer of the pass that reads it. A picture marker keeps its text
 * token: its slot comes from the image, and nothing here relabels one.
 */
export function registerListGeometry(
  listItems: ReadonlyMap<string, ResolvedListItem> | undefined,
  measurer: TextMeasurer | undefined
): void {
  if (!listItems || !measurer) return;
  for (const item of listItems.values()) {
    if (item.picBullet || geometryTokens.get(item)?.measurer === measurer) continue;
    const shape = shapeTokens.get(item);
    if (shape === undefined) continue;
    const ascent =
      item.markerText.length > 0 && !item.markerStyle.hidden
        ? measurer.lineMetrics(item.markerStyle, item.markerText).baseline
        : 0;
    const width = listMarkerWidth(item, measurer);
    geometryTokens.set(item, {
      measurer,
      token: framedTokenJoin(['geometry', shape, String(width), String(ascent)]),
    });
  }
}

/** The token layout keys read for `item`: its geometry when registered, else `cacheToken`. */
export function listLayoutToken(item: ResolvedListItem): string {
  return geometryTokens.get(item)?.token ?? item.cacheToken;
}

/** The marker part of a block's flow key: its {@link listLayoutToken}, or none. */
export function markerFlowToken(item: ResolvedListItem | undefined): string | undefined {
  return item && listLayoutToken(item);
}

/** {@link listLayoutToken}, or `''` for a paragraph with no list item. */
export function listItemToken(item: ResolvedListItem | undefined): string {
  return item ? listLayoutToken(item) : '';
}

function relabeledMarker(
  marker: ListMarkerRecord,
  item: ResolvedListItem,
  measurer: TextMeasurer
): ListMarkerRecord {
  if (marker.picture || (marker.text === item.markerText && marker.ordinal === item.ordinal)) {
    return marker;
  }
  const { ordinal: _ordinal, pieces, ...rest } = marker;
  const nextPieces = pieces
    ? rtlListMarkerPieces(item.markerText, item.markerStyle, marker.box, measurer)
    : undefined;
  return {
    ...rest,
    text: item.markerText,
    ...(item.ordinal === undefined ? {} : { ordinal: item.ordinal }),
    ...(nextPieces ? { pieces: nextPieces } : {}),
  };
}

function relabeledBlocks(
  blocks: readonly BlockFragmentRecord[],
  listItems: ReadonlyMap<string, ResolvedListItem>,
  measurer: TextMeasurer
): readonly BlockFragmentRecord[] {
  let next: BlockFragmentRecord[] | null = null;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    let replaced: BlockFragmentRecord = block;
    if (block.kind === 'paragraph') {
      const item = block.marker ? listItems.get(block.paragraphId) : undefined;
      const marker = item && block.marker ? relabeledMarker(block.marker, item, measurer) : null;
      if (marker && marker !== block.marker) replaced = { ...block, marker };
    } else {
      let rows: (typeof block.rows)[number][] | null = null;
      for (let rowIndex = 0; rowIndex < block.rows.length; rowIndex += 1) {
        const row = block.rows[rowIndex]!;
        let cells: (typeof row.cells)[number][] | null = null;
        for (let cellIndex = 0; cellIndex < row.cells.length; cellIndex += 1) {
          const cell = row.cells[cellIndex]!;
          const cellBlocks = relabeledBlocks(cell.blocks, listItems, measurer);
          if (cellBlocks === cell.blocks) continue;
          cells ??= [...row.cells];
          cells[cellIndex] = { ...cell, blocks: cellBlocks };
        }
        if (!cells) continue;
        rows ??= [...block.rows];
        rows[rowIndex] = { ...row, cells };
      }
      if (rows) replaced = { ...block, rows };
    }
    if (replaced === block) continue;
    next ??= [...blocks];
    next[index] = replaced;
  }
  return next ?? blocks;
}

/** Per page object: the list items it was last checked against, and the result. */
const relabeledPages = new WeakMap<
  PageRecord,
  { readonly listItems: ReadonlyMap<string, ResolvedListItem>; readonly page: PageRecord }
>();

/**
 * `layout` with every body list marker labelled from `listItems`.
 *
 * Returns `layout` itself when no label moved. A page that needs no change keeps its identity,
 * and a page already checked against the same list items is not walked again, so an edit that
 * renumbers nothing costs one lookup per page.
 */
export function relabelListMarkers(
  layout: SemanticLayout,
  listItems: ReadonlyMap<string, ResolvedListItem> | undefined,
  measurer: TextMeasurer | undefined
): SemanticLayout {
  if (!listItems || listItems.size === 0 || !measurer) return layout;
  let pages: PageRecord[] | null = null;
  for (let index = 0; index < layout.pages.length; index += 1) {
    const page = layout.pages[index]!;
    const known = relabeledPages.get(page);
    let next: PageRecord;
    if (known?.listItems === listItems) {
      next = known.page;
    } else {
      const fragments = relabeledBlocks(page.fragments, listItems, measurer);
      next = fragments === page.fragments ? page : { ...page, fragments };
      relabeledPages.set(page, { listItems, page: next });
      if (next !== page) relabeledPages.set(next, { listItems, page: next });
    }
    if (next === page) continue;
    pages ??= [...layout.pages];
    pages[index] = next;
  }
  return pages ? { ...layout, pages } : layout;
}
