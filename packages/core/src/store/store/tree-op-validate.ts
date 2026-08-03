// The op vocabulary and pre-application validation (tree-ops seam).
//
// This module owns what an op IS — the declarative, JSON-safe `TreeDocOp` shapes, the
// accepted property boundaries, the effect/rejection contracts — plus the segment model
// that flattens a paragraph into UTF-16 addressable units, and `validateTreeOp`, which
// runs BEFORE any tree work so a rejected op leaves the tree, revision and indexes exactly
// as they were. Application lives in tree-op-apply.ts; both are re-exported via tree-ops.ts.

import type { OoxmlNode, OoxmlParagraphNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { isContentRevisionKind } from '../package/ooxml-shared.ts';
import { findNode } from '../package/ooxml-edit.ts';
import { paragraphPropertiesNodeOf } from './tree-op-nodes.ts';
import { isValidXmlText } from '../package/sinks.ts';

/**
 * The accepted RUN property boundary (design D8), as the OOXML element names that carry it.
 *
 * An explicit allowlist rather than "any `w:rPr` child": a property outside D8 has no
 * resolver, no layout behavior and no support claim, so accepting it here would let an
 * operation assert support the engine does not have. Unknown properties still ROUND-TRIP —
 * they are generic nodes in the tree — they simply cannot be authored by an op.
 */
export const ACCEPTED_RUN_PROPERTIES = [
  'rFonts', // font family
  'sz', // half-point size
  'szCs',
  'color',
  'b', // bold
  'bCs',
  'i', // italic
  'iCs',
  'u', // underline variant and color
  'strike',
  'dstrike', // double strike
  'highlight',
  'vertAlign', // superscript / subscript
  'position', // baseline offset
  'caps',
  'smallCaps',
  'spacing', // character spacing
  'w', // horizontal scaling
  'kern',
] as const;
// `w:rStyle` is deliberately ABSENT. It is preserved, not accepted: this list is the set a
// property write REPLACES, so admitting the character style would make a bold toggle delete
// it. `insertHyperlink` writes `w:rStyle` itself, as part of making the run a link, which is
// what Word does and what leaves every other write alone.

/** The accepted PARAGRAPH property boundary (design D8). */
export const ACCEPTED_PARAGRAPH_PROPERTIES = [
  'pStyle',
  'jc', // alignment
  'spacing', // before/after + line spacing and rule
  'ind', // left/right/first-line/hanging indents
  'tabs',
  'numPr', // numbering identity and level
  'keepNext',
  'keepLines',
  'widowControl',
  'pageBreakBefore',
  'shd', // shading
] as const;

export type AcceptedRunProperty = (typeof ACCEPTED_RUN_PROPERTIES)[number];
export type AcceptedParagraphProperty = (typeof ACCEPTED_PARAGRAPH_PROPERTIES)[number];

const RUN_PROPERTY_SET: ReadonlySet<string> = new Set(ACCEPTED_RUN_PROPERTIES);
const PARAGRAPH_PROPERTY_SET: ReadonlySet<string> = new Set(ACCEPTED_PARAGRAPH_PROPERTIES);

/**
 * One authored property: an element name plus its `w:`-namespace attributes.
 *
 * Modeled as name+attributes rather than a typed record per property because that is what
 * the tree holds, so an op maps to nodes without a lossy intermediate vocabulary. Attribute
 * VALUES are validated as XML text; their meaning is the resolver's business.
 */
export interface OoxmlProperty {
  readonly localName: string;
  readonly attributes?: Readonly<Record<string, string>>;
}

export type TreeDocOp =
  | {
      readonly op: 'insertText';
      readonly paragraphId: string;
      readonly offset: number;
      readonly text: string;
    }
  | {
      readonly op: 'deleteText';
      readonly paragraphId: string;
      readonly start: number;
      readonly end: number;
    }
  | { readonly op: 'insertTab'; readonly paragraphId: string; readonly offset: number }
  | { readonly op: 'insertHardBreak'; readonly paragraphId: string; readonly offset: number }
  | { readonly op: 'insertPageBreak'; readonly paragraphId: string; readonly offset: number }
  | {
      /**
       * Move a numbered paragraph to another `w:numPr/w:ilvl`.
       *
       * A list item's LEVEL is what selects its format out of `numbering.xml`, so this is
       * the op behind Increase/Decrease Indent on a list: the marker changes with it. A
       * paragraph carrying no `w:numPr` is refused rather than silently numbered.
       */
      readonly op: 'setListLevel';
      readonly paragraphId: string;
      readonly level: number;
    }
  | {
      /**
       * Put a paragraph in a list, or take it out of one.
       *
       * `numId` names a `w:num` in `numbering.xml`; null removes `w:numPr` entirely, which
       * is what turning a bullet off means. Everything else in `w:pPr` survives.
       */
      /**
       * Run properties of the PARAGRAPH MARK (`w:pPr/w:rPr`, ECMA-376 17.3.1.29).
       *
       * The mark carries the formatting a paragraph's own pilcrow has, and Word keeps it
       * in step whenever formatting is applied to a whole paragraph. It is what a list
       * marker inherits its face from — so without it, sizing a bulleted paragraph leaves
       * the bullet at the old size.
       */
      readonly op: 'setParagraphMarkProperties';
      readonly paragraphId: string;
      readonly properties: readonly OoxmlProperty[];
    }
  | {
      readonly op: 'setListNumbering';
      readonly paragraphId: string;
      readonly numId: string | null;
      readonly level?: number;
    }
  | { readonly op: 'splitParagraph'; readonly paragraphId: string; readonly offset: number }
  | {
      /**
       * Split one `w:p` at MANY offsets in a single op.
       *
       * Equivalent to applying `splitParagraph` at each offset from the last to the first,
       * but the paragraph's content is cut in one pass and the parent's child sequence is
       * rebuilt once. A plain-text paste is a paragraph mark per line: as individual ops,
       * a large paste rebuilt the body — and re-sliced the pasted text — once per line,
       * which is quadratic in paste size.
       */
      readonly op: 'splitParagraphMany';
      readonly paragraphId: string;
      /**
       * Non-decreasing UTF-16 offsets; each produces one paragraph boundary. A repeated
       * offset produces an empty paragraph between the two boundaries — a blank line.
       */
      readonly offsets: readonly number[];
    }
  | { readonly op: 'joinParagraphs'; readonly firstId: string; readonly secondId: string }
  | {
      readonly op: 'setRunProperties';
      readonly paragraphId: string;
      readonly start: number;
      readonly end: number;
      readonly properties: readonly OoxmlProperty[];
    }
  | {
      readonly op: 'setParagraphProperties';
      readonly paragraphId: string;
      readonly properties: readonly OoxmlProperty[];
    }
  | {
      /**
       * Set page-setup fields — page size, orientation, margins — on every targeted
       * `w:sectPr`: all of them (Word's "Apply to: Whole document", the default) or
       * only the one governing `anchorParagraphId`. A document whose write must reach
       * the implicit tail section gets a body-level `w:sectPr` minted as the body's
       * last child. Omitted fields are left exactly as authored per section. Explicit
       * dimensions are written literally; `orientation` WITHOUT dimensions swaps each
       * section's own (see `plannedSectionDimensions`), so distinct paper sizes
       * survive a whole-document flip.
       */
      readonly op: 'setSectionProperties';
      readonly pageWidthTwips?: number;
      readonly pageHeightTwips?: number;
      readonly orientation?: 'portrait' | 'landscape';
      readonly marginTopTwips?: number;
      readonly marginRightTwips?: number;
      readonly marginBottomTwips?: number;
      readonly marginLeftTwips?: number;
      /**
       * Word's "Apply to: This section": update only the section GOVERNING this
       * paragraph — the nearest mid-body `w:sectPr` at or after it, else the body-level
       * one. Absent means every section.
       */
      readonly anchorParagraphId?: string;
    }
  | {
      /**
       * End a section AT this paragraph: mint a `w:pPr/w:sectPr` cloning the governing
       * section's effective page setup, so the blocks up to and including this paragraph
       * become their own section (a next-page section break). The paragraph must not
       * already carry one.
       */
      readonly op: 'setSectionMark';
      readonly paragraphId: string;
    }
  | {
      /**
       * Wrap `[start, end)` of a paragraph in a `w:hyperlink`.
       *
       * The RANGE is the link — text and formatting inside it are untouched, and runs that
       * straddle either edge are divided so the link covers exactly the characters asked
       * for. Exactly one of `relationshipId` (an external target, already minted on the
       * package) or `anchor` (a bookmark in this document) names where it goes.
       *
       * A collapsed range is refused: a link with no text is markup with nothing to click,
       * and the caller that wants "insert a link with display text" inserts the text first.
       */
      readonly op: 'insertHyperlink';
      readonly paragraphId: string;
      readonly start: number;
      readonly end: number;
      readonly relationshipId?: string;
      readonly anchor?: string;
      readonly tooltip?: string;
      /**
       * Character style to mark the linked runs with (`w:rStyle`), normally `Hyperlink`.
       *
       * Written HERE rather than through `setRunProperties` because `w:rStyle` is preserved,
       * not accepted: it is not in the set a property write replaces, and putting it there
       * would make a later bold toggle delete it. Marking the text is part of making it a
       * link — Word does both in one operation — so the op that wraps it also styles it.
       * Omitted for a document that declares no such style.
       */
      readonly styleId?: string;
    }
  | {
      /**
       * Re-aim an existing link. `relationshipId` moves it to another external target,
       * `anchor` to a bookmark; supplying one CLEARS the other, so a link never ends up
       * carrying both and resolving by the wrong one.
       */
      readonly op: 'setHyperlinkTarget';
      readonly linkId: string;
      readonly relationshipId?: string;
      readonly anchor?: string;
      readonly tooltip?: string;
    }
  | {
      /**
       * Unlink: splice the `w:hyperlink`'s children into the paragraph in its place.
       *
       * The runs keep their identity, their formatting and their order, and any bookmark
       * markers inside the link stay exactly where they were. Only the link element goes,
       * which is what Word's Remove Hyperlink does — the text is not the link's, it was
       * only wrapped by it.
       */
      readonly op: 'removeHyperlink';
      readonly linkId: string;
    };

export type TreeDocOpKind = TreeDocOp['op'];

export const TREE_DOC_OP_KINDS = [
  'insertText',
  'deleteText',
  'insertTab',
  'insertHardBreak',
  'insertPageBreak',
  'setListLevel',
  'setListNumbering',
  'setParagraphMarkProperties',
  'splitParagraph',
  'splitParagraphMany',
  'joinParagraphs',
  'setRunProperties',
  'setParagraphProperties',
  'setSectionProperties',
  'setSectionMark',
  'insertHyperlink',
  'setHyperlinkTarget',
  'removeHyperlink',
] as const satisfies readonly TreeDocOpKind[];

// Compile-time exhaustiveness, matching the legacy `DOC_OP_KINDS` guard: a new op must be
// listed here or this fails to typecheck, so it can never be silently unvalidated.
type _MissingTreeOp = Exclude<TreeDocOpKind, (typeof TREE_DOC_OP_KINDS)[number]>;
const _treeOpsExhaustive: _MissingTreeOp extends never ? true : ['missing', _MissingTreeOp] = true;
void _treeOpsExhaustive;

/**
 * How far a committed op can reach, so layout can scope its work (task 5.2).
 *
 * `text-local` touches one paragraph's characters; `paragraph-local` changes one
 * paragraph's own properties; `flow-structural` changes the block sequence and can
 * repaginate everything after it.
 */
export type ImpactClass = 'text-local' | 'paragraph-local' | 'flow-structural';

export interface TreeOpEffect {
  readonly dirty: readonly string[];
  readonly created: readonly string[];
  readonly deleted: readonly string[];
  readonly split?: { readonly from: string; readonly tail: string };
  /** One entry per boundary of a many-way split, in document order. */
  readonly splits?: readonly { readonly from: string; readonly tail: string }[];
  readonly join?: { readonly kept: string; readonly removed: string };
  readonly dependencyKeys: readonly string[];
  readonly impact: ImpactClass;
}

export type TreeOpRejection =
  | 'unknown-op'
  | 'unknown-paragraph'
  | 'not-a-paragraph'
  | 'offset-out-of-range'
  | 'invalid-range'
  | 'not-a-list-paragraph'
  | 'splits-surrogate-pair'
  | 'invalid-text'
  | 'unsupported-property'
  | 'invalid-property-value'
  | 'not-adjacent-siblings'
  | 'tree-invariant';

export type TreeOpResult =
  | { readonly ok: true; readonly part: OoxmlPart; readonly effect: TreeOpEffect }
  | { readonly ok: false; readonly reason: TreeOpRejection; readonly detail?: string };

/** One addressable unit of paragraph text: a text value, a tab, or a hard break. */
export interface Segment {
  readonly runId: string;
  readonly node: OoxmlNode;
  readonly start: number;
  readonly end: number;
}

export function isParagraph(node: OoxmlNode | null): node is OoxmlParagraphNode {
  return node !== null && node.kind === 'paragraph';
}

// ---------------------------------------------------------------------------------------
// Section addressing (setSectionProperties).
//
// The store may not import the layout package (the dependency points the other way), so
// the few section reads validation needs — current dimensions and margins, to refuse a
// write that leaves no content area — are derived here with the same clamps the layout
// reader applies. Fields an op does not touch fall back to what the document effectively
// uses today, which is exactly what the merged write will leave in place.
// ---------------------------------------------------------------------------------------

/** The `w:body` element of a part, or null when the root holds none. */
export function bodyNodeOf(
  part: OoxmlPart
): (OoxmlNode & { children: readonly OoxmlNode[] }) | null {
  const walk = (node: OoxmlNode): (OoxmlNode & { children: readonly OoxmlNode[] }) | null => {
    if (node.kind === 'textValue') return null;
    if (node.kind === 'body') return node;
    for (const child of node.children ?? []) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(part.root);
}

/** The body-level `w:sectPr` (a generic node), or null. */
export function bodySectionOf(part: OoxmlPart): OoxmlNode | null {
  const body = bodyNodeOf(part);
  if (!body) return null;
  for (const child of body.children) {
    if (child.kind !== 'textValue' && 'localName' in child && child.localName === 'sectPr') {
      return child;
    }
  }
  return null;
}

/**
 * EVERY `w:sectPr` in the part, in document order: the mid-body ones (inside a
 * paragraph's `w:pPr`, ending a section) and the body-level one last.
 *
 * A page-setup write is "apply to whole document" — Word's dialog default — so it must
 * reach all of them. Updating only the body-level section leaves a multi-section
 * document saying "portrait, portrait, …, landscape", which any per-section consumer
 * (Word itself) then renders as a mixed-orientation document.
 */
export function allSectionNodes(part: OoxmlPart): OoxmlNode[] {
  const found: OoxmlNode[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    // A `sectPr` inside a table is not a section Word recognises and layout ignores it;
    // writing to one would make the dialog appear to do nothing.
    if (node.kind === 'table') return;
    if ('localName' in node && node.localName === 'sectPr') {
      found.push(node);
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(part.root);
  return found;
}

/** Whether a node sits inside a `w:tbl` — where a section mark must not be minted. */
export function isTableNested(part: OoxmlPart, nodeId: string): boolean {
  let nested = false;
  let found = false;
  const walk = (node: OoxmlNode, inTable: boolean): void => {
    if (found || node.kind === 'textValue') return;
    if (node.id === nodeId) {
      nested = inTable;
      found = true;
      return;
    }
    const below = inTable || node.kind === 'table';
    for (const child of node.children ?? []) walk(child, below);
  };
  walk(part.root, false);
  return nested;
}

/** A `w:`-namespace attribute value by local name, off any element node. */
export function sectionAttribute(node: OoxmlNode | null, name: string): string | undefined {
  if (!node || node.kind === 'textValue' || !('attributes' in node)) return undefined;
  for (const entry of node.attributes ?? []) {
    if (entry.localName === name) return entry.value;
  }
  return undefined;
}

/** A named child element of a section container. */
export function sectionChild(node: OoxmlNode | null, localName: string): OoxmlNode | null {
  if (!node || node.kind === 'textValue') return null;
  for (const child of node.children ?? []) {
    if (child.kind !== 'textValue' && 'localName' in child && child.localName === localName) {
      return child;
    }
  }
  return null;
}

export interface SectionMetrics {
  readonly widthTwips: number;
  readonly heightTwips: number;
  readonly topTwips: number;
  readonly rightTwips: number;
  readonly bottomTwips: number;
  readonly leftTwips: number;
  readonly headerTwips: number;
  readonly footerTwips: number;
  readonly gutterTwips: number;
}

const clampedTwips = (raw: string | undefined, fallback: number, max: number): number => {
  if (raw === undefined || !/^-?\d{1,7}$/.test(raw)) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > max) return fallback;
  return value;
};

const clampedMargin = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined || !/^-?\d{1,7}$/.test(raw)) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || Math.abs(value) > 31680) return fallback;
  return value;
};

/** What the document EFFECTIVELY uses today — declared values under the read-side clamps,
 *  Word's defaults where it says nothing. */
export function currentSectionMetrics(part: OoxmlPart): SectionMetrics {
  return metricsOfSection(bodySectionOf(part));
}

type SectionWriteOp = Extract<TreeDocOp, { op: 'setSectionProperties' }>;

/**
 * The dimensions ONE section ends up with under this op — the single source both
 * validation and application read, so a value the check approved is exactly the value
 * written. An orientation change WITHOUT explicit dimensions swaps the section's own
 * current dimensions, so distinct paper sizes survive a whole-document orientation flip.
 */
export function plannedSectionDimensions(
  metrics: SectionMetrics,
  op: SectionWriteOp
): { readonly widthTwips: number; readonly heightTwips: number } {
  let width = op.pageWidthTwips ?? metrics.widthTwips;
  let height = op.pageHeightTwips ?? metrics.heightTwips;
  if (
    op.orientation !== undefined &&
    op.pageWidthTwips === undefined &&
    op.pageHeightTwips === undefined
  ) {
    const long = Math.max(metrics.widthTwips, metrics.heightTwips);
    const short = Math.min(metrics.widthTwips, metrics.heightTwips);
    width = op.orientation === 'landscape' ? long : short;
    height = op.orientation === 'landscape' ? short : long;
  }
  return { widthTwips: width, heightTwips: height };
}

/**
 * The sections this op writes: the one governing the anchor paragraph, or all of them.
 * `null` entries mean "the body-level section, which must be minted".
 */
export function targetSectionNodes(
  part: OoxmlPart,
  anchorParagraphId: string | undefined
): readonly (OoxmlNode | null)[] {
  if (anchorParagraphId === undefined) {
    const all = allSectionNodes(part);
    // A body-level section governs the tail even when the document never wrote one; a
    // whole-document write must reach that implicit section too, so it is minted.
    return bodySectionOf(part) ? all : [...all, null];
  }
  // The governing section of a paragraph: the first paragraph AT or AFTER it (in
  // document order) carrying a `w:pPr/w:sectPr`, else the body-level section. The
  // anchor may sit inside a table (the table belongs to a section), but a table-nested
  // `sectPr` is never a boundary — Word does not recognise one.
  let seenAnchor = false;
  let governing: OoxmlNode | null | undefined;
  const walk = (node: OoxmlNode, inTable: boolean): void => {
    if (governing !== undefined || node.kind === 'textValue') return;
    if (node.kind === 'paragraph') {
      if (node.id === anchorParagraphId) seenAnchor = true;
      if (seenAnchor && !inTable) {
        const pPr = paragraphPropertiesNodeOf(node);
        const sectPr = pPr ? sectionChild(pPr, 'sectPr') : null;
        if (sectPr) governing = sectPr;
      }
      return;
    }
    const below = inTable || node.kind === 'table';
    for (const child of node.children ?? []) walk(child, below);
  };
  walk(part.root, false);
  return [governing ?? bodySectionOf(part)];
}

/** The effective metrics of ONE section node (null reads as Word's defaults). */
export function metricsOfSection(sectPr: OoxmlNode | null): SectionMetrics {
  const pgSz = sectionChild(sectPr, 'pgSz');
  const pgMar = sectionChild(sectPr, 'pgMar');
  return {
    widthTwips: clampedTwips(sectionAttribute(pgSz, 'w'), 12240, 63360),
    heightTwips: clampedTwips(sectionAttribute(pgSz, 'h'), 15840, 63360),
    topTwips: clampedMargin(sectionAttribute(pgMar, 'top'), 1440),
    rightTwips: clampedMargin(sectionAttribute(pgMar, 'right'), 1440),
    bottomTwips: clampedMargin(sectionAttribute(pgMar, 'bottom'), 1440),
    leftTwips: clampedMargin(sectionAttribute(pgMar, 'left'), 1440),
    headerTwips: clampedMargin(sectionAttribute(pgMar, 'header'), 720),
    footerTwips: clampedMargin(sectionAttribute(pgMar, 'footer'), 720),
    gutterTwips: clampedMargin(sectionAttribute(pgMar, 'gutter'), 0),
  };
}

/**
 * Flatten a paragraph into UTF-16 addressable segments, in document order.
 *
 * Every RUN CONTAINER is descended: a hyperlink, and the content revision wrappers
 * (`w:ins`, `w:del`, `w:moveFrom`, `w:moveTo`) — including each nested inside the other,
 * which is ordinary in a reviewed document with links. `w:delText` counts exactly like
 * `w:t`. This has to match what layout projects: if the two disagree about which character
 * sits at an offset, the caret and every tree op land on a different character than the one
 * under the pointer. Containers nested deeper than the cap are not descended, because a file
 * is attacker-controlled and preserved-but-unaddressable is the conservative answer.
 *
 * A HYPERLINK's runs are addressed too. `w:hyperlink` is a run container, not a leaf, and
 * the characters inside a link are ordinary paragraph text: the user selects them, types
 * over them and deletes them like any other. Skipping the container — which is what
 * iterating only direct `w:r` children did — left every link's text with no offsets at all,
 * so `paragraphTextOf` read "Visit  or ." for a sentence that says "Visit Example.com or
 * Anthropic's website." and layout, selection and the ops all agreed on the wrong string.
 *
 * `runId` stays the id of the run the content actually lives in, at whatever depth: the
 * appliers resolve it with `findNode` and rebuild that run's children, so nesting costs them
 * nothing.
 */
export function segmentsOf(paragraph: OoxmlParagraphNode): Segment[] {
  const segments: Segment[] = [];
  let offset = 0;
  const visit = (node: OoxmlNode, runId: string): void => {
    if (node.kind === 'textValue') {
      segments.push({ runId, node, start: offset, end: offset + node.value.length });
      offset += node.value.length;
      return;
    }
    if (node.kind === 'tab' || node.kind === 'hardBreak') {
      segments.push({ runId, node, start: offset, end: offset + 1 });
      offset += 1;
      return;
    }
    if (node.kind === 'runProperties' || node.kind === 'generic') return;
    for (const child of node.children) visit(child, runId);
  };
  const visitInline = (child: OoxmlNode, depth: number): void => {
    if (child.kind === 'run') {
      for (const grand of child.children) visit(grand, child.id);
      return;
    }
    if (child.kind === 'textValue' || depth >= MAX_INLINE_CONTAINER_DEPTH) return;
    // Bookmark and range markers measure nothing; only a run CONTAINER descends. A link and a
    // revision wrapper are both containers, and either can hold the other.
    if (child.kind === 'hyperlink' || isContentRevisionKind(child.kind)) {
      for (const inner of child.children) visitInline(inner, depth + 1);
    }
  };
  for (const child of paragraph.children) visitInline(child, 0);
  return segments;
}

/** Matches the layout projection's nesting cap; see `segmentsOf`. */
const MAX_INLINE_CONTAINER_DEPTH = 32;

/**
 * The runs a paragraph child owns, at any depth — a `w:r`, or every run inside a link or a
 * revision wrapper.
 *
 * Revisions count for the same reason links do: a run inside a `w:ins` is ordinary text that a
 * property edit must reach, or applying bold across a selection would skip the tracked words
 * inside it.
 */
export function runsUnder(child: OoxmlNode, depth = 0): OoxmlNode[] {
  if (child.kind === 'run') return [child];
  if (child.kind === 'textValue' || depth >= MAX_INLINE_CONTAINER_DEPTH) return [];
  if (child.kind !== 'hyperlink' && !isContentRevisionKind(child.kind)) return [];
  return child.children.flatMap((inner) => runsUnder(inner, depth + 1));
}

function paragraphLength(paragraph: OoxmlParagraphNode): number {
  const segments = segmentsOf(paragraph);
  return segments.length === 0 ? 0 : segments[segments.length - 1]!.end;
}

/** Whether an offset falls between the halves of a surrogate pair. */
function splitsSurrogate(paragraph: OoxmlParagraphNode, offset: number): boolean {
  for (const segment of segmentsOf(paragraph)) {
    if (segment.node.kind !== 'textValue') continue;
    if (offset <= segment.start || offset >= segment.end) continue;
    const local = offset - segment.start;
    const before = segment.node.value.charCodeAt(local - 1);
    const after = segment.node.value.charCodeAt(local);
    if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) return true;
  }
  return false;
}

function validateProperties(
  properties: readonly OoxmlProperty[],
  accepted: ReadonlySet<string>
): TreeOpRejection | null {
  for (const property of properties) {
    if (!accepted.has(property.localName)) return 'unsupported-property';
    for (const [name, value] of Object.entries(property.attributes ?? {})) {
      // Attribute names and values are written straight into XML on save, so both are
      // checked here rather than at the sink — a rejected op must never reach the tree.
      if (!/^[A-Za-z_][\w.-]*$/.test(name)) return 'invalid-property-value';
      if (typeof value !== 'string' || !isValidXmlText(value)) return 'invalid-property-value';
    }
  }
  return null;
}

/** Longest `r:id`, `w:anchor` or `w:tooltip` an op may write. */
const MAX_HYPERLINK_ATTRIBUTE_LENGTH = 512;

/** Whether `[start, end)` overlaps any text already inside a `w:hyperlink`. */
function rangeTouchesHyperlink(paragraph: OoxmlParagraphNode, start: number, end: number): boolean {
  const segments = segmentsOf(paragraph);
  const linked = new Set<string>();
  const collect = (node: OoxmlNode, inside: boolean): void => {
    if (node.kind === 'textValue') return;
    const within = inside || node.kind === 'hyperlink';
    if (within && node.kind === 'run') linked.add(node.id);
    for (const child of node.children) collect(child, within);
  };
  for (const child of paragraph.children) collect(child, false);
  if (linked.size === 0) return false;
  return segments.some(
    (segment) => linked.has(segment.runId) && segment.start < end && segment.end > start
  );
}

/**
 * The target half of an insert or a retarget: EXACTLY ONE of relationship or anchor, and
 * every value legal in XML.
 *
 * Both at once is refused rather than resolved by precedence. In a FILE that pair means "a
 * bookmark inside another document", which the read side honours; as an authored op it means
 * the caller does not know which it wants, and admitting it would write a link whose
 * behaviour depends on a resolution rule the caller never saw.
 */
function validateHyperlinkTarget(op: {
  readonly relationshipId?: string;
  readonly anchor?: string;
  readonly tooltip?: string;
}): TreeOpRejection | null {
  const hasRelationship = op.relationshipId !== undefined;
  const hasAnchor = op.anchor !== undefined;
  if (hasRelationship === hasAnchor) return 'invalid-property-value';
  for (const value of [op.relationshipId, op.anchor, op.tooltip]) {
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.length === 0) return 'invalid-property-value';
    if (value.length > MAX_HYPERLINK_ATTRIBUTE_LENGTH) return 'invalid-property-value';
    if (!isValidXmlText(value)) return 'invalid-property-value';
  }
  return null;
}

/** Structural validation, run before any tree work so a rejection changes nothing. */
export function validateTreeOp(part: OoxmlPart, op: TreeDocOp): TreeOpRejection | null {
  if (!TREE_DOC_OP_KINDS.includes(op.op)) return 'unknown-op';

  if (op.op === 'setSectionProperties') {
    const dims = [op.pageWidthTwips, op.pageHeightTwips];
    const margins = [
      op.marginTopTwips,
      op.marginRightTwips,
      op.marginBottomTwips,
      op.marginLeftTwips,
    ];
    if (
      dims.every((value) => value === undefined) &&
      margins.every((value) => value === undefined) &&
      op.orientation === undefined
    ) {
      return 'invalid-property-value';
    }
    for (const value of dims) {
      // The same bound the read side clamps to: a page dimension is a pagination loop
      // bound, so the write path must not admit what the read path would refuse.
      if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 63360)) {
        return 'invalid-property-value';
      }
    }
    for (const value of margins) {
      // Stricter than the read side, which tolerates authored negative margins: the write
      // path is a dialog or a ruler drag, and neither means "bleed into the margin".
      if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 31680)) {
        return 'invalid-property-value';
      }
    }
    if (
      op.orientation !== undefined &&
      op.orientation !== 'portrait' &&
      op.orientation !== 'landscape'
    ) {
      return 'invalid-property-value';
    }
    if (op.anchorParagraphId !== undefined) {
      const anchor = findNode(part, op.anchorParagraphId);
      if (!anchor) return 'unknown-paragraph';
      if (!isParagraph(anchor)) return 'not-a-paragraph';
    }
    if (!bodyNodeOf(part)) return 'tree-invariant';
    // EVERY section the op will write must keep a positive content area — checked against
    // the same planned values apply writes, so a value the check approved is exactly the
    // value written. The read side falls back to default geometry when margins swallow
    // the page; a WRITE that would trip that fallback is refused instead, so the user
    // sees a rejection rather than a document that silently snaps to Letter.
    for (const section of targetSectionNodes(part, op.anchorParagraphId)) {
      const current = metricsOfSection(section);
      const { widthTwips, heightTwips } = plannedSectionDimensions(current, op);
      const top = op.marginTopTwips ?? current.topTwips;
      const right = op.marginRightTwips ?? current.rightTwips;
      const bottom = op.marginBottomTwips ?? current.bottomTwips;
      const left = op.marginLeftTwips ?? current.leftTwips;
      if (widthTwips - left - current.gutterTwips - right <= 0 || heightTwips - top - bottom <= 0) {
        return 'invalid-property-value';
      }
    }
    return null;
  }

  if (op.op === 'joinParagraphs') {
    const first = findNode(part, op.firstId);
    const second = findNode(part, op.secondId);
    if (!first || !second) return 'unknown-paragraph';
    if (!isParagraph(first) || !isParagraph(second)) return 'not-a-paragraph';
    return null;
  }

  if (op.op === 'setHyperlinkTarget' || op.op === 'removeHyperlink') {
    const link = findNode(part, op.linkId);
    if (!link) return 'unknown-paragraph';
    if (link.kind !== 'hyperlink') return 'not-a-paragraph';
    if (op.op === 'setHyperlinkTarget') return validateHyperlinkTarget(op);
    return null;
  }

  const paragraph = findNode(part, op.paragraphId);
  if (!paragraph) return 'unknown-paragraph';
  if (!isParagraph(paragraph)) return 'not-a-paragraph';
  const length = paragraphLength(paragraph);

  switch (op.op) {
    case 'insertText': {
      if (!Number.isInteger(op.offset) || op.offset < 0 || op.offset > length) {
        return 'offset-out-of-range';
      }
      if (typeof op.text !== 'string' || !isValidXmlText(op.text)) return 'invalid-text';
      if (splitsSurrogate(paragraph, op.offset)) return 'splits-surrogate-pair';
      return null;
    }
    case 'setListLevel': {
      if (!Number.isInteger(op.level) || op.level < 0 || op.level > 8) return 'invalid-range';
      return null;
    }
    case 'setParagraphMarkProperties':
      if (!Array.isArray(op.properties)) return 'invalid-range';
      // The MARK is a run property container (CT_ParaRPr), so it takes the same boundary
      // `setRunProperties` does. Checking only that the argument was an array let an op
      // MINT any element name into `w:pPr/w:rPr` — `<w:rPr><w:sectPr/></w:rPr>` applied
      // clean and serialized — and skipped the attribute-name/value checks every other
      // property op runs before a value reaches the XML sink.
      return validateProperties(op.properties, RUN_PROPERTY_SET);
    case 'setListNumbering': {
      const level = op.level ?? 0;
      if (!Number.isInteger(level) || level < 0 || level > 8) return 'invalid-range';
      // A numId is file-addressable and becomes an attribute value: digits only.
      if (op.numId !== null && !/^\d{1,9}$/.test(op.numId)) return 'invalid-range';
      return null;
    }
    case 'insertTab':
    case 'insertHardBreak':
    case 'insertPageBreak': {
      if (!Number.isInteger(op.offset) || op.offset < 0 || op.offset > length) {
        return 'offset-out-of-range';
      }
      if (splitsSurrogate(paragraph, op.offset)) return 'splits-surrogate-pair';
      return null;
    }
    case 'splitParagraph': {
      if (!Number.isInteger(op.offset) || op.offset < 0 || op.offset > length) {
        return 'offset-out-of-range';
      }
      if (splitsSurrogate(paragraph, op.offset)) return 'splits-surrogate-pair';
      return null;
    }
    case 'splitParagraphMany': {
      if (!Array.isArray(op.offsets) || op.offsets.length === 0) return 'invalid-range';
      let previous = -1;
      for (const offset of op.offsets) {
        if (!Number.isInteger(offset) || offset < 0 || offset > length) {
          return 'offset-out-of-range';
        }
        // Non-decreasing: unordered offsets have no single sequential reading, but a
        // REPEATED offset does — it is how an empty paragraph is expressed, and a paste
        // with a blank line carries exactly that.
        if (offset < previous) return 'invalid-range';
        previous = offset;
        if (splitsSurrogate(paragraph, offset)) return 'splits-surrogate-pair';
      }
      return null;
    }
    case 'deleteText': {
      if (!Number.isInteger(op.start) || !Number.isInteger(op.end)) return 'invalid-range';
      if (op.start < 0 || op.end > length) return 'offset-out-of-range';
      if (op.start >= op.end) return 'invalid-range';
      if (splitsSurrogate(paragraph, op.start) || splitsSurrogate(paragraph, op.end)) {
        return 'splits-surrogate-pair';
      }
      return null;
    }
    case 'setRunProperties': {
      if (!Number.isInteger(op.start) || !Number.isInteger(op.end)) return 'invalid-range';
      if (op.start < 0 || op.end > length) return 'offset-out-of-range';
      if (op.start >= op.end) return 'invalid-range';
      return validateProperties(op.properties, RUN_PROPERTY_SET);
    }
    case 'setParagraphProperties':
      return validateProperties(op.properties, PARAGRAPH_PROPERTY_SET);
    case 'insertHyperlink': {
      if (!Number.isInteger(op.start) || !Number.isInteger(op.end)) return 'invalid-range';
      if (op.start < 0 || op.end > length) return 'offset-out-of-range';
      // A collapsed range would produce a link with no text: markup with nothing to click,
      // and nothing for a later unlink to give back.
      if (op.start >= op.end) return 'invalid-range';
      if (splitsSurrogate(paragraph, op.start) || splitsSurrogate(paragraph, op.end)) {
        return 'splits-surrogate-pair';
      }
      // Nested links are not a shape Word writes and not one this engine reads: the inner
      // link's runs would resolve through the outer one's target on every walk that stops
      // at the first `w:hyperlink` it finds.
      if (rangeTouchesHyperlink(paragraph, op.start, op.end)) return 'invalid-property-value';
      if (op.styleId !== undefined) {
        // Written straight into an attribute, so it is checked here rather than at the sink.
        if (typeof op.styleId !== 'string' || op.styleId.length === 0) {
          return 'invalid-property-value';
        }
        if (op.styleId.length > MAX_HYPERLINK_ATTRIBUTE_LENGTH || !isValidXmlText(op.styleId)) {
          return 'invalid-property-value';
        }
      }
      return validateHyperlinkTarget(op);
    }
    case 'setSectionMark': {
      const pPr = paragraphPropertiesNodeOf(paragraph);
      // A paragraph already ending a section cannot end two.
      if (pPr && sectionChild(pPr, 'sectPr')) return 'invalid-property-value';
      // A section cannot end inside a table cell: Word never writes one there, and the
      // read side would ignore it — a committed no-op the user cannot see.
      if (isTableNested(part, op.paragraphId)) return 'invalid-property-value';
      return null;
    }
    default:
      return 'unknown-op';
  }
}
