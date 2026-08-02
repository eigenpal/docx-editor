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
  paragraphFragmentsOf,
  spansInSelection,
  type SemanticLayout,
  type SemanticSelection,
} from '@docx-editor.dev/core-contract/layout';
import {
  ACCEPTED_PARAGRAPH_PROPERTIES,
  ACCEPTED_RUN_PROPERTIES,
  findNode,
  nullRecord,
  WML_NAMESPACE_URI,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core-contract/store';
import type { SurfaceFormatting } from './paginated-surface-contract.ts';

/** One property as the ops and the layout records carry it: an element name plus attributes. */
export interface SurfaceProperty {
  readonly localName: string;
  readonly attributes?: Record<string, string>;
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
      for (const fragment of paragraphFragmentsOf(page)) {
        if (!index.has(fragment.paragraphId)) index.set(fragment.paragraphId, fragment.props);
      }
    }
    fragmentPropsByLayout.set(layout, index);
  }
  return index.get(paragraphId) ?? [];
}

/** The D8 paragraph op vocabulary — the only names an op is allowed to carry. */
const AUTHORABLE_PARAGRAPH_PROPERTIES: ReadonlySet<string> = new Set(ACCEPTED_PARAGRAPH_PROPERTIES);

/** The D8 run op vocabulary, for `w:rPr` on a run and on the paragraph mark alike. */
const AUTHORABLE_RUN_PROPERTIES: ReadonlySet<string> = new Set(ACCEPTED_RUN_PROPERTIES);

/**
 * A node's own property container (`w:pPr`, `w:rPr`) among its children.
 *
 * A container the canonical read demoted to generic is still the node's own properties —
 * matching only the typed kind lost the whole set.
 */
function propertyContainer(
  parent: OoxmlNode | null | undefined,
  kind: 'paragraphProperties' | 'runProperties',
  localName: 'pPr' | 'rPr'
): OoxmlNode | undefined {
  if (!parent || parent.kind === 'textValue') return undefined;
  const children: readonly OoxmlNode[] = parent.children;
  return children.find(
    (child) =>
      child.kind === kind ||
      (child.kind === 'generic' &&
        child.localName === localName &&
        child.namespaceUri === WML_NAMESPACE_URI)
  );
}

/** What a container itself authors, narrowed to the names an op is allowed to carry. */
function authoredProperties(
  container: OoxmlNode | undefined,
  authorable: ReadonlySet<string>
): readonly SurfaceProperty[] {
  if (!container || container.kind === 'textValue') return [];
  const properties: SurfaceProperty[] = [];
  for (const child of container.children) {
    if (child.kind === 'textValue' || !authorable.has(child.localName)) continue;
    // Null-prototype: these keys come from the file (D14).
    const attributes = nullRecord<string>();
    for (const entry of child.attributes) attributes[entry.localName] = entry.value;
    properties.push(
      Object.keys(attributes).length > 0
        ? { localName: child.localName, attributes }
        : { localName: child.localName }
    );
  }
  return properties;
}

/**
 * What a paragraph itself authors: its own `w:pPr`, from the canonical tree, narrowed to
 * the properties an op can express.
 *
 * The base a paragraph write merges against MUST be this and not the layout's bag. The
 * layout's is the CASCADE, and echoing that back had two effects a user could see. It was
 * refused outright — `setParagraphProperties` rejects any name outside D8, and the cascade
 * routinely carries `w:outlineLvl` (every Heading, 17.3.1.20) and `w:contextualSpacing`
 * (Word's List Paragraph), so pressing Centre on a heading did nothing at all. What did get
 * through restated style-inherited values as DIRECT formatting, which is a silent change of
 * meaning: a paragraph that merely inherited its alignment now states it, and editing the
 * style no longer moves it.
 *
 * Properties outside the vocabulary are dropped from the OP, not from the paragraph: the
 * applier keeps every `w:pPr` child an op cannot name (the mark, `w:sectPr`, `w:pBdr`,
 * `w:outlineLvl`) exactly as authored.
 */
export function directParagraphProperties(
  part: OoxmlPart,
  paragraphId: string
): readonly SurfaceProperty[] {
  const paragraph = findNode(part, paragraphId);
  return authoredProperties(
    propertyContainer(paragraph, 'paragraphProperties', 'pPr'),
    AUTHORABLE_PARAGRAPH_PROPERTIES
  );
}

/**
 * What a paragraph MARK itself authors: `w:pPr/w:rPr`, narrowed to the run vocabulary.
 *
 * Same rule as a run's own `w:rPr`, for the same reason — the mark is a run property
 * container, and `setParagraphMarkProperties` rewrites the names its op carries. Handing it
 * the layout's cascade wrote the whole inherited face onto the pilcrow as DIRECT formatting:
 * a `w:lang` and a `w:noProof` that only ever lived in `w:docDefaults` were minted into the
 * mark of every paragraph the user bolded.
 */
export function directParagraphMarkProperties(
  part: OoxmlPart,
  paragraphId: string
): readonly SurfaceProperty[] {
  const paragraph = findNode(part, paragraphId);
  const pPr = propertyContainer(paragraph, 'paragraphProperties', 'pPr');
  return authoredProperties(
    propertyContainer(pPr, 'runProperties', 'rPr'),
    AUTHORABLE_RUN_PROPERTIES
  );
}

/**
 * Merge one property into a set, replacing any entry with the same name.
 *
 * `setRunProperties` and `setParagraphProperties` REPLACE the whole container, so sending
 * one property alone deleted every other: pressing Bold stripped a run's font, size and
 * colour, and pressing Centre stripped a paragraph's style, numbering and indents.
 */
export function mergedProperties(
  existing: readonly SurfaceProperty[],
  incoming: SurfaceProperty
): SurfaceProperty[] {
  const kept = existing.filter((entry) => entry.localName !== incoming.localName);
  return [...kept, incoming];
}

/** One run's share of a range edit: the slice it covers and the properties to write there. */
export interface RunPropertyEdit {
  readonly start: number;
  readonly end: number;
  readonly properties: readonly SurfaceProperty[];
}

/**
 * The characters a node contributes to its paragraph's UTF-16 offsets.
 *
 * Mirrors the store's segment model exactly (`segmentsOf`): text counts its code units, a
 * `w:tab` and a `w:br` count one, and `w:rPr` and generic content count nothing. The op
 * offsets computed here have to be the ones the applier will resolve, or a range edit would
 * land on the wrong run.
 */
function addressableLength(node: OoxmlNode): number {
  if (node.kind === 'textValue') return node.value.length;
  if (node.kind === 'tab' || node.kind === 'hardBreak') return 1;
  if (node.kind === 'runProperties' || node.kind === 'generic') return 0;
  let total = 0;
  for (const child of node.children) total += addressableLength(child);
  return total;
}

/**
 * A range run-property change, split into ONE edit per run it covers, each merged over that
 * run's own `w:rPr`.
 *
 * Neither half of that is optional. The base MUST be the run's own properties: the layout
 * publishes the CASCADE (`w:docDefaults` + the style chain + direct), and echoing it back had
 * two effects a user could see. It was refused outright — `setRunProperties` rejects any name
 * outside D8, and Word's own `styles.xml` puts `w:lang` and `w:noProof` in
 * `docDefaults/rPrDefault` (17.7.5.3), so on a document Word wrote, Bold did nothing at all
 * and said nothing. What did get through restated inherited values as DIRECT formatting, so a
 * run that merely inherited its font now stated it and editing the style no longer moved it.
 *
 * And the split MUST be per run: the op REPLACES the properties it names across its whole
 * range, so one op carrying one run's bag over a mixed selection homogenised it — bolding
 * `hello ` + `Georgia` rewrote the second run's `w:rFonts` with the first's. Runs are addressed
 * by offset rather than by id because these edits apply in sequence and the applier splits
 * runs at the range edges; offsets are unmoved by a property write, ids are not.
 */
export function runPropertyEdits(
  part: OoxmlPart,
  paragraphId: string,
  start: number,
  end: number,
  incoming: SurfaceProperty
): readonly RunPropertyEdit[] {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind === 'textValue') return [];
  const edits: RunPropertyEdit[] = [];
  let offset = 0;
  for (const child of paragraph.children) {
    if (child.kind !== 'run') continue;
    const runStart = offset;
    offset += addressableLength(child);
    // A run with no addressable content — a field character, a bare `w:rPr` — is not
    // reachable by any range, so no op should name one.
    if (offset === runStart) continue;
    const from = Math.max(runStart, start);
    const to = Math.min(offset, end);
    if (from >= to) continue;
    edits.push({
      start: from,
      end: to,
      properties: mergedProperties(
        authoredProperties(
          propertyContainer(child, 'runProperties', 'rPr'),
          AUTHORABLE_RUN_PROPERTIES
        ),
        incoming
      ),
    });
  }
  return edits;
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
  localName: string
): boolean {
  const spans = spansInSelection(layout, selection);
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
  inherited?: InheritedRunDefaults
): SurfaceFormatting {
  const spans = spansInSelection(layout, selection);
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
  const touchedParagraphs = paragraphsTouched(layout, selection);
  const paragraphValue = <T>(read: (properties: readonly SurfaceProperty[]) => T): T | null =>
    agreedOver(touchedParagraphs.map((id) => read(paragraphPropertiesOf(layout, id))));
  // Normalized BEFORE agreement: `w:jc` absent and `w:jc val="left"` are the same
  // alignment, and comparing the raw attribute would call them a mixed selection.
  const alignment = paragraphValue((properties) => {
    const jc = properties.find((property) => property.localName === 'jc')?.attributes?.val;
    return jc === 'center' || jc === 'right' || jc === 'both'
      ? jc
      : jc === 'end'
        ? ('right' as const)
        : ('left' as const);
  });
  const style =
    paragraphValue(
      (properties) =>
        properties.find((property) => property.localName === 'pStyle')?.attributes?.val
    ) ?? null;
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
  selection: SemanticSelection
): readonly string[] {
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
