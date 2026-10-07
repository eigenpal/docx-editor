import { fragmentParagraphs } from '../layout/line-segments.ts';
import type {
  BlockFragmentRecord,
  PageRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
} from '../layout/semantic-records.ts';

interface Entry {
  readonly fragment: ParagraphFragmentRecord;
  readonly indent: {
    readonly indent: ParagraphFragmentRecord['indent'];
    readonly inTable: boolean;
  };
  readonly emptyStyle: ParagraphFragmentRecord['emptyParagraphStyle'];
}
const byPage = new WeakMap<PageRecord, ReadonlyMap<string, Entry>>();
const byLayout = new WeakMap<SemanticLayout, { entries: Map<string, Entry>; nextPage: number }>();

function eachParagraphFragmentOnPage(
  page: PageRecord,
  visit: (fragment: ParagraphFragmentRecord, inTable: boolean) => void
): void {
  const walk = (blocks: readonly BlockFragmentRecord[], inTable: boolean): void => {
    for (const block of blocks) {
      if (block.kind === 'paragraph') {
        visit(block, inTable);
        continue;
      }
      for (const row of block.rows) {
        if (row.isHeaderRepeat) continue;
        for (const cell of row.cells) walk(cell.blocks, true);
      }
    }
  };
  walk(page.fragments, false);
  if (page.header) walk(page.header.fragments, false);
  if (page.footer) walk(page.footer.fragments, false);
  for (const area of [page.footnotes, page.endnotes]) {
    if (!area) continue;
    for (const note of area.notes) walk(note.fragments, false);
  }
}

function pageEntries(page: PageRecord): ReadonlyMap<string, Entry> {
  const known = byPage.get(page);
  if (known) return known;
  const entries = new Map<string, Entry>();
  eachParagraphFragmentOnPage(page, (fragment, inTable) => {
    const entry: Entry = {
      fragment,
      indent: { indent: fragment.indent, inTable },
      emptyStyle: fragment.emptyParagraphStyle,
    };
    for (const id of fragmentParagraphs(fragment)) mergeEntry(entries, id, entry);
  });
  byPage.set(page, entries);
  return entries;
}

function mergeEntry(entries: Map<string, Entry>, id: string, next: Entry): void {
  const previous = entries.get(id);
  if (!previous) entries.set(id, next);
  else if (!previous.emptyStyle && next.emptyStyle)
    entries.set(id, { ...previous, emptyStyle: next.emptyStyle });
}

/** Share one immutable paragraph index across all formatting reads and editable stories. */
export function paragraphFormattingEntry(
  layout: SemanticLayout,
  id: string,
  requireEmptyStyle = false
): Entry | undefined {
  let state = byLayout.get(layout);
  if (!state) {
    state = { entries: new Map(), nextPage: 0 };
    byLayout.set(layout, state);
  }
  const ready = (): Entry | undefined => {
    const entry = state.entries.get(id);
    return entry && (!requireEmptyStyle || entry.emptyStyle) ? entry : undefined;
  };
  let entry = ready();
  // Load each page at most once, stopping when this read has its answer. A caret read
  // must not build formatting maps for every later page in a long document.
  while (!entry && state.nextPage < layout.pages.length) {
    for (const [id, next] of pageEntries(layout.pages[state.nextPage++]!))
      mergeEntry(state.entries, id, next);
    entry = ready();
  }
  return entry ?? state.entries.get(id);
}
