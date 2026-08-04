// Pre-application validation for tree ops (tree-ops seam).
//
// `validateTreeOp` runs BEFORE any tree work so a rejected op leaves the tree, revision
// and indexes exactly as they were. The op vocabulary lives in tree-op-types.ts; the
// segment model in tree-op-segments.ts; section addressing in tree-op-section-address.ts.
// Application lives in tree-op-apply.ts; public entry is tree-ops.ts.

import type { OoxmlNode, OoxmlParagraphNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { findNode } from '../package/ooxml-edit.ts';
import { isValidXmlText } from '../package/sinks.ts';
import { validateDeleteBlock } from './tree-op-blocks.ts';
import { paragraphPropertiesNodeOf } from './tree-op-nodes.ts';
import {
  bodyNodeOf,
  isTableNested,
  metricsOfSection,
  plannedSectionDimensions,
  sectionChild,
  targetSectionNodes,
} from './tree-op-section-address.ts';
import { isParagraph, paragraphLength, segmentsOf, splitsSurrogate } from './tree-op-segments.ts';
import {
  ACCEPTED_PARAGRAPH_PROPERTIES,
  ACCEPTED_RUN_PROPERTIES,
  TREE_DOC_OP_KINDS,
  type OoxmlProperty,
  type TreeDocOp,
  type TreeOpRejection,
} from './tree-op-types.ts';

const RUN_PROPERTY_SET: ReadonlySet<string> = new Set(ACCEPTED_RUN_PROPERTIES);
const PARAGRAPH_PROPERTY_SET: ReadonlySet<string> = new Set(ACCEPTED_PARAGRAPH_PROPERTIES);

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

  // Package-level furniture ops cannot run against a single part. Shape-check here so
  // applyTreeOp refuses them; TreePackageStore.applyLifecycleOp is the commit path.
  if (
    op.op === 'createHeaderFooter' ||
    op.op === 'deleteHeaderFooter' ||
    op.op === 'linkToPrevious' ||
    op.op === 'unlinkFromPrevious'
  ) {
    if (!Number.isInteger(op.sectionIndex) || op.sectionIndex < 0) return 'invalidArgs';
    if (op.kind !== 'header' && op.kind !== 'footer') return 'invalidArgs';
    if (op.variant !== 'default' && op.variant !== 'first' && op.variant !== 'even') {
      return 'invalidArgs';
    }
    return 'invalidArgs';
  }
  if (op.op === 'setSectionFurnitureOptions') {
    const empty =
      op.titlePage === undefined &&
      op.evenAndOddHeaders === undefined &&
      op.headerDistanceTwips === undefined &&
      op.footerDistanceTwips === undefined;
    if (empty) return 'invalidArgs';
    for (const value of [op.headerDistanceTwips, op.footerDistanceTwips]) {
      if (value === undefined) continue;
      if (!Number.isInteger(value) || value < 0 || value > 31680) return 'invalidArgs';
    }
    if (
      op.sectionIndex !== undefined &&
      (!Number.isInteger(op.sectionIndex) || op.sectionIndex < 0)
    ) {
      return 'invalidArgs';
    }
    return 'invalidArgs';
  }
  if (
    op.op === 'insertNote' ||
    op.op === 'deleteNote' ||
    op.op === 'convertNote' ||
    op.op === 'convertAllNotes' ||
    op.op === 'setNoteProperties'
  ) {
    return 'invalidArgs';
  }

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

  if (op.op === 'deleteBlock') return validateDeleteBlock(part, op.blockId);

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

  if (op.op === 'insertCommentMarker') {
    const paragraph = findNode(part, op.paragraphId);
    if (!paragraph) return 'unknown-paragraph';
    if (!isParagraph(paragraph)) return 'not-a-paragraph';
    if (!Number.isInteger(op.offset) || op.offset < 0 || op.offset > paragraphLength(paragraph)) {
      return 'offset-out-of-range';
    }
    if (typeof op.commentId !== 'string' || !/^\d+$/.test(op.commentId)) {
      return 'invalid-property-value';
    }
    return null;
  }

  if (
    op.op === 'acceptRevision' ||
    op.op === 'rejectRevision' ||
    op.op === 'acceptAllRevisions' ||
    op.op === 'rejectAllRevisions'
  ) {
    if (op.op === 'acceptRevision' || op.op === 'rejectRevision') {
      const address = op.revision;
      if (typeof address?.id !== 'string' || address.id.length === 0)
        return 'invalid-property-value';
      // The schema makes `@w:author` required, so an address without one could not match a
      // well-formed revision and is a caller error rather than a miss.
      if (typeof address.author !== 'string') return 'invalid-property-value';
      if (address.date !== undefined && typeof address.date !== 'string') {
        return 'invalid-property-value';
      }
    }
    // Presence and resolvability are decided by the same walk that applies the op, so they
    // are checked there rather than duplicated into a second traversal that could disagree.
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
    case 'proposeParagraphMerge': {
      if (typeof op.revision?.author !== 'string' || op.revision.author.length === 0) {
        return 'invalid-property-value';
      }
      return null;
    }
    case 'setParagraphMarkRevision': {
      if (op.kind !== 'ins' && op.kind !== 'del') return 'invalid-range';
      // `CT_TrackChange` makes `@w:author` required, so a mark with none is invalid XML.
      if (typeof op.revision?.author !== 'string' || op.revision.author.length === 0) {
        return 'invalid-property-value';
      }
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
    case 'insertPageField': {
      if (!Number.isInteger(op.offset) || op.offset < 0 || op.offset > length) {
        return 'offset-out-of-range';
      }
      if (splitsSurrogate(paragraph, op.offset)) return 'splits-surrogate-pair';
      if (
        op.field !== 'PAGE' &&
        op.field !== 'NUMPAGES' &&
        op.field !== 'SECTIONPAGES' &&
        op.field !== 'PAGE_X_OF_Y'
      ) {
        return 'invalidArgs';
      }
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

// Backward-compatible re-exports: callers that imported vocabulary/segmentation/section
// helpers from this module keep resolving here. Canonical homes are the modules above.
export {
  ACCEPTED_PARAGRAPH_PROPERTIES,
  ACCEPTED_RUN_PROPERTIES,
  TREE_DOC_OP_KINDS,
  type AcceptedParagraphProperty,
  type AcceptedRunProperty,
  type ImpactClass,
  type OoxmlProperty,
  type RevisionAddress,
  type RevisionAttributionInput,
  type TreeDocOp,
  type TreeDocOpKind,
  type TreeOpEffect,
  type TreeOpRejection,
  type TreeOpResult,
} from './tree-op-types.ts';
export {
  isParagraph,
  paragraphOffsetIndex,
  runsUnder,
  segmentsOf,
  type OffsetSpan,
  type ParagraphOffsetIndex,
  type Segment,
} from './tree-op-segments.ts';
export {
  allSectionNodes,
  bodyNodeOf,
  bodySectionOf,
  currentSectionMetrics,
  isTableNested,
  metricsOfSection,
  plannedSectionDimensions,
  sectionAttribute,
  sectionChild,
  targetSectionNodes,
  type SectionMetrics,
} from './tree-op-section-address.ts';
