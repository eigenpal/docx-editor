// The op vocabulary and effect/rejection contracts (tree-ops seam).
//
// This module owns what an op IS — the declarative, JSON-safe `TreeDocOp` shapes, the
// accepted property boundaries, and the effect/rejection contracts. Validation lives in
// tree-op-validate.ts; application lives in tree-op-apply.ts; both re-export via tree-ops.ts.

import type { OoxmlPart } from '../package/ooxml-tree.ts';

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

/**
 * The identity of one revision WITHIN a part: `@w:id`, `@w:author` and `@w:date` together.
 *
 * `@w:id` is not unique and not author-scoped, so `(part, id)` alone would merge two authors'
 * distinct revisions; and one logical revision — a tracked row insertion — is deliberately
 * many elements sharing an id, which a uniqueness rule could not express at all.
 */
export interface RevisionAddress {
  readonly id: string;
  readonly author: string;
  /** Absent when the file wrote no `@w:date`; part of the identity either way. */
  readonly date?: string;
}

/** Who a tracked edit is attributed to. `CT_TrackChange` requires an author. */
export interface RevisionAttributionInput {
  readonly author: string;
  /** ISO-8601. Omitted writes no `@w:date`. */
  readonly date?: string;
}

export type TreeDocOp =
  | {
      readonly op: 'insertText';
      readonly paragraphId: string;
      readonly offset: number;
      readonly text: string;
      /**
       * Write this as a TRACKED insertion, attributed here.
       *
       * On the op rather than on the store, so suggesting stays a decision the surface makes
       * per edit and the write vocabulary stays explicit — a global "everything is tracked
       * now" flag is exactly what `DocEdits` refuses, because it makes the meaning of an op
       * depend on state the op does not carry.
       */
      readonly revision?: RevisionAttributionInput;
      /**
       * Which side of a run BOUNDARY the text joins. Default `'left'` — Word's typing rule:
       * the next character takes the formatting of the character before the caret.
       *
       * `'right'` is for a caller that is not typing but placing text inside the run that
       * STARTS at the offset — the hyperlink editor rewriting a link's display text, where
       * landing left of the boundary would put the new text outside the link. Ignored when
       * the offset falls strictly inside a run, which has no boundary to choose.
       */
      readonly bias?: 'left' | 'right';
    }
  | {
      readonly op: 'deleteText';
      readonly paragraphId: string;
      readonly start: number;
      readonly end: number;
      /** Write this as a TRACKED deletion — the characters stay, wrapped in `w:del`. */
      readonly revision?: RevisionAttributionInput;
    }
  | {
      /**
       * Mark a paragraph's own MARK as inserted or deleted (`w:pPr/w:rPr/w:ins|w:del`,
       * §17.13.5). The change is to the paragraph break itself, so no character carries it.
       */
      readonly op: 'setParagraphMarkRevision';
      readonly paragraphId: string;
      readonly kind: 'ins' | 'del';
      readonly revision: RevisionAttributionInput;
    }
  | {
      /**
       * Propose merging this paragraph into its PREDECESSOR by striking the predecessor's
       * mark. Addressed by the SECOND paragraph so a multi-paragraph delete marks each
       * paragraph's own predecessor rather than stamping the group head N times.
       */
      readonly op: 'proposeParagraphMerge';
      readonly paragraphId: string;
      readonly revision: RevisionAttributionInput;
    }
  | {
      /**
       * Place one piece of comment markup at a model offset.
       *
       * Separate from the comment BODY, which lives in another part: this op is the story half
       * of a comment write, and the two are staged in one package transaction.
       */
      readonly op: 'insertCommentMarker';
      readonly paragraphId: string;
      readonly offset: number;
      readonly commentId: string;
      readonly marker: 'start' | 'end' | 'reference';
    }
  | {
      /**
       * Accept one revision, resolving every site in this part that carries its triple.
       */
      readonly op: 'acceptRevision';
      readonly revision: RevisionAddress;
    }
  | { readonly op: 'rejectRevision'; readonly revision: RevisionAddress }
  | {
      /**
       * Accept every revision in the part, in ONE transaction and one history entry.
       *
       * Deliberately not a loop over `acceptRevision`: a reviewer who accepts a document's
       * changes made one decision, and one undo should restore all of them.
       */
      readonly op: 'acceptAllRevisions';
    }
  | { readonly op: 'rejectAllRevisions' }
  | { readonly op: 'insertTab'; readonly paragraphId: string; readonly offset: number }
  | { readonly op: 'insertHardBreak'; readonly paragraphId: string; readonly offset: number }
  | { readonly op: 'insertPageBreak'; readonly paragraphId: string; readonly offset: number }
  | {
      /**
       * Insert an allowlisted page-number complex field at a UTF-16 offset.
       *
       * `PAGE_X_OF_Y` is PAGE + literal " of " + NUMPAGES in one undoable op. Non-page
       * instructions are refused — never authored through this path.
       */
      readonly op: 'insertPageField';
      readonly paragraphId: string;
      readonly offset: number;
      readonly field: 'PAGE' | 'NUMPAGES' | 'SECTIONPAGES' | 'PAGE_X_OF_Y';
    }
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
      /**
       * When set, format only these runs (field result ownership). Offset range still
       * gates the edit and drives edge splits; without this, multi-run field results that
       * share one atom offset would homogenise under a single property bag.
       */
      readonly targetRunIds?: readonly string[];
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
    }
  | {
      /**
       * Remove a typed block and everything under it.
       *
       * Validation restricts this structural operation to `w:p`, `w:tbl`, and `w:tr`, and
       * refuses removals that would violate required-container or section-mark invariants.
       */
      readonly op: 'deleteBlock';
      readonly blockId: string;
    }
  | {
      /** Allocate an empty header/footer part and declare it on a section. Package-level. */
      readonly op: 'createHeaderFooter';
      readonly sectionIndex: number;
      readonly kind: 'header' | 'footer';
      readonly variant: 'default' | 'first' | 'even';
      /** When true, also set section `w:titlePg` in the same package transaction. */
      readonly titlePage?: boolean;
      /** When true, also set document `w:evenAndOddHeaders` in the same package transaction. */
      readonly evenAndOddHeaders?: boolean;
    }
  | {
      /** Remove a section's declared header/footer reference; GC when orphaned. Package-level. */
      readonly op: 'deleteHeaderFooter';
      readonly sectionIndex: number;
      readonly kind: 'header' | 'footer';
      readonly variant: 'default' | 'first' | 'even';
    }
  | {
      /** Drop a declared ref so the section inherits from the previous. Package-level. */
      readonly op: 'linkToPrevious';
      readonly sectionIndex: number;
      readonly kind: 'header' | 'footer';
      readonly variant: 'default' | 'first' | 'even';
    }
  | {
      /** Clone an inherited part into a new declared reference. Package-level. */
      readonly op: 'unlinkFromPrevious';
      readonly sectionIndex: number;
      readonly kind: 'header' | 'footer';
      readonly variant: 'default' | 'first' | 'even';
    }
  | {
      /**
       * Section/document furniture options: `titlePg`, header/footer distances on the
       * section; `evenAndOddHeaders` document-wide in settings. Package-level.
       */
      readonly op: 'setSectionFurnitureOptions';
      readonly sectionIndex?: number;
      readonly titlePage?: boolean;
      readonly evenAndOddHeaders?: boolean;
      readonly headerDistanceTwips?: number;
      readonly footerDistanceTwips?: number;
    }
  | {
      /**
       * Insert a footnote or endnote: body reference + notes-part body (+ create the
       * notes part/rel/content-type when missing). Package-level; one ModelChange.
       */
      readonly op: 'insertNote';
      readonly noteKind: 'footnote' | 'endnote';
      readonly paragraphId: string;
      readonly offset: number;
    }
  | {
      /**
       * Delete a note body and every matching reference (body, HF, other notes).
       * Package-level; one ModelChange.
       */
      readonly op: 'deleteNote';
      readonly noteKind: 'footnote' | 'endnote';
      readonly noteId: number;
    }
  | {
      /** Convert a footnote ↔ endnote, reallocating id in the target part. Package-level. */
      readonly op: 'convertNote';
      readonly fromKind: 'footnote' | 'endnote';
      readonly noteId: number;
    }
  | {
      /**
       * Convert every normal footnote↔endnote of `fromKind` in one package transaction.
       * One ModelChange / undo unit; bounded by notes-part size.
       */
      readonly op: 'convertAllNotes';
      readonly fromKind: 'footnote' | 'endnote';
    }
  | {
      /**
       * Author `w:footnotePr` / `w:endnotePr` at document (settings) or section scope.
       * Refuse endnote `pageBottom`. Package-level; does not invent props on unedited saves.
       */
      readonly op: 'setNoteProperties';
      readonly scope: 'document' | 'section';
      readonly sectionIndex?: number;
      readonly footnote?: {
        readonly numFmt?: string;
        readonly numRestart?: string;
        readonly position?: string;
        readonly numStart?: number;
      };
      readonly endnote?: {
        readonly numFmt?: string;
        readonly numRestart?: string;
        readonly position?: string;
        readonly numStart?: number;
      };
    };

export type TreeDocOpKind = TreeDocOp['op'];

export const TREE_DOC_OP_KINDS = [
  'insertText',
  'deleteText',
  'setParagraphMarkRevision',
  'proposeParagraphMerge',
  'insertCommentMarker',
  'acceptRevision',
  'rejectRevision',
  'acceptAllRevisions',
  'rejectAllRevisions',
  'insertTab',
  'insertHardBreak',
  'insertPageBreak',
  'insertPageField',
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
  'deleteBlock',
  'createHeaderFooter',
  'deleteHeaderFooter',
  'linkToPrevious',
  'unlinkFromPrevious',
  'setSectionFurnitureOptions',
  'insertNote',
  'deleteNote',
  'convertNote',
  'convertAllNotes',
  'setNoteProperties',
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
 * repaginate everything after it; `global` invalidates every page that shares the
 * edited story (header/footer parts attached to many sections/pages).
 */
export type ImpactClass = 'text-local' | 'paragraph-local' | 'flow-structural' | 'global';

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
  | 'unknown-block'
  | 'not-a-block'
  | 'block-required'
  | 'carries-section-mark'
  /** The transaction named a part the package does not hold. */
  | 'unknown-part'
  /**
   * The transaction would have published a package that does not open: a relationship
   * pointing at a part nobody created, or a part with no declared content type.
   */
  | 'package-invariant'
  /** No revision in this part carries the addressed `(id, author, date)` triple. */
  | 'unknown-revision'
  /**
   * A matched revision is a kind whose accept/reject semantics are structural and not
   * implemented. Refusing is deliberate: removing the markup alone would report the decision
   * applied while leaving the row, cell, or section it describes untouched.
   */
  | 'unsupported-revision'
  | 'tree-invariant'
  /** Malformed lifecycle args / first-section link — mirrors Editor `invalidArgs`. */
  | 'invalidArgs';

export type TreeOpResult =
  | { readonly ok: true; readonly part: OoxmlPart; readonly effect: TreeOpEffect }
  | { readonly ok: false; readonly reason: TreeOpRejection; readonly detail?: string };
