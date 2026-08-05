// Safe PAGE / NUMPAGES / SECTIONPAGES field projection for read-only page furniture.
//
// Field instructions are attacker-controlled and MUST NEVER execute. Recognition of
// allowlisted instructions and the shared complex-field scan machine live in
// `field-instruction.ts`. This module projects those fields into measurable pieces and
// finalizes furniture once document page counts are known.
//
// Well-formed complex fields and `w:fldSimple` each contribute one UTF-16 model unit
// (aligned with `paragraphTextOf` / `segmentsOf`). Cached result text is not independently
// editable. Malformed fields demote so interior content never disappears.
//
// Shipped scope is furniture-only for live page-number evaluation. `w:fldSimple` advances
// the model offset but stays layout-inert for page-field evaluation (body simple fields
// remain deferred).
//
// Projection is a layout concern (span geometry + tab alignment), not paint-time substitution.

import {
  atomicFieldSpansOf,
  contentControlContentChildren,
  hardBreakText,
  isFldSimple,
  WML_NAMESPACE_URI,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlProperty,
} from '@docx-editor.dev/core-contract/store';
import {
  allowlistedPageField,
  consumeScanNode,
  createFieldParseState,
  createScanBudget,
  detectStoryPageFields,
  ingestInstrTextBounded,
  isCollectingInstruction,
  isFldChar,
  isInsideFieldResult,
  isInstrText,
  MAX_FIELD_INSTRUCTION_CHARS,
  MAX_FIELD_NESTING,
  MAX_STORY_FIELD_SCAN_DEPTH,
  MAX_STORY_FIELD_SCAN_NODES,
  NO_STORY_PAGE_FIELDS,
  normalizeFieldInstruction,
  onFldCharBegin,
  onFldCharEnd,
  onFldCharSeparate,
  resetFieldParseState,
  type AllowlistedPageField,
  type StoryPageFieldNeeds,
} from './field-instruction.ts';
import { formatDecimal, formatNumFmt } from './numbering-format.ts';
import {
  isProjectableNoteAtom,
  projectedNoteMarkText,
  type NoteMarkContext,
} from './note-projection.ts';
import {
  DEFAULT_REVISION_DISPLAY_MODE,
  MAX_REVISION_DEPTH,
  NO_REVISIONS,
  isRevisionWrapper,
  revisionAttributionOf,
  revisionsAreDeletion,
  revisionsVisible,
  withRevision,
  type RevisionAttribution,
  type RevisionDisplayMode,
} from './revision-projection.ts';
import { resolveRunStyle, type ResolvedRunStyle } from './run-style.ts';
import type {
  HeaderFooterStoryRecord,
  SemanticLayout,
  SpanLinkRecord,
} from './semantic-records.ts';

// Re-export instruction recognition + detection so existing layout-local imports stay stable.
export {
  MAX_FIELD_INSTRUCTION_CHARS,
  MAX_FIELD_NESTING,
  MAX_STORY_FIELD_SCAN_DEPTH,
  MAX_STORY_FIELD_SCAN_NODES,
  NO_STORY_PAGE_FIELDS,
  allowlistedPageField,
  detectStoryPageFields,
  normalizeFieldInstruction,
  type AllowlistedPageField,
  type StoryPageFieldNeeds,
};

/** Optional per-run merge of inherited + direct `rPr` (character styles, defaults). */
export type RunPropertyCascader = (
  inherited: readonly OoxmlProperty[],
  direct: readonly OoxmlProperty[]
) => readonly OoxmlProperty[];

/**
 * Page-field evaluation context for furniture projection.
 *
 * `pageNumber` is the displayed PAGE value after section `w:pgNumType/@w:start` (1-based).
 * `pageCount` is document NUMPAGES. `sectionPageCount` is SECTIONPAGES for the attached
 * section. `format` is the authored `w:pgNumType/@w:fmt` applied only to PAGE.
 */
export interface FieldPageContext {
  readonly pageNumber: number;
  readonly pageCount: number;
  /** SECTIONPAGES; defaults to `pageCount` when omitted (single-section callers). */
  readonly sectionPageCount?: number;
  /** Authored ST_NumberFormat for PAGE; absent → decimal. */
  readonly format?: string;
}

/**
 * Per-page source for {@link finalizePageFieldProjection}, attached before document-level
 * page count is known. `pageCount` (NUMPAGES) is filled at finalize from `layout.pages.length`.
 */
export interface PageFieldSource {
  readonly pageNumber: number;
  readonly sectionPageCount: number;
  readonly format?: string;
}

/**
 * A `w:ptab` — the ABSOLUTE-position tab (ECMA-376 §17.3.3.16), which is what a table of
 * contents line is actually made of.
 *
 * Not a `w:tab`: it carries its own destination and leader instead of advancing to the next
 * stop in `w:tabs`, so a paragraph needs no tab stops at all to lay one out. A document that
 * uses these has no `w:tabs` to find, which is why an engine that only models `w:tab` shows
 * the entries and page numbers run together with no dots between them.
 */
export interface PositionalTab {
  readonly alignment: 'left' | 'center' | 'right';
  readonly relativeTo: 'margin' | 'indent' | 'leftMargin';
  readonly leader?: 'dot' | 'hyphen' | 'underscore' | 'middleDot';
}

/**
 * One measurable piece produced while walking runs (including projected field results).
 *
 * Projected page-field text covers the single atomic model unit for a well-formed field
 * (`start`..`end` is length 1, matching `paragraphTextOf`). Empty-result allowlisted fields
 * still occupy that unit. Furniture is read-only / non-selectable at the surface; the range
 * stays canonical-aligned for layout consumers.
 */
export interface FieldAwarePiece {
  readonly text: string;
  readonly props: readonly OoxmlProperty[];
  readonly style: ResolvedRunStyle;
  /** UTF-16 model offset range; projected fields cover suppressed cached-result text when present. */
  readonly start: number;
  readonly end: number;
  /** True when text substitutes for a model unit (page field or inert atomic cache). */
  readonly projected?: boolean;
  /**
   * Set when this piece is a `w:ptab`. Its range is ZERO-WIDTH: the element is generic in
   * the canonical tree and contributes nothing to the paragraph's text, so it must advance
   * the line without moving a single model offset — anything else and every offset after it
   * would disagree with the store.
   */
  readonly positionalTab?: PositionalTab;
  /** The hyperlink this piece came from, already sanitized, or absent for ordinary text. */
  readonly link?: SpanLinkRecord;
  /**
   * When set, layout measures this string instead of `text` (eachPage note-mark width
   * reservation). Paint still uses `text`.
   */
  readonly measureText?: string;
  /** Note citation / mark navigation for paint (body ↔ note). */
  readonly noteNav?: {
    readonly scopeId: string;
    readonly direction: 'to-note' | 'to-body';
  };
  /**
   * The revision wrappers enclosing this text, outermost first, absent when untracked.
   *
   * A stack rather than a single value because revisions nest: an insertion by one author
   * inside a deletion by another is ordinary in a two-round review, and both matter — the
   * outer one decides whether the content exists, the inner one is still someone's pending
   * decision about it.
   */
  readonly revisions?: readonly RevisionAttribution[];
}

/** A half-open model-offset range, in the paragraph's own UTF-16 offset space. */
export interface ModelRange {
  readonly start: number;
  readonly end: number;
}

type MutableModelRange = { start: number; end: number };

/** Append a range, coalescing with the previous one when they touch or overlap. */
function appendModelRange(ranges: MutableModelRange[], start: number, end: number): void {
  if (end <= start) return;
  const last = ranges[ranges.length - 1];
  if (last && last.end >= start) {
    last.end = Math.max(last.end, end);
    return;
  }
  ranges.push({ start, end });
}

const PTAB_ALIGNMENTS = new Set(['left', 'center', 'right']);
const PTAB_RELATIVE_TO = new Set(['margin', 'indent', 'leftMargin']);
const PTAB_LEADERS = new Set(['dot', 'hyphen', 'underscore', 'middleDot']);

/**
 * Read a `w:ptab` off a run child, or null when it is not one.
 *
 * The element is generic in the canonical tree (nothing models it), so this reads its
 * attributes directly and validates every one against its closed enumeration — the values
 * come from the file and go on to drive geometry. `w:leader="none"`, and anything
 * unrecognised, resolves to no leader rather than rejecting the tab: the ADVANCE is still
 * authored, and dropping it would run the text together.
 */
export function positionalTabOf(node: OoxmlNode): PositionalTab | null {
  if (node.kind === 'textValue' || node.localName !== 'ptab') return null;
  if (node.namespaceUri !== WML_NAMESPACE_URI) return null;
  let alignment = 'left';
  let relativeTo = 'margin';
  let leader: string | undefined;
  for (const attribute of node.attributes) {
    if (attribute.namespaceUri !== WML_NAMESPACE_URI) continue;
    if (attribute.localName === 'alignment') alignment = attribute.value;
    else if (attribute.localName === 'relativeTo') relativeTo = attribute.value;
    else if (attribute.localName === 'leader') leader = attribute.value;
  }
  return {
    alignment: (PTAB_ALIGNMENTS.has(alignment) ? alignment : 'left') as PositionalTab['alignment'],
    relativeTo: (PTAB_RELATIVE_TO.has(relativeTo)
      ? relativeTo
      : 'margin') as PositionalTab['relativeTo'],
    ...(leader !== undefined && PTAB_LEADERS.has(leader)
      ? { leader: leader as NonNullable<PositionalTab['leader']> }
      : {}),
  };
}

/**
 * How layout turns a typed `w:hyperlink` node into the sanitized record spans carry.
 *
 * Injected rather than computed here because resolving `r:id` needs the PACKAGE's
 * relationships and this module only ever sees one part's tree. `null` means the caller
 * declined to project — the runs still measure and paint, they simply carry no link, which is
 * the right degradation: text is never lost for want of a target.
 */
export type HyperlinkProjector = (link: OoxmlNode) => SpanLinkRecord | null;

/**
 * Format a displayed PAGE value through the shared ST_NumberFormat resolver.
 *
 * Unknown / script-specific formats fall back to decimal (same convention as list markers).
 * `none` / `bullet` are meaningless for page numbers and also fall back to decimal so a
 * hostile fmt cannot blank the furniture.
 */
export function formatPageNumber(value: number, format: string | undefined): string {
  if (!Number.isFinite(value) || value < 0) return '';
  const n = Math.floor(value);
  const fmt = format && format.length > 0 ? format : 'decimal';
  if (fmt === 'none' || fmt === 'bullet') return formatDecimal(n);
  const text = formatNumFmt(fmt, n);
  return text.length > 0 ? text : formatDecimal(n);
}

/** Digit / formatted string for an allowlisted page field under a page context. */
export function projectPageFieldValue(
  kind: AllowlistedPageField,
  context: FieldPageContext
): string {
  if (kind === 'PAGE') return formatPageNumber(context.pageNumber, context.format);
  const value =
    kind === 'NUMPAGES' ? context.pageCount : (context.sectionPageCount ?? context.pageCount);
  // Layout-derived counts are already bounded by pagination; still refuse non-finite junk.
  if (!Number.isFinite(value) || value < 0) return '';
  return formatDecimal(Math.floor(value));
}

function runPropertiesOf(
  run: OoxmlNode,
  inherited: readonly OoxmlProperty[],
  cascadeRuns?: RunPropertyCascader
): OoxmlProperty[] {
  const direct = propertiesOfRunContainer(
    run.kind === 'run' ? run.children.find((grand) => grand.kind === 'runProperties') : undefined
  );
  if (cascadeRuns) return [...cascadeRuns(inherited, direct)];
  return inherited.length === 0 ? direct : [...inherited, ...direct];
}

export function propertiesOfRunContainer(container: OoxmlNode | undefined): OoxmlProperty[] {
  if (!container || container.kind === 'textValue') return [];
  const props: OoxmlProperty[] = [];
  for (const child of container.children) {
    if (child.kind === 'textValue') continue;
    const attributes: Record<string, string> = {};
    for (const entry of child.attributes) attributes[entry.localName] = entry.value;
    props.push(
      Object.keys(attributes).length > 0
        ? { localName: child.localName, attributes }
        : { localName: child.localName }
    );
  }
  return props;
}

/** Model text contributed by one typed run child (same vocabulary as `paragraphTextOf`). */
function modelTextOfRunChild(grand: OoxmlNode): string {
  // `w:delText` holds real characters at a real position, so it counts in the model offset
  // space exactly like `w:t`. Whether it is LAID OUT is a separate question, answered by the
  // enclosing revision and the display mode.
  if (grand.kind === 'text' || grand.kind === 'deletedText') {
    let text = '';
    for (const value of grand.children) if (value.kind === 'textValue') text += value.value;
    return text;
  }
  if (grand.kind === 'tab') return '\t';
  if (grand.kind === 'hardBreak') return hardBreakText(grand);
  return '';
}

/**
 * Pending live or inert-cache projection for one atomic field unit.
 *
 * Well-formed complex fields contribute exactly one UTF-16 model unit. Cached result text
 * is not independently addressable — it only donates display text and result-run style.
 * Missing `end` demotes: buffered cache is flushed as ordinary pieces with real lengths.
 */
interface PendingFieldProjection {
  /** Allowlisted kind when live-projecting; null paints inert cached text at the atom. */
  kind: AllowlistedPageField | null;
  /** True when this pending field is a well-formed atomic unit (begin will close). */
  atomic: boolean;
  atomStart: number;
  props: readonly OoxmlProperty[];
  style: ResolvedRunStyle;
  capturedResultStyle: boolean;
  /** Cached result text (for inert display or demotion flush). */
  cachedText: string;
  /** Demotion-only: ordinary pieces when the field fails to close. */
  buffered: FieldAwarePiece[];
  /** Demotion-only running offset mirror while buffering ordinary pieces. */
  bufferOffset: number;
}

/**
 * Flatten a paragraph into measurable pieces, projecting allowlisted page fields when a
 * page context is supplied (furniture finalize / `withPageContext`).
 *
 * Well-formed complex fields (`begin`→`end`) and typed/generic `w:fldSimple` each contribute
 * one UTF-16 model unit so offsets stay aligned with `paragraphTextOf`. Cached result text
 * is never independently editable. Malformed fields demote: markers contribute nothing and
 * interior result text stays visible at its natural length.
 *
 * `w:fldSimple` advances the model offset by one but stays layout-inert for page-field
 * evaluation (body simple fields remain deferred) — no piece is emitted for the atom.
 *
 * Hidden runs (`w:vanish`) emit no piece while still advancing offsets.
 */
export function piecesOfParagraph(
  paragraph: OoxmlNode,
  inheritedRunProperties: readonly OoxmlProperty[] = [],
  pageContext?: FieldPageContext,
  cascadeRuns?: RunPropertyCascader,
  projectLink?: HyperlinkProjector,
  noteMarks?: NoteMarkContext,
  displayMode: RevisionDisplayMode = DEFAULT_REVISION_DISPLAY_MODE,
  deletedRanges?: MutableModelRange[]
): FieldAwarePiece[] {
  if (paragraph.kind === 'textValue') return [];
  if (paragraph.kind !== 'paragraph') return [];

  const pieces: FieldAwarePiece[] = [];
  let offset = 0;
  /** The link the walk is currently inside, so every piece it emits is tagged with it. */
  let currentLink: SpanLinkRecord | undefined;

  const atoms = atomicFieldSpansOf(paragraph as OoxmlParagraphNode, {
    maxNesting: MAX_FIELD_NESTING,
    maxInstructionChars: MAX_FIELD_INSTRUCTION_CHARS,
  });
  const atomBeginIds = new Set(
    atoms.filter((span) => span.kind === 'complex').map((s) => s.node.id)
  );
  const coveredIds = new Set<string>();
  for (const span of atoms) {
    for (const id of span.removeNodeIds) coveredIds.add(id);
  }

  const field = createFieldParseState();
  const budget = createScanBudget();
  let pending: PendingFieldProjection | null = null;
  /** Outermost begin id when the open field is atomic. */
  let openAtomicBeginId: string | null = null;
  /**
   * The revision wrappers enclosing the run being processed, outermost first.
   *
   * Held here rather than threaded through every emitter because the walk is synchronous and
   * depth-first: it is set on the way into a wrapper and restored on the way out, so every
   * piece emitted in between sees exactly its own enclosing stack.
   */
  let revisions: readonly RevisionAttribution[] = NO_REVISIONS;

  const push = (
    text: string,
    props: readonly OoxmlProperty[],
    style: ResolvedRunStyle,
    projected: boolean,
    start: number,
    end: number,
    extras?: {
      readonly positionalTab?: PositionalTab;
      readonly measureText?: string;
      readonly noteNav?: FieldAwarePiece['noteNav'];
    }
  ): void => {
    if (text.length === 0 && !projected) return;
    const link = currentLink ? { link: currentLink } : {};
    const attribution = revisions.length === 0 ? {} : { revisions };
    if (projected) {
      pieces.push({
        text,
        props,
        style,
        start,
        end,
        projected: true,
        ...(extras?.measureText !== undefined ? { measureText: extras.measureText } : {}),
        ...(extras?.noteNav ? { noteNav: extras.noteNav } : {}),
        ...link,
        ...attribution,
      });
      return;
    }
    if (text.length === 0) return;
    pieces.push({
      text,
      props,
      style,
      start,
      end,
      ...(extras?.positionalTab ? { positionalTab: extras.positionalTab } : {}),
      ...link,
      ...attribution,
    });
  };

  const commitAtomicField = (): void => {
    if (!pending || !pending.atomic) {
      pending = null;
      openAtomicBeginId = null;
      return;
    }
    const start = pending.atomStart;
    const end = start + 1;
    if (pending.style.hidden) {
      // Vanish: no piece, atom still advances (already counted at begin).
      pending = null;
      openAtomicBeginId = null;
      return;
    }
    if (pending.kind && pageContext) {
      const text = projectPageFieldValue(pending.kind, pageContext);
      push(text, pending.props, pending.style, true, start, end);
    } else if (pending.cachedText.length > 0) {
      // Inert non-page field: paint cached result as layout-owned substitution for the
      // single model unit (same as live PAGE) so hit-test/span ranges stay one atom.
      push(pending.cachedText, pending.props, pending.style, true, start, end);
    }
    pending = null;
    openAtomicBeginId = null;
  };

  const abandonPending = (): void => {
    if (!pending) return;
    if (pending.atomic) {
      // Missing end after an atomic begin should not happen (atoms require end). If the
      // scan budget aborts mid-field, roll the atom back and flush any buffered cache.
      offset = pending.atomStart;
      for (const piece of pending.buffered) {
        pieces.push({
          ...piece,
          start: offset,
          end: offset + (piece.end - piece.start),
        });
        offset += piece.end - piece.start;
      }
      if (pending.cachedText.length > 0 && pending.buffered.length === 0) {
        push(
          pending.cachedText,
          pending.props,
          pending.style,
          false,
          offset,
          offset + pending.cachedText.length
        );
        offset += pending.cachedText.length;
      }
    } else {
      for (const piece of pending.buffered) pieces.push(piece);
      offset = pending.bufferOffset;
    }
    pending = null;
    openAtomicBeginId = null;
  };

  const pushRunContent = (
    grand: OoxmlNode,
    props: readonly OoxmlProperty[],
    style: ResolvedRunStyle
  ): void => {
    if (isProjectableNoteAtom(grand)) {
      const projected = projectedNoteMarkText(grand, noteMarks);
      const start = offset;
      const end = start + 1;
      offset = end;
      if (style.hidden) return;
      if (!projected) return;
      // Empty display (customMarkFollows / separator / dangling) still advances the model
      // unit; only non-empty marks emit a measurable projected piece.
      if (projected.text.length === 0 && !projected.measureText) return;
      const noteNav =
        projected.scopeId && projected.nav
          ? { scopeId: projected.scopeId, direction: projected.nav }
          : undefined;
      push(
        projected.text.length > 0 ? projected.text : (projected.measureText ?? ''),
        props,
        style,
        true,
        start,
        end,
        {
          ...(projected.measureText !== undefined ? { measureText: projected.measureText } : {}),
          ...(noteNav ? { noteNav } : {}),
        }
      );
      return;
    }
    // A `w:ptab` advances the line but occupies NO model offset, so it is pushed with a
    // zero-width range and the offset does not move.
    const positional = positionalTabOf(grand);
    if (positional) {
      if (!style.hidden)
        push('\t', props, style, false, offset, offset, { positionalTab: positional });
      return;
    }
    const text = modelTextOfRunChild(grand);
    if (text.length === 0) return;
    // A revision the display mode resolves away is suppressed the same way `w:vanish` is, and
    // for the same reason: the offset space belongs to the model, not to the view, so the
    // characters keep their offsets whether or not they are laid out. `w:delText` outside any
    // deletion is malformed and is suppressed unconditionally, because the one thing that must
    // never happen is deleted text flowing as ordinary text.
    const deleted = revisionsAreDeletion(revisions);
    const suppressed =
      style.hidden ||
      !revisionsVisible(revisions, displayMode) ||
      (grand.kind === 'deletedText' && !deleted);
    if (!suppressed) push(text, props, style, false, offset, offset + text.length);
    // Deleted characters are recorded whether or not they were laid out. They occupy model
    // offsets in every mode, and the caret must step over them in every mode — including the
    // proposed result, where they produce no span at all and an offset-by-offset walk would
    // otherwise stop at invisible positions.
    if (deleted && deletedRanges) appendModelRange(deletedRanges, offset, offset + text.length);
    offset += text.length;
  };

  const processRun = (run: OoxmlNode, runDepth: number): void => {
    if (run.kind !== 'run') return;
    const props = runPropertiesOf(run, inheritedRunProperties, cascadeRuns);
    const style = resolveRunStyle(props);

    for (const grand of run.children) {
      if (!consumeScanNode(budget)) {
        abandonPending();
        resetFieldParseState(field);
        if (grand.kind === 'runProperties') continue;
        if (isFldChar(grand, 'begin') || isFldChar(grand, 'separate') || isFldChar(grand, 'end')) {
          continue;
        }
        if (isInstrText(grand)) continue;
        if (coveredIds.has(grand.id) && openAtomicBeginId === null) continue;
        pushRunContent(grand, props, style);
        continue;
      }

      if (grand.kind === 'runProperties') continue;

      if (isFldChar(grand, 'begin')) {
        const atomic = atomBeginIds.has(grand.id);
        onFldCharBegin(field);
        if (field.nesting === 1) {
          abandonPending();
          openAtomicBeginId = atomic ? grand.id : null;
          pending = {
            kind: null,
            atomic,
            atomStart: offset,
            props,
            style,
            capturedResultStyle: false,
            cachedText: '',
            buffered: [],
            bufferOffset: offset,
          };
          if (atomic) {
            // Reserve the single model unit up front so surrounding offsets stay stable.
            offset += 1;
          }
        }
        continue;
      }

      if (isInstrText(grand)) {
        ingestInstrTextBounded(field, grand, budget, runDepth + 1);
        continue;
      }

      if (isFldChar(grand, 'separate')) {
        const outermostSeparate = field.nesting === 1 && field.phase === 'instruction';
        const kind = onFldCharSeparate(field);
        if (outermostSeparate && pending) {
          pending.kind = kind && pageContext ? kind : null;
          // Prefer separate-run style until a measurable result run donates one.
          pending.props = props;
          pending.style = style;
        }
        continue;
      }

      if (isFldChar(grand, 'end')) {
        const outermostEnd = field.nesting === 1;
        onFldCharEnd(field);
        if (outermostEnd) {
          if (pending?.atomic) commitAtomicField();
          else abandonPending();
        }
        continue;
      }

      if (isCollectingInstruction(field)) {
        // Only well-formed atomic fields suppress instruction-phase run content.
        // Demoted / malformed opens must not make surrounding text disappear.
        if (pending?.atomic) continue;
      }

      if (pending && isInsideFieldResult(field)) {
        const text = modelTextOfRunChild(grand);
        if (text.length === 0) continue;

        // A field can be tracked as a whole — Word writes a deleted hyperlink as `w:del`
        // around the begin/instr/separate/result/end run — and its result text is BUFFERED
        // here and flushed when the field closes, by which time the walk has already left the
        // wrapper and `revisions` is empty again. Apply the suppression at buffer time or a
        // deleted field's result survives the proposed result the deletion was accepted into.
        const fieldDeleted = revisionsAreDeletion(revisions);
        const fieldSuppressed =
          !revisionsVisible(revisions, displayMode) ||
          (grand.kind === 'deletedText' && !fieldDeleted);
        if (fieldSuppressed) {
          if (!pending.atomic) {
            offset += text.length;
            pending.bufferOffset = offset;
          }
          if (fieldDeleted && deletedRanges) {
            appendModelRange(deletedRanges, offset - text.length, offset);
          }
          continue;
        }

        if (pending.atomic) {
          // Atomic unit: cache donates display text/style only — offset already reserved.
          if (style.hidden) continue;
          if (!pending.capturedResultStyle) {
            pending.props = props;
            pending.style = style;
            pending.capturedResultStyle = true;
          }
          pending.cachedText += text;
          continue;
        }

        // Demoted field: result text is ordinary addressable content.
        if (style.hidden) {
          offset += text.length;
          pending.bufferOffset = offset;
          continue;
        }
        if (!pending.capturedResultStyle) {
          pending.props = props;
          pending.style = style;
          pending.capturedResultStyle = true;
        }
        pending.buffered.push({
          text,
          props,
          style,
          start: offset,
          end: offset + text.length,
        });
        offset += text.length;
        pending.bufferOffset = offset;
        continue;
      }

      // Covered by a closed atomic field we already committed — should not reach here
      // because those nodes are skipped via the begin→end control flow. Still guard.
      if (coveredIds.has(grand.id) && openAtomicBeginId === null && atomBeginIds.size > 0) {
        // Node belongs to a later/earlier atom; if we're between fields, skip chrome only.
      }

      pushRunContent(grand, props, style);
    }
  };

  /**
   * Walk content in document order, descending through every RUN CONTAINER.
   *
   * Typed runs contribute measurable / selectable text. Generic siblings stay structurally
   * preserved but layout-inert for page-field evaluation; typed/generic `w:fldSimple` advances
   * one model unit (atomic) without emitting a piece. The exceptions are the two containers
   * that are not content themselves but hold runs that are:
   *
   *   - `w:hyperlink`. Skipping it is what made every link's words vanish from the painted
   *     page while still occupying model offsets.
   *   - the revision wrappers. Skipping them dropped tracked content entirely, so the reader
   *     saw a third text belonging to neither the original nor the proposal.
   *
   * Either can hold the other, and a link inside a tracked insertion is ordinary, so the walk
   * is one recursion rather than two passes.
   *
   * The complex-field machine spans runs in document order within the paragraph, so descending
   * must not restart it — the walk visits runs in the same order a reader sees them, whatever
   * their nesting.
   */
  if (!consumeScanNode(budget)) return pieces;
  const processInline = (child: OoxmlNode, depth: number): void => {
    if (isFldSimple(child)) {
      offset += 1;
      return;
    }
    if (child.kind === 'run') {
      processRun(child, depth);
      return;
    }
    if (depth > MAX_STORY_FIELD_SCAN_DEPTH || depth >= MAX_REVISION_DEPTH) return;
    // An inline content control is a run container like the other two: its characters are the
    // paragraph's, they carry the paragraph's offsets, and a walk that stopped here painted a
    // sentence with the control's own text missing out of the middle of it.
    if (child.kind === 'contentControl') {
      for (const inner of contentControlContentChildren(child)) processInline(inner, depth + 1);
      return;
    }
    if (child.kind === 'hyperlink') {
      // The link is projected ONCE per element, not per run: sanitization is not free, and a
      // link's runs must all carry the same record so paint can group them by identity.
      const previous = currentLink;
      currentLink = projectLink?.(child) ?? undefined;
      for (const inner of child.children) processInline(inner, depth + 1);
      currentLink = previous;
      return;
    }
    if (!isRevisionWrapper(child)) return;
    const attribution = revisionAttributionOf(child);
    if (!attribution) return;
    if (!consumeScanNode(budget)) return;
    const enclosing = revisions;
    revisions = withRevision(enclosing, attribution);
    for (const inner of child.children) processInline(inner, depth + 1);
    revisions = enclosing;
  };
  // Paragraph root counts as depth 0; run children sit at depth 1.
  for (const child of paragraph.children) processInline(child, 1);
  // Malformed field missing end: demote — surface cached/buffered text, no live projection.
  abandonPending();

  return pieces;
}

/** True when any allowlisted page field is present. */
export function storyNeedsPageFields(needs: StoryPageFieldNeeds): boolean {
  return needs.hasPage || needs.hasNumPages || needs.hasSectionPages;
}

/**
 * Cache-key token for a page context under known field needs.
 *
 * Absent context and field-free stories share the empty baseline key. Keys include only the
 * dimensions the story actually reads so NUMPAGES-only / SECTIONPAGES-only stories reuse one
 * layout across every sheet that shares that count, while PAGE (and format) still distinguish
 * sheets whose measured digit widths differ.
 */
export function fieldPageContextToken(
  context: FieldPageContext | undefined,
  needs: StoryPageFieldNeeds = NO_STORY_PAGE_FIELDS
): string {
  if (!context) return '';
  if (!storyNeedsPageFields(needs)) return '';
  const parts: string[] = [];
  if (needs.hasPage) {
    parts.push(`p${context.pageNumber}`);
    if (context.format) parts.push(`f${context.format}`);
  }
  if (needs.hasNumPages) parts.push(`n${context.pageCount}`);
  if (needs.hasSectionPages) parts.push(`s${context.sectionPageCount ?? context.pageCount}`);
  return `|fld:${parts.join('/')}`;
}

/**
 * Attach section-local PAGE/SECTIONPAGES sources to remapped sheet pages.
 *
 * `displayedStart` is the 1-based PAGE value of the first page in `pages` (after
 * `w:pgNumType/@w:start` and cross-section continuation). NUMPAGES is filled later at
 * document finalize.
 *
 * Pages whose existing {@link PageFieldSource} already matches are returned by identity so
 * incremental layout can keep sheet records stable across no-op re-annotation.
 */
export function withPageFieldSources(
  pages: readonly import('./semantic-records.ts').PageRecord[],
  displayedStart: number,
  sectionPageCount: number,
  format: string | undefined
): import('./semantic-records.ts').PageRecord[] {
  let changed = false;
  const next = pages.map((page, index) => {
    const pageNumber = displayedStart + index;
    const existing = page.pageFieldSource;
    if (
      existing &&
      existing.pageNumber === pageNumber &&
      existing.sectionPageCount === sectionPageCount &&
      existing.format === format
    ) {
      return page;
    }
    changed = true;
    return {
      ...page,
      pageFieldSource: {
        pageNumber,
        sectionPageCount,
        ...(format ? { format } : {}),
      },
    };
  });
  return changed ? next : (pages as import('./semantic-records.ts').PageRecord[]);
}

/**
 * Project allowlisted PAGE/NUMPAGES/SECTIONPAGES onto every page's read-only furniture once
 * the document page count is known. Body stories are unchanged.
 *
 * Uses {@link PageFieldSource} when present (section restart + SECTIONPAGES + fmt). Absent
 * source keeps physical 1-based indices (`page.index + 1`) and treats the whole document as
 * one section — the empty-`pgNumType` comprehensive-fixture behaviour.
 */
export function finalizePageFieldProjection(layout: SemanticLayout): SemanticLayout {
  const pageCount = layout.pages.length;
  if (pageCount === 0) return layout;

  let changed = false;
  const pages = layout.pages.map((page) => {
    const source = page.pageFieldSource;
    const context: FieldPageContext = {
      pageNumber: source?.pageNumber ?? page.index + 1,
      pageCount,
      sectionPageCount: source?.sectionPageCount ?? pageCount,
      ...(source?.format ? { format: source.format } : {}),
    };
    const project = (
      story: HeaderFooterStoryRecord | undefined
    ): HeaderFooterStoryRecord | undefined => {
      if (!story?.pageFieldProjector) return story;
      changed = true;
      const projected = story.pageFieldProjector(context);
      // Strip the projector from the published record.
      const { pageFieldProjector: _drop, ...rest } = projected;
      void _drop;
      return rest;
    };
    const header = project(page.header);
    const footer = project(page.footer);
    if (header === page.header && footer === page.footer) return page;
    return {
      ...page,
      ...(header !== undefined ? { header } : {}),
      ...(footer !== undefined ? { footer } : {}),
    };
  });

  return changed ? { revision: layout.revision, pages } : layout;
}
