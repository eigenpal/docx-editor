// Formatting queries over the published layout (paginated-surface seam).
//
// This module owns what a toolbar reads and what a formatting command merges against:
// the agreement-based formatting snapshot, run/paragraph property lookups indexed per
// layout, and the merge rule for property containers. The READS are pure functions of
// (layout, selection); the WRITE inputs — what a paragraph, a run or a paragraph mark
// itself authors — come from the canonical tree, because the layout knows only the
// flattened cascade.

import {
  documentOrder,
  paragraphsInCells,
  spansInCells,
  spansInSelection,
  type BlockFragmentRecord,
  type PageRecord,
  type ParagraphFragmentRecord,
  type ParagraphIndent,
  type SemanticLayout,
  type SemanticSelection,
  type StyleSpanRecord,
} from '@docx-editor.dev/core/layout';
import {
  AUTHORABLE_RUN_PROPERTIES,
  authoredProperties,
  directParagraphMarkProperties,
  findNode,
  formatOwnedRunIds,
  mergedProperties,
  propertyContainer,
  runAddressRanges,
  type OoxmlNode,
  type OoxmlPart,
  type RunPropertyEdit,
} from '@docx-editor.dev/core/store';
import { mergedMultiSettingProperty } from '@docx-editor.dev/core/store';
import { walkParagraphInline } from '../store/package/content-control-walk.ts';
import type { SurfaceFormatting } from './paginated-surface-contract.ts';
import { lineSegments } from '../layout/line-segments.ts';
import { paragraphAlignment } from '../layout/paragraph-flow.ts';
import { cascadedParagraphAttributes } from '../layout/paragraph-style.ts';

/** One property as the ops and the layout records carry it: an element name plus attributes. */
export interface SurfaceProperty {
  readonly localName: string;
  readonly attributes?: Record<string, string>;
}

/**
 * Every paragraph fragment the layout publishes, in EVERY story the caret can reach.
 *
 * `layout.pages[].fragments` is the BODY. Headers, footers, footnotes and endnotes are
 * editable scopes of their own (`enterHeaderFooter`, `enterNote`), and a paragraph index
 * built from the body alone answers nothing for a caret inside one — so the toolbar read
 * defaults over a centred header and Increase Indent stepped from an indent of zero,
 * moving header text BACKWARDS. `paragraphLinesIndex` already walks the same four stories
 * for exactly this reason; these two indexes did not.
 *
 * Header-repeat rows are skipped: a repeated row is the SAME paragraph drawn again, and it
 * carries the header row's properties rather than its own.
 *
 * `inTable` rides along because it is the ruler's gate and this is the walk that knows it.
 */
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

/**
 * Record one paragraph under EVERY id it is drawn for: its own, and every member of a
 * merged run laid out under it.
 *
 * A resolved view draws a run of paragraphs as one fragment under the survivor's name, and
 * each member is being shown with that fragment's properties — so each has to be reachable
 * by them. First-wins, so a continuation fragment on a later page never displaces the one
 * that opened the paragraph.
 */
function recordFragment<T>(
  index: Map<string, T>,
  fragment: ParagraphFragmentRecord,
  value: T
): void {
  if (!index.has(fragment.paragraphId)) index.set(fragment.paragraphId, value);
  for (const line of fragment.lines) {
    for (const segment of lineSegments(line)) {
      if (!index.has(segment.paragraphId)) index.set(segment.paragraphId, value);
    }
  }
}

/**
 * Paragraph properties by paragraph id, one map per published layout.
 *
 * Weakly keyed on the layout because a layout is immutable: a new revision is a new
 * object, and superseded revisions release their index with the records.
 */
const fragmentPropsByLayout = new WeakMap<
  SemanticLayout,
  Map<string, readonly SurfaceProperty[]>
>();

/**
 * One page's contribution to that index, remembered on the PAGE record.
 *
 * A page that layout does not touch keeps its record identity across revisions, so a
 * keystroke walks the lines of one page instead of every page in the document. The map above
 * is still rebuilt per layout, because a paragraph can move between pages.
 */
const fragmentPropsByPage = new WeakMap<
  PageRecord,
  ReadonlyMap<string, readonly SurfaceProperty[]>
>();

function pageProps(page: PageRecord): ReadonlyMap<string, readonly SurfaceProperty[]> {
  const cached = fragmentPropsByPage.get(page);
  if (cached) return cached;
  const props = new Map<string, readonly SurfaceProperty[]>();
  eachParagraphFragmentOnPage(page, (fragment) => recordFragment(props, fragment, fragment.props));
  fragmentPropsByPage.set(page, props);
  return props;
}

/**
 * A paragraph's CASCADED properties, read back from the layout records.
 *
 * `w:docDefaults` + the style chain + direct formatting, flattened: what the paragraph
 * LOOKS like, which is the right answer for a toolbar and the wrong one for an op —
 * `directParagraphProperties` is what a write merges against.
 */
export function paragraphPropertiesOf(
  layout: SemanticLayout,
  paragraphId: string
): readonly SurfaceProperty[] {
  // Indexed per layout: the host reads formatting after every commit, and scanning all
  // pages for one paragraph's `w:pPr` projection made that read O(document).
  let index = fragmentPropsByLayout.get(layout);
  if (!index) {
    index = new Map();
    for (const page of layout.pages) {
      for (const [id, props] of pageProps(page)) {
        if (!index.has(id)) index.set(id, props);
      }
    }
    fragmentPropsByLayout.set(layout, index);
  }
  return index.get(paragraphId) ?? [];
}

/** A paragraph's effective indent, plus whether it sits inside a table. */
export interface ParagraphIndentEntry {
  readonly indent: ParagraphIndent;
  readonly inTable: boolean;
}

const fragmentIndentByLayout = new WeakMap<SemanticLayout, Map<string, ParagraphIndentEntry>>();

/** One page's indents, on the page record, for the same reason {@link pageProps} is. */
const fragmentIndentByPage = new WeakMap<PageRecord, ReadonlyMap<string, ParagraphIndentEntry>>();

function pageIndents(page: PageRecord): ReadonlyMap<string, ParagraphIndentEntry> {
  const cached = fragmentIndentByPage.get(page);
  if (cached) return cached;
  const indents = new Map<string, ParagraphIndentEntry>();
  eachParagraphFragmentOnPage(page, (fragment, inTable) =>
    recordFragment(indents, fragment, { indent: fragment.indent, inTable })
  );
  fragmentIndentByPage.set(page, indents);
  return indents;
}

/**
 * A paragraph's EFFECTIVE indent — cascade plus the numbering merge — from the layout
 * records, or null for a paragraph the published layout does not carry.
 *
 * Not derivable from {@link paragraphPropertiesOf}: a list paragraph's indent comes from
 * `numbering.xml` and is merged in after the cascade, so a numbered item authoring no
 * `w:ind` reads zero there while its text sits indented.
 *
 * Table membership rides along because it is the ruler's gate, and this is the one walk
 * that already knows it.
 */
export function paragraphIndentOf(
  layout: SemanticLayout,
  paragraphId: string
): ParagraphIndentEntry | null {
  let index = fragmentIndentByLayout.get(layout);
  if (!index) {
    const built = new Map<string, ParagraphIndentEntry>();
    for (const page of layout.pages) {
      for (const [id, entry] of pageIndents(page)) {
        if (!built.has(id)) built.set(id, entry);
      }
    }
    index = built;
    fragmentIndentByLayout.set(layout, built);
  }
  return index.get(paragraphId) ?? null;
}

/*
 * What a node itself AUTHORS, and how a property write splits per run, live in the store lane
 * (`store/direct-properties.ts`): the automation lane's object model writes formatting on a
 * server with no layout in it, and it must reach the same answers this lane's toolbar does. They
 * are re-exported here under the names the editor lane already used.
 */
export {
  authoredProperties,
  directParagraphMarkProperties,
  directParagraphProperties,
  isAuthorableRunProperty,
  mergedProperties,
  propertyContainer,
  runAddressRanges,
  type RunPropertyEdit,
} from '@docx-editor.dev/core/store';

/**
 * Surface range formatting uses the shared authored-property model while retaining v2's
 * content-control-aware inline walk. The automation lane consumes the same store primitives;
 * this wrapper is only the layout-backed surface traversal.
 */
export function runPropertyEdits(
  part: OoxmlPart,
  paragraphId: string,
  start: number,
  end: number,
  incoming: SurfaceProperty
): readonly RunPropertyEdit[] {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return [];
  const edits: RunPropertyEdit[] = [];
  const runRanges = runAddressRanges(paragraph);
  const formatOwned = formatOwnedRunIds(paragraph);
  walkParagraphInline(paragraph.children, 0, (child) => {
    if (child.kind !== 'run') return;
    const range = runRanges.get(child.id);
    if (!range || range.end <= range.start) return;
    const from = Math.max(range.start, start);
    const to = Math.min(range.end, end);
    if (from >= to) return;
    const authored = authoredProperties(
      propertyContainer(child, 'runProperties', 'rPr'),
      AUTHORABLE_RUN_PROPERTIES
    );
    edits.push({
      start: from,
      end: to,
      // Merged per attribute for the two run properties carrying several independent
      // settings, the same rule the store lane's own walk applies — see
      // `mergedMultiSettingProperty`.
      properties: mergedProperties(authored, mergedMultiSettingProperty(authored, incoming)),
      ...(formatOwned.has(child.id) ? { targetRunIds: [child.id] } : {}),
    });
  });
  return edits;
}

/**
 * Whether any run the range covers authors a property an op could clear.
 *
 * The eraser's "is there anything here to erase" question. Asked because an op that names
 * nothing still COUNTS as applied: the store publishes a revision and pushes an undo entry
 * for it even though the tree comes back identical, so pressing Clear Formatting on already
 * clean text reported `changed: true` and cost an undo press that undid nothing.
 *
 * Walks exactly where `runPropertyEdits` walks, so the two can never disagree about which
 * runs a range covers.
 */
export function hasAuthoredRunProperties(
  part: OoxmlPart,
  paragraphId: string,
  start: number,
  end: number
): boolean {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return false;
  const runRanges = runAddressRanges(paragraph);
  let found = false;
  const visitRun = (child: OoxmlNode): void => {
    if (found) return;
    if (child.kind !== 'run') return;
    const range = runRanges.get(child.id);
    if (!range || range.end <= range.start) return;
    if (Math.max(range.start, start) >= Math.min(range.end, end)) return;
    if (
      authoredProperties(
        propertyContainer(child, 'runProperties', 'rPr'),
        AUTHORABLE_RUN_PROPERTIES
      ).length > 0
    ) {
      found = true;
    }
  };
  walkParagraphInline(paragraph.children, 0, visitRun);
  return found;
}

/**
 * What a run at the CARET itself authors — the base pending caret formatting merges over.
 *
 * Word's rule for a collapsed caret: the character typed next takes the formatting of the
 * run to the caret's LEFT; at the very start of a paragraph it takes the run to the right;
 * in an empty paragraph it takes the paragraph mark's own `w:rPr`. The same authored-only
 * narrowing as every other write base applies — echoing the cascade would freeze inherited
 * formatting as direct.
 */
export function authoredRunPropertiesAt(
  part: OoxmlPart,
  paragraphId: string,
  offset: number
): readonly SurfaceProperty[] {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return [];
  const runRanges = runAddressRanges(paragraph);
  let left: OoxmlNode | null = null;
  let right: OoxmlNode | null = null;
  const visitRun = (child: OoxmlNode): void => {
    if (child.kind !== 'run') return;
    const range = runRanges.get(child.id);
    if (!range || range.end <= range.start) return;
    if (range.start < offset && offset <= range.end) left = child;
    if (right === null && range.start <= offset && offset < range.end) right = child;
  };
  walkParagraphInline(paragraph.children, 0, visitRun);
  const owner = left ?? right;
  if (owner) {
    return authoredProperties(
      propertyContainer(owner, 'runProperties', 'rPr'),
      AUTHORABLE_RUN_PROPERTIES
    );
  }
  // No addressable run at all: an empty paragraph, whose mark is what Word reads.
  return directParagraphMarkProperties(part, paragraphId);
}

/**
 * Whether a PENDING property list holds `localName` in its ON state, or `null` when the
 * list does not speak to it. The off spellings mirror what `toggleRunProperty` writes:
 * `val="0"` for the boolean toggles, `val="none"` for `w:u` (a closed enumeration).
 */
export function pendingPropertyState(
  pending: readonly SurfaceProperty[] | null,
  localName: string,
  /** The value being toggled, for a property whose ON state is one member of an
   *  enumeration rather than a boolean (`w:vertAlign`). */
  value?: string
): boolean | null {
  const entry = pending?.find((property) => property.localName === localName);
  if (!entry) return null;
  const val = entry.attributes?.val;
  // `w:vertAlign` armed as `superscript` says NOTHING about whether subscript is on — it
  // says subscript is off. Comparing presence alone made pressing Subscript over an armed
  // superscript read as "already on" and write `baseline`, so the press did the opposite of
  // its label.
  if (localName === 'vertAlign') return val === value;
  if (localName === 'u') return val !== 'none';
  // ST_OnOff's full off vocabulary (17.17.4): `0`, `false` and `off` all mean off, and the
  // read lane treats them alike. Listing only the two this module WRITES would let a host
  // arming `val="off"` directly see a toolbar pressed over text that renders unformatted.
  return val !== '0' && val !== 'false' && val !== 'off' && val !== 'none';
}

/**
 * The formatting snapshot with PENDING caret formatting laid over it, so the toolbar
 * reflects what the next character typed will look like — Word's rule while a stored
 * format is armed. Only the fields pending properties can express are touched; everything
 * else answers from the document.
 */
export function withPendingFormatting(
  formatting: SurfaceFormatting,
  pending: readonly SurfaceProperty[] | null
): SurfaceFormatting {
  if (!pending || pending.length === 0) return formatting;
  let next = formatting;
  for (const property of pending) {
    const val = property.attributes?.val;
    switch (property.localName) {
      case 'b':
        next = { ...next, bold: pendingPropertyState(pending, 'b') === true };
        break;
      case 'i':
        next = { ...next, italic: pendingPropertyState(pending, 'i') === true };
        break;
      case 'u':
        next = { ...next, underline: pendingPropertyState(pending, 'u') === true };
        break;
      case 'strike':
        next = { ...next, strikethrough: pendingPropertyState(pending, 'strike') === true };
        break;
      case 'vertAlign':
        next = {
          ...next,
          superscript: val === 'superscript',
          subscript: val === 'subscript',
        };
        break;
      case 'rFonts':
        next = { ...next, fontFamily: property.attributes?.ascii ?? next.fontFamily };
        break;
      case 'sz': {
        const halfPoints = Number(val);
        if (Number.isFinite(halfPoints)) next = { ...next, fontSizeHalfPoints: halfPoints };
        break;
      }
      case 'color':
        next = { ...next, color: val === 'auto' ? null : (val ?? next.color) };
        break;
      case 'highlight':
        next = { ...next, highlight: val === 'none' ? null : (val ?? next.highlight) };
        break;
      default:
        break;
    }
  }
  return next;
}

/**
 * The spans a selection covers, whichever kind of selection it is.
 *
 * A rectangle of table cells is NOT the text range it stands in for: rows one and two of
 * column one, read as a range, sweep through every cell between them, so a toolbar would
 * report the formatting of cells the user never selected. Reading the cells directly is the
 * only difference cell selection makes to any of these queries.
 */
function selectionSpans(
  layout: SemanticLayout,
  selection: SemanticSelection,
  cells?: readonly string[]
): readonly StyleSpanRecord[] {
  return cells && cells.length > 0
    ? spansInCells(layout, cells)
    : spansInSelection(layout, selection);
}

/** The run properties in force across the selection, taken from its first span. */
export function selectionRunProperties(
  layout: SemanticLayout,
  selection: SemanticSelection,
  cells?: readonly string[]
): readonly SurfaceProperty[] {
  return selectionSpans(layout, selection, cells)[0]?.props ?? [];
}

/**
 * Whether a run property is already set across the WHOLE selection.
 *
 * Word's rule, and the one that makes a toggle feel right: a partly-bold selection goes
 * fully bold on the first press rather than clearing the bold that is there.
 */
export function isRunPropertyActive(
  layout: SemanticLayout,
  selection: SemanticSelection,
  localName: string,
  cells?: readonly string[],
  /** The value being toggled, for a property whose ON state is one member of an
   *  enumeration rather than a boolean (`w:vertAlign`). */
  value?: string
): boolean {
  const spans = selectionSpans(layout, selection, cells);
  if (spans.length === 0) return false;
  const flagOf = (span: (typeof spans)[number]): boolean => {
    switch (localName) {
      case 'b':
        return span.style.bold;
      case 'i':
        return span.style.italic;
      case 'u':
        return span.style.underline !== null;
      case 'strike':
        return span.style.strike;
      case 'vertAlign':
        // Its OWN value, not "is raised or lowered at all". Presence alone would make
        // Subscript over superscripted text read as already on, so the press would write
        // `baseline` and un-raise the text instead of lowering it.
        return span.style.verticalAlign === value;
      default:
        // Every toggleable mark MUST be listed: answering false for one that is
        // active makes its toggle re-apply forever instead of clearing.
        return false;
    }
  };
  return spans.every(flagOf);
}

/**
 * The run defaults a paragraph's content inherits, injected by the surface (a session
 * derivation over the styles and theme parts — this module never reads those trees).
 */
export type InheritedRunDefaults = (
  paragraphId: string,
  runProperties: readonly SurfaceProperty[]
) => { readonly fontFamily: string | null; readonly fontSizeHalfPoints: number | null };

/** The formatting snapshot at a selection, for a toolbar to reflect. */
export function formattingAt(
  layout: SemanticLayout,
  selection: SemanticSelection,
  inherited?: InheritedRunDefaults,
  cells?: readonly string[],
  /**
   * `w:style[@w:default='1'][@w:type='paragraph']` — the style a paragraph that names none
   * is actually written in. Word's style box shows THAT (normally "Normal"), not a blank:
   * "no `w:pStyle`" is a statement about the file, not about what the user is looking at.
   */
  defaultParagraphStyleId?: string | null
): SurfaceFormatting {
  const spans = selectionSpans(layout, selection, cells);
  const styles = spans.map((span) => span.style);
  // Agreement across the WHOLE selection, or nothing. A collapsed caret yields the one
  // span beside it (Word's rule), so the toolbar reflects the run the user is typing in.
  const agreed = <T>(pick: (style: (typeof styles)[number]) => T): T | null => {
    if (styles.length === 0) return null;
    const first = pick(styles[0]!);
    return styles.every((style) => pick(style) === first) ? first : null;
  };
  const agreedOver = <T>(values: readonly T[]): T | null =>
    values.length > 0 && values.every((value) => value === values[0]) ? values[0]! : null;

  // Font family and size answer the EFFECTIVE value, the way Word's boxes do: a span
  // without a direct `w:rFonts`/`w:sz` falls back to what it inherits (style chain,
  // docDefaults, theme fonts). A caret in an empty paragraph inherits too.
  const hasDirect = (span: (typeof spans)[number], localName: string): boolean =>
    span.props.some((property) => property.localName === localName);
  const familyOf = (span: (typeof spans)[number]): string | null =>
    span.style.fontFamily ?? inherited?.(span.range.paragraphId, span.props).fontFamily ?? null;
  const sizeOf = (span: (typeof spans)[number]): number =>
    hasDirect(span, 'sz')
      ? Math.round(span.style.fontSizePt * 2)
      : (inherited?.(span.range.paragraphId, span.props).fontSizeHalfPoints ??
        Math.round(span.style.fontSizePt * 2));
  const caretInherited =
    spans.length === 0 ? inherited?.(selection.head.paragraphId, []) : undefined;

  // Paragraph-level values answer for EVERY paragraph the selection touches — the same
  // span `setParagraphProperty` writes over. Reading only `selection.head` made the
  // alignment control depend on the DIRECTION the user dragged: a centred paragraph
  // selected together with a left one showed Centre pressed one way and Left the other,
  // and pressing either was a change to both. Word shows none of the four pressed.
  const touchedParagraphs = paragraphsTouched(layout, selection, cells);
  const paragraphValue = <T>(read: (properties: readonly SurfaceProperty[]) => T): T | null =>
    agreedOver(touchedParagraphs.map((id) => read(paragraphPropertiesOf(layout, id))));
  // Normalized BEFORE agreement: `w:jc` absent and `w:jc val="left"` are the same
  // alignment, and comparing the raw attribute would call them a mixed selection.
  //
  // Read through the LAYOUT's own resolver, so the pressed button and the painted line can
  // never disagree about the same paragraph. It also folds the cascade the way a cascade has
  // to be folded — see `cascadedParagraphAttributes`.
  const alignment = paragraphValue((properties) => paragraphAlignment(properties));
  // Resolved per paragraph BEFORE agreement, so a styled paragraph selected together with
  // an unstyled one still reads as mixed (two different styles), while an unstyled
  // paragraph on its own reports the default rather than nothing. Comparing raw `w:pStyle`
  // presence conflated "the selection disagrees" with "this paragraph states no style" and
  // showed a generic placeholder over a paragraph whose style the menu listed by name —
  // with the tick beside none of the rows.
  const style =
    paragraphValue(
      (properties) =>
        cascadedParagraphAttributes(properties, 'pStyle')?.val ??
        defaultParagraphStyleId ??
        undefined
    ) ?? null;
  // `w:spacing` carries three independent things, so they are read as three: the line rule
  // and its value, and the space before/after. All in the vocabulary a toolbar shows —
  // LINES for a multiple, points for everything else — because 276 twentieths and 276
  // 240ths are the same attribute meaning two different quantities, and a control that
  // showed the raw number would be right half the time.
  const spacing = (properties: readonly SurfaceProperty[]) =>
    cascadedParagraphAttributes(properties, 'spacing') ?? undefined;
  const lineSpacingText = paragraphValue((properties) => {
    const attributes = spacing(properties);
    const line = Number(attributes?.line);
    if (!Number.isFinite(line)) return '';
    // `w:lineRule` defaults to `auto` (17.3.1.33), which is Word's "Multiple".
    const rule = attributes?.lineRule ?? 'auto';
    if (rule === 'auto') return `multiple:${Math.round((line / 240) * 100) / 100}`;
    return `${rule === 'exact' ? 'exact' : 'atLeast'}:${Math.round((line / 20) * 100) / 100}`;
  });
  const lineSpacing = ((): SurfaceFormatting['lineSpacing'] => {
    if (!lineSpacingText) return null;
    const [rule, value] = lineSpacingText.split(':');
    return { rule: rule as 'multiple' | 'exact' | 'atLeast', value: Number(value) };
  })();
  // The gap the cascade states, in points, or null when no level states it.
  //
  // The MEASUREMENT, not the resolved gap: `w:beforeAutospacing` replaces the twips beside
  // it with Word's auto value, and resolving that here needs to know whether the paragraph
  // is in a list or a cell — two answers only the layout holds, and guessing either one
  // makes the control disagree with the page it sits above. The measurement is the honest
  // answer, and it is the same answer for the one question asked of it today: Word writes
  // `w:before="100"` beside the flag, so an auto-spaced paragraph reads non-zero and the
  // menu offers Remove, as Word's does.
  const spacePt = (attribute: 'before' | 'after') =>
    paragraphValue((properties) => {
      const raw = Number(spacing(properties)?.[attribute]);
      return Number.isFinite(raw) ? Math.round((raw / 20) * 100) / 100 : null;
    });
  // Indent does NOT go null on disagreement, unlike everything above it: the values are the
  // FIRST touched paragraph's and `mixed` reports the rest per field. A ruler has to draw
  // its handles somewhere, and hiding them for Select All — the commonest indent gesture —
  // is worse than showing the first paragraph's truth, which is what Word shows.
  const indent = ((): SurfaceFormatting['indent'] => {
    const entries = touchedParagraphs.map((id) => paragraphIndentOf(layout, id));
    const first = entries[0];
    if (!first) return null;
    // Inside a table the value is correct but unplaceable: it is measured from the cell's
    // content edge, and a ruler drawn against the page margin does not know the cell.
    if (entries.some((entry) => entry === null || entry.inTable)) return null;
    // Points to twips at this boundary, so one representation crosses into the contract.
    const twips = (points: number): number => Math.round(points * 20);
    // ONE signed first-line offset, hanging-wins (ECMA-376 §17.3.1.12) — the two spellings
    // are mutually exclusive, never summed.
    const signedFirstLine = (value: ParagraphIndent): number =>
      twips(value.hanging > 0 ? -value.hanging : value.firstLine);
    const resolved = entries as readonly ParagraphIndentEntry[];
    const left = twips(first.indent.left);
    const right = twips(first.indent.right);
    const firstLine = signedFirstLine(first.indent);
    return {
      left,
      right,
      firstLine,
      mixed: {
        left: resolved.some((entry) => twips(entry.indent.left) !== left),
        right: resolved.some((entry) => twips(entry.indent.right) !== right),
        firstLine: resolved.some((entry) => signedFirstLine(entry.indent) !== firstLine),
      },
    };
  })();

  return {
    bold: styles.length > 0 && styles.every((entry) => entry.bold),
    italic: styles.length > 0 && styles.every((entry) => entry.italic),
    underline: styles.length > 0 && styles.every((entry) => entry.underline !== null),
    strikethrough: styles.length > 0 && styles.every((entry) => entry.strike),
    superscript: styles.length > 0 && styles.every((e) => e.verticalAlign === 'superscript'),
    subscript: styles.length > 0 && styles.every((e) => e.verticalAlign === 'subscript'),
    fontFamily:
      spans.length > 0 ? agreedOver(spans.map(familyOf)) : (caretInherited?.fontFamily ?? null),
    fontSizeHalfPoints:
      spans.length > 0
        ? agreedOver(spans.map(sizeOf))
        : (caretInherited?.fontSizeHalfPoints ?? null),
    color: agreed((entry) => entry.color),
    highlight: agreed((entry) => entry.highlight),
    alignment,
    styleId: style,
    lineSpacing,
    spaceBeforePt: spacePt('before'),
    spaceAfterPt: spacePt('after'),
    indent,
  } satisfies SurfaceFormatting;
}

/**
 * Every paragraph a selection touches, in document order — the exact span
 * `setParagraphProperty` writes over, so what the toolbar READS and what a press WRITES
 * can never disagree about which paragraphs are involved.
 *
 * Falls back to the head paragraph alone when either endpoint is not in the published
 * order (a layout that has not caught up), which is the previous behaviour.
 */
function paragraphsTouched(
  layout: SemanticLayout,
  selection: SemanticSelection,
  cells?: readonly string[]
): readonly string[] {
  // A RECTANGLE first, for the same reason the write takes it first: a selected column read
  // as a range runs through the cells between its corners, so the toolbar answered "mixed"
  // over a column that was uniformly centred — and would then have centred it correctly.
  // The button never lit, before a press or after one.
  if (cells && cells.length > 0) return [...paragraphsInCells(layout, cells)];
  if (selection.anchor.paragraphId === selection.head.paragraphId) {
    return [selection.head.paragraphId];
  }
  const order = documentOrder(layout);
  const anchorIndex = order.indexOf(selection.anchor.paragraphId);
  const headIndex = order.indexOf(selection.head.paragraphId);
  if (anchorIndex === -1 || headIndex === -1) return [selection.head.paragraphId];
  return order.slice(Math.min(anchorIndex, headIndex), Math.max(anchorIndex, headIndex) + 1);
}

/**
 * The paragraph-mark edit that keeps a whole-paragraph format change honest.
 *
 * Word writes the same run properties onto the paragraph MARK (`w:pPr/w:rPr`) whenever
 * formatting is applied to an entire paragraph. That mark is what a list marker inherits
 * its face from, so without it, sizing a bulleted paragraph left the bullet at the old
 * size beside text that had grown.
 *
 * Returns nothing when the range does not cover the whole paragraph — formatting part of a
 * paragraph must not restyle its pilcrow, and therefore must not move its marker.
 */
export function paragraphMarkOps(
  paragraphText: string,
  from: { readonly paragraphId: string; readonly offset: number },
  to: { readonly paragraphId: string; readonly offset: number },
  properties: readonly SurfaceProperty[]
): readonly {
  readonly op: 'setParagraphMarkProperties';
  readonly paragraphId: string;
  readonly properties: readonly SurfaceProperty[];
}[] {
  if (from.paragraphId !== to.paragraphId) return [];
  if (from.offset !== 0 || to.offset !== paragraphText.length) return [];
  if (paragraphText.length === 0) return [];
  return [{ op: 'setParagraphMarkProperties', paragraphId: from.paragraphId, properties }];
}
