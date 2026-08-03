// Safe PAGE / NUMPAGES field projection for read-only page furniture.
//
// Field instructions are attacker-controlled and MUST NEVER execute. This module recognizes
// only exact normalized allowlisted `PAGE` and `NUMPAGES` instructions (after stripping the
// inert Word formatting switch `\* MERGEFORMAT`). Everything else stays inert: cached result
// text between complex-field `fldChar separate`/`end` may display when it lives in addressable
// run `w:t`, but the instruction is not evaluated, and no external fetch / HTML / DOM
// geometry is consulted.
//
// Shipped scope is furniture-only: header/footer stories re-layout under a per-page context
// via `finalizePageFieldProjection`. Body fields stay deferred — `w:fldSimple` is a generic
// container whose cached children are not addressable by tree ops / `paragraphTextOf`, so
// its content must neither advance semantic model offsets nor emit selectable spans.
//
// Projection is a layout concern (span geometry + tab alignment), not paint-time substitution.
// Detection and piece projection share one bounded complex-field machine: no recursive walk
// over hostile OOXML, and node/depth/character budgets apply to instruction extraction.

import {
  hardBreakText,
  WML_NAMESPACE_URI,
  type OoxmlNode,
  type OoxmlProperty,
} from '@docx-editor.dev/core-contract/store';
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

/** Optional per-run merge of inherited + direct `rPr` (character styles, defaults). */
export type RunPropertyCascader = (
  inherited: readonly OoxmlProperty[],
  direct: readonly OoxmlProperty[]
) => readonly OoxmlProperty[];

/** Caps hostile instruction blobs and nesting depth (fail closed → inert). */
export const MAX_FIELD_INSTRUCTION_CHARS = 256;
export const MAX_FIELD_NESTING = 4;

/**
 * Caps for furniture field-presence scans and paragraph projection walks. Attacker-controlled
 * OOXML can nest arbitrarily under `instrText`; every descendant counts against these budgets.
 * Exceeding any budget fails closed (no detect / no project).
 */
export const MAX_STORY_FIELD_SCAN_NODES = 4096;
export const MAX_STORY_FIELD_SCAN_DEPTH = 64;

/** 1-based physical page index and document page count from semantic layout. */
export interface FieldPageContext {
  readonly pageNumber: number;
  readonly pageCount: number;
}

export type AllowlistedPageField = 'PAGE' | 'NUMPAGES';

/**
 * Which allowlisted complex page fields a header/footer story actually contains.
 *
 * Drives layout reuse: no fields → one baseline; NUMPAGES only → one layout per page count;
 * PAGE (with or without NUMPAGES) → per `(pageNumber, pageCount)` with a bounded cache.
 * `w:fldSimple` never counts — it stays layout-inert.
 */
export interface StoryPageFieldNeeds {
  readonly hasPage: boolean;
  readonly hasNumPages: boolean;
}

export const NO_STORY_PAGE_FIELDS: StoryPageFieldNeeds = Object.freeze({
  hasPage: false,
  hasNumPages: false,
});

/**
 * One measurable piece produced while walking runs (including projected field results).
 *
 * Projected PAGE/NUMPAGES text covers the suppressed cached-result model range when the field
 * authored result runs (`start`..`end` match `paragraphTextOf` offsets for that cache). Empty
 * result fields keep a zero-width range at the insertion offset. Furniture is read-only /
 * non-selectable at the surface; the range still stays canonical-aligned for layout consumers.
 */
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

export interface FieldAwarePiece {
  readonly text: string;
  readonly props: readonly OoxmlProperty[];
  readonly style: ResolvedRunStyle;
  /** UTF-16 model offset range; projected fields cover suppressed cached-result text when present. */
  readonly start: number;
  readonly end: number;
  /** True when text was projected from page context rather than model `w:t`. */
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

const MERGEFORMAT_SUFFIX = /\s*\\\*\s*MERGEFORMAT\s*$/i;

/**
 * Normalize a raw `instrText` blob for allowlist matching.
 *
 * Trims, collapses whitespace, uppercases, and strips a trailing inert `\* MERGEFORMAT`.
 * Returns null when the instruction exceeds the length cap (hostile / truncated → inert).
 */
export function normalizeFieldInstruction(raw: string): string | null {
  if (raw.length > MAX_FIELD_INSTRUCTION_CHARS) return null;
  const collapsed = raw.replace(/\s+/g, ' ').trim().toUpperCase();
  if (collapsed.length > MAX_FIELD_INSTRUCTION_CHARS) return null;
  return collapsed.replace(MERGEFORMAT_SUFFIX, '').trim();
}

/**
 * Exact allowlist for live page-field projection.
 *
 * Broader `isEvaluableField` keywords (DATE, TOC, …) remain unevaluated here on purpose.
 */
export function allowlistedPageField(instruction: string): AllowlistedPageField | null {
  const normalized = normalizeFieldInstruction(instruction);
  if (normalized === 'PAGE' || normalized === 'NUMPAGES') return normalized;
  return null;
}

/** Decimal digit string for an allowlisted page field under a page context. */
export function projectPageFieldValue(
  kind: AllowlistedPageField,
  context: FieldPageContext
): string {
  const value = kind === 'PAGE' ? context.pageNumber : context.pageCount;
  // Layout-derived counts are already bounded by pagination; still refuse non-finite junk.
  if (!Number.isFinite(value) || value < 0) return '';
  return String(Math.floor(value));
}

function attribute(node: OoxmlNode, localName: string): string | undefined {
  if (node.kind === 'textValue' || !('attributes' in node)) return undefined;
  for (const entry of node.attributes ?? []) {
    if (entry.localName === localName) return entry.value;
  }
  return undefined;
}

function isWmlGeneric(node: OoxmlNode, localName: string): boolean {
  return (
    node.kind === 'generic' &&
    'localName' in node &&
    node.localName === localName &&
    node.namespaceUri === WML_NAMESPACE_URI
  );
}

function isFldChar(node: OoxmlNode, type: 'begin' | 'separate' | 'end'): boolean {
  return isWmlGeneric(node, 'fldChar') && attribute(node, 'fldCharType') === type;
}

function isInstrText(node: OoxmlNode): boolean {
  return isWmlGeneric(node, 'instrText');
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

/** Shared node/depth budget for detection and paragraph projection walks. */
interface FieldScanBudget {
  nodes: number;
  exhausted: boolean;
}

function createScanBudget(): FieldScanBudget {
  return { nodes: 0, exhausted: false };
}

function consumeScanNode(budget: FieldScanBudget): boolean {
  if (budget.exhausted) return false;
  budget.nodes += 1;
  if (budget.nodes > MAX_STORY_FIELD_SCAN_NODES) {
    budget.exhausted = true;
    return false;
  }
  return true;
}

/**
 * Shared complex-field parse machine used by furniture detection and piece projection.
 *
 * State spans runs in document order within one paragraph (Word's normal split of
 * begin / instrText / separate / result / end). Callers reset at paragraph boundaries so
 * malformed cross-paragraph fields stay inert. Nested fields beyond {@link MAX_FIELD_NESTING}
 * and instructions past {@link MAX_FIELD_INSTRUCTION_CHARS} fail closed.
 */
type FieldParsePhase = 'idle' | 'instruction' | 'result';

interface ComplexFieldParseState {
  nesting: number;
  instruction: string;
  instructionOverflow: boolean;
  nestingOverflow: boolean;
  phase: FieldParsePhase;
}

function createFieldParseState(): ComplexFieldParseState {
  return {
    nesting: 0,
    instruction: '',
    instructionOverflow: false,
    nestingOverflow: false,
    phase: 'idle',
  };
}

function resetFieldParseState(state: ComplexFieldParseState): void {
  state.nesting = 0;
  state.instruction = '';
  state.instructionOverflow = false;
  state.nestingOverflow = false;
  state.phase = 'idle';
}

function onFldCharBegin(state: ComplexFieldParseState): void {
  if (state.nesting === 0) {
    state.instruction = '';
    state.instructionOverflow = false;
    state.nestingOverflow = false;
    state.phase = 'instruction';
  }
  state.nesting += 1;
  if (state.nesting > MAX_FIELD_NESTING) state.nestingOverflow = true;
}

function onInstrText(state: ComplexFieldParseState, chunk: string): void {
  if (state.phase !== 'instruction' || state.nesting !== 1 || state.instructionOverflow) return;
  if (state.instruction.length + chunk.length > MAX_FIELD_INSTRUCTION_CHARS) {
    state.instructionOverflow = true;
    state.instruction = '';
    return;
  }
  state.instruction += chunk;
}

/**
 * Iteratively extract `instrText` descendants into the field instruction buffer.
 *
 * Every descendant counts against the shared node budget; depth is absolute from the story
 * or paragraph root. No recursive traversal — hostile wide/deep trees cannot bypass caps.
 * Any budget miss marks the instruction inert (`instructionOverflow`).
 */
function ingestInstrTextBounded(
  state: ComplexFieldParseState,
  instrNode: OoxmlNode,
  budget: FieldScanBudget,
  instrDepth: number
): void {
  if (state.phase !== 'instruction' || state.nesting !== 1 || state.instructionOverflow) {
    // Still charge the instrText node itself when the caller has not already.
    return;
  }
  if (instrDepth > MAX_STORY_FIELD_SCAN_DEPTH) {
    state.instructionOverflow = true;
    state.instruction = '';
    return;
  }

  // Explicit stack walk: [node, depth] pairs. The instrText element was already consumed by
  // the caller; only descendants are pushed.
  const stack: { node: OoxmlNode; depth: number }[] = [];
  const children = instrNode.kind === 'textValue' ? [] : (instrNode.children ?? []);
  for (let i = children.length - 1; i >= 0; i -= 1) {
    stack.push({ node: children[i]!, depth: instrDepth + 1 });
  }

  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (!consumeScanNode(budget)) {
      state.instructionOverflow = true;
      state.instruction = '';
      return;
    }
    if (frame.depth > MAX_STORY_FIELD_SCAN_DEPTH) {
      state.instructionOverflow = true;
      state.instruction = '';
      return;
    }
    if (frame.node.kind === 'textValue') {
      onInstrText(state, frame.node.value);
      if (state.instructionOverflow) return;
      continue;
    }
    const grandChildren = frame.node.children ?? [];
    for (let i = grandChildren.length - 1; i >= 0; i -= 1) {
      stack.push({ node: grandChildren[i]!, depth: frame.depth + 1 });
    }
  }
}

/**
 * Advance past `fldChar separate`. Returns an allowlisted kind when the outermost field's
 * instruction is evaluable; otherwise null (inert / nested / overflow).
 */
function onFldCharSeparate(state: ComplexFieldParseState): AllowlistedPageField | null {
  if (state.nesting !== 1 || state.phase !== 'instruction') return null;
  state.phase = 'result';
  if (state.instructionOverflow || state.nestingOverflow) return null;
  return allowlistedPageField(state.instruction);
}

function onFldCharEnd(state: ComplexFieldParseState): void {
  if (state.nesting > 0) state.nesting -= 1;
  if (state.nesting === 0) resetFieldParseState(state);
}

/** True while collecting instruction text — run content in this phase is not measurable. */
function isCollectingInstruction(state: ComplexFieldParseState): boolean {
  return state.phase === 'instruction' && state.nesting >= 1;
}

/** True while inside an outermost field result that was live-projected. */
function isInsideFieldResult(state: ComplexFieldParseState): boolean {
  return state.phase === 'result' && state.nesting >= 1;
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
 * Pending live projection deferred until the field end so result-run style and the full
 * suppressed cached-result model range are known.
 *
 * Deterministic result style rule: use the first cached-result run that contributes measurable
 * model text (`w:t` / tab / hard break). If the result is empty, fall back to the `separate`
 * run's style (Word often authors formatting only on result runs).
 *
 * Cached result runs are buffered (not emitted) while pending. A well-formed `end` discards
 * the buffer and publishes the projection; a missing `end` fails closed (no projection) and
 * flushes the buffer so following offsets stay canonical.
 */
interface PendingPageProjection {
  kind: AllowlistedPageField;
  resultStart: number;
  props: readonly OoxmlProperty[];
  style: ResolvedRunStyle;
  capturedResultStyle: boolean;
  buffered: FieldAwarePiece[];
}

/**
 * Flatten a paragraph into measurable pieces, projecting allowlisted PAGE/NUMPAGES when a
 * page context is supplied (furniture finalize / `withPageContext`).
 *
 * Complex-field state spans runs. Nested fields beyond {@link MAX_FIELD_NESTING}, oversized
 * instructions, scan-budget overflows, and non-allowlisted instructions never evaluate: only
 * addressable cached result `w:t` inside runs (if any) remains visible.
 *
 * Generic `w:fldSimple` siblings are skipped entirely — their cached children are not in the
 * tree-ops model range, so emitting them would desync layout offsets from `paragraphTextOf`
 * and create non-addressable selectable spans. Body simple fields stay deferred.
 *
 * When projecting, suppressed cached-result model ranges still advance the canonical offset
 * so following `w:t` stays aligned with `paragraphTextOf`. The projected piece covers that
 * suppressed range (or a zero-width insertion point when the cache is empty).
 *
 * Hidden runs (`w:vanish`) are suppressed the same way — no piece, offset still advances — so
 * they are never measured, laid out or painted. A paragraph whose runs are all hidden yields
 * no pieces and is laid out exactly like an empty paragraph, which keeps its caret target.
 */
export function piecesOfParagraph(
  paragraph: OoxmlNode,
  inheritedRunProperties: readonly OoxmlProperty[] = [],
  pageContext?: FieldPageContext,
  cascadeRuns?: RunPropertyCascader,
  projectLink?: HyperlinkProjector,
  displayMode: RevisionDisplayMode = DEFAULT_REVISION_DISPLAY_MODE,
  deletedRanges?: MutableModelRange[]
): FieldAwarePiece[] {
  if (paragraph.kind === 'textValue') return [];

  const pieces: FieldAwarePiece[] = [];
  let offset = 0;
  /** The link the walk is currently inside, so every piece it emits is tagged with it. */
  let currentLink: SpanLinkRecord | undefined;

  // Complex-field machine — document order across runs within this paragraph.
  const field = createFieldParseState();
  const budget = createScanBudget();
  /** When set, suppress model result text because we will emit a live projection at end. */
  let pendingProjection: PendingPageProjection | null = null;
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
    positionalTab?: PositionalTab
  ): void => {
    if (text.length === 0 && !projected) return;
    const link = currentLink ? { link: currentLink } : {};
    const attribution = revisions.length === 0 ? {} : { revisions };
    if (projected) {
      pieces.push({ text, props, style, start, end, projected: true, ...link, ...attribution });
      return;
    }
    if (text.length === 0) return;
    pieces.push({
      text,
      props,
      style,
      start,
      end,
      ...(positionalTab ? { positionalTab } : {}),
      ...link,
      ...attribution,
    });
  };

  const commitPendingProjection = (): void => {
    if (!pendingProjection || !pageContext) {
      pendingProjection = null;
      return;
    }
    if (pendingProjection.style.hidden) {
      // `w:vanish` governs the DISPLAYED result the same way it governs literal text, so a
      // hidden field projects nothing rather than painting digits Word would not show.
      pendingProjection = null;
      return;
    }
    const text = projectPageFieldValue(pendingProjection.kind, pageContext);
    push(
      text,
      pendingProjection.props,
      pendingProjection.style,
      true,
      pendingProjection.resultStart,
      offset
    );
    pendingProjection = null;
  };

  const abandonPendingProjection = (): void => {
    if (!pendingProjection) return;
    for (const piece of pendingProjection.buffered) pieces.push(piece);
    pendingProjection = null;
  };

  const pushRunContent = (
    grand: OoxmlNode,
    props: readonly OoxmlProperty[],
    style: ResolvedRunStyle
  ): void => {
    // A `w:ptab` advances the line but occupies NO model offset, so it is pushed with a
    // zero-width range and the offset does not move.
    const positional = positionalTabOf(grand);
    if (positional) {
      if (!style.hidden) push('\t', props, style, false, offset, offset, positional);
      return;
    }
    const text = modelTextOfRunChild(grand);
    if (text.length === 0) return;
    // Hidden text (`w:vanish`, ECMA-376 §17.3.2.45) is skipped, not emitted-then-hidden: Word
    // paginates as if it were absent, so measuring it would break pages in the wrong place.
    // The offset still advances — the characters remain in the model and `paragraphTextOf`
    // counts them, so every following piece would desync from tree ops otherwise.
    //
    // A revision the display mode resolves away is suppressed the same way, and for the same
    // reason: the offset space belongs to the model, not to the view. `w:delText` outside any
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
        // Budget exhausted: fail closed for further field recognition, surface any buffered
        // cache, and keep emitting addressable text so following offsets stay visible.
        abandonPendingProjection();
        resetFieldParseState(field);
        if (grand.kind === 'runProperties') continue;
        if (isFldChar(grand, 'begin') || isFldChar(grand, 'separate') || isFldChar(grand, 'end')) {
          continue;
        }
        if (isInstrText(grand)) continue;
        pushRunContent(grand, props, style);
        continue;
      }

      if (grand.kind === 'runProperties') continue;

      if (isFldChar(grand, 'begin')) {
        onFldCharBegin(field);
        if (field.nesting === 1) {
          // A new outermost field replaces any dangling pending projection (malformed).
          abandonPendingProjection();
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
        if (outermostSeparate) {
          if (kind && pageContext) {
            pendingProjection = {
              kind,
              resultStart: offset,
              props,
              style,
              capturedResultStyle: false,
              buffered: [],
            };
          } else {
            abandonPendingProjection();
          }
        }
        continue;
      }

      if (isFldChar(grand, 'end')) {
        const outermostEnd = field.nesting === 1;
        onFldCharEnd(field);
        if (outermostEnd) commitPendingProjection();
        continue;
      }

      if (isCollectingInstruction(field)) continue;

      if (pendingProjection && isInsideFieldResult(field)) {
        const text = modelTextOfRunChild(grand);
        if (text.length > 0) {
          if (style.hidden) {
            // Hidden cached-result text is neither buffered nor allowed to donate the
            // projected style; only the offset advances (as in `pushRunContent`).
            offset += text.length;
            continue;
          }
          // First measurable cached-result run wins the projected style.
          if (!pendingProjection.capturedResultStyle) {
            pendingProjection.props = props;
            pendingProjection.style = style;
            pendingProjection.capturedResultStyle = true;
          }
          pendingProjection.buffered.push({
            text,
            props,
            style,
            start: offset,
            end: offset + text.length,
          });
          offset += text.length;
        }
        continue;
      }

      pushRunContent(grand, props, style);
    }
  };

  /**
   * Walk content in document order, descending through every RUN CONTAINER.
   *
   * Typed runs contribute measurable / selectable text. Generic siblings (including
   * `w:fldSimple`) stay structurally preserved but layout-inert. The exceptions are the two
   * containers that are not content themselves but hold runs that are:
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
  const processInline = (child: OoxmlNode, depth: number): void => {
    if (child.kind === 'run') {
      processRun(child, depth);
      return;
    }
    if (depth > MAX_STORY_FIELD_SCAN_DEPTH || depth >= MAX_REVISION_DEPTH) return;
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
  if (!consumeScanNode(budget)) return pieces;
  for (const child of paragraph.children) processInline(child, 1);
  // Malformed field missing end: fail closed (no live projection) but keep cached result text.
  abandonPendingProjection();

  return pieces;
}

/**
 * Cache-key token for a page context under known field needs.
 *
 * Absent context and field-free stories share the empty baseline key. NUMPAGES-only stories
 * key on page count alone so every sheet of a finished document reuses one layout. PAGE
 * (with or without NUMPAGES) keys the full pair.
 */
export function fieldPageContextToken(
  context: FieldPageContext | undefined,
  needs: StoryPageFieldNeeds = NO_STORY_PAGE_FIELDS
): string {
  if (!context) return '';
  if (!needs.hasPage && !needs.hasNumPages) return '';
  if (!needs.hasPage) return `|fld:n/${context.pageCount}`;
  return `|fld:${context.pageNumber}/${context.pageCount}`;
}

/**
 * Bounded scan for allowlisted complex PAGE / NUMPAGES fields in a header/footer part.
 *
 * Walks the part tree with node/depth caps. Field state spans runs in document order within
 * each paragraph — the same machine {@link piecesOfParagraph} uses — and resets at paragraph
 * boundaries so malformed cross-paragraph fields never count. Generic `w:fldSimple` is ignored
 * so detection cannot re-enable deferred body-style simple fields in furniture either.
 * Instruction text is extracted iteratively under the same node/depth/character budgets.
 */
export function detectStoryPageFields(root: OoxmlNode): StoryPageFieldNeeds {
  let hasPage = false;
  let hasNumPages = false;
  const budget = createScanBudget();
  const field = createFieldParseState();

  const note = (kind: AllowlistedPageField): void => {
    if (kind === 'PAGE') hasPage = true;
    else hasNumPages = true;
  };

  const processFieldChild = (grand: OoxmlNode, depth: number): void => {
    if (grand.kind === 'runProperties') return;

    if (isFldChar(grand, 'begin')) {
      onFldCharBegin(field);
      return;
    }

    if (isInstrText(grand)) {
      ingestInstrTextBounded(field, grand, budget, depth);
      return;
    }

    if (isFldChar(grand, 'separate')) {
      const kind = onFldCharSeparate(field);
      if (kind) note(kind);
      return;
    }

    if (isFldChar(grand, 'end')) {
      onFldCharEnd(field);
    }
  };

  const scanRun = (run: OoxmlNode, depth: number): void => {
    if (run.kind !== 'run') return;
    for (const grand of run.children) {
      if (!consumeScanNode(budget)) return;
      processFieldChild(grand, depth + 1);
    }
  };

  const walk = (node: OoxmlNode, depth: number): void => {
    if (hasPage && hasNumPages) return;
    if (!consumeScanNode(budget)) return;
    if (depth > MAX_STORY_FIELD_SCAN_DEPTH) return;
    if (node.kind === 'textValue') return;

    // Paragraph boundary: Word complex fields do not legally span paragraphs. Reset so a
    // begin in one paragraph cannot pair with separate/end in another.
    if (node.kind === 'paragraph') {
      resetFieldParseState(field);
      for (const child of node.children) {
        walk(child, depth + 1);
        if (hasPage && hasNumPages) return;
        if (budget.exhausted) return;
      }
      resetFieldParseState(field);
      return;
    }

    if (node.kind === 'run') {
      // Shared field state across sibling runs (and nested run containers) in this paragraph.
      scanRun(node, depth);
      return;
    }

    for (const child of node.children) {
      walk(child, depth + 1);
      if (hasPage && hasNumPages) return;
      if (budget.exhausted) return;
    }
  };

  walk(root, 0);
  if (!hasPage && !hasNumPages) return NO_STORY_PAGE_FIELDS;
  return { hasPage, hasNumPages };
}

/**
 * Project allowlisted PAGE/NUMPAGES onto every page's read-only furniture once the document
 * page count is known. Body stories are unchanged.
 *
 * Uses 1-based physical page indices (`page.index + 1`). Section `w:pgNumType` start/restart
 * is not modelled yet; empty `pgNumType` (the comprehensive fixture) keeps physical numbering.
 * NUMPAGES is the semantic layout total page count.
 */
export function finalizePageFieldProjection(layout: SemanticLayout): SemanticLayout {
  const pageCount = layout.pages.length;
  if (pageCount === 0) return layout;

  let changed = false;
  const pages = layout.pages.map((page) => {
    const context: FieldPageContext = {
      pageNumber: page.index + 1,
      pageCount,
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
