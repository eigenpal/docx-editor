// Resolve paragraph `numPr` against a numbering index and produce per-paragraph list
// layout inputs (marker text, effective indent, marker face) for one story walk.

import { flattenContentControls } from '@docx-editor.dev/core/store';
import type { OoxmlElement, OoxmlNode, OoxmlProperty } from '@docx-editor.dev/core/store';
import { createListCounterState } from './list-counters.ts';
import {
  EMPTY_NUMBERING_INDEX,
  MAX_LEVEL_INDENT_PT,
  resolveNumberingStyleLinks,
  type ListMarkerAlign,
  type ListSuffix,
  type NumberingIndex,
  type NumberingLevelIndent,
} from './numbering-index.ts';
import {
  cascadeParagraphFormatting,
  cascadeRunProperties,
  MAX_STYLE_BASED_ON_DEPTH,
  type StyleCascadeTable,
  type StyleDefinition,
} from './style-cascade.ts';
import { EMPTY_TAB_STOPS, nextTabDestination, type ResolvedTabStops } from './paragraph-tabs.ts';
import { mapSymbolPuaText } from './symbol-encoding.ts';
import { resolveRunStyle, type ResolvedRunStyle } from './run-style.ts';
import { paragraphIndent, propertiesOf } from './paragraph-flow.ts';
import type { TextMeasurer } from './semantic-records.ts';
import { collectFlowBlocks } from '../store/package/content-control-walk.ts';
import { DEPENDENCY_KEY_IDS } from '../store/registry/frozen-ids.ts';
import type { LayoutScope } from './layout-scheduler.ts';
import type { LayoutSession } from './layout-session.ts';

interface ListResolveChangeEvidence {
  readonly preservesNumberedSequence: boolean;
}

const listResolveEvidenceBySession = new WeakMap<LayoutSession, ListResolveChangeEvidence>();
let listResolveBlockVisits = 0;

/** @internal Read session-scoped list resolve memo for tests. */
export function listResolveSessionMemoListItemsForTest(
  session: LayoutSession
): ReadonlyMap<string, ResolvedListItem> | undefined {
  return lastStoryResolvesBySession.get(session)?.listItems;
}

/** @internal Warm-path recorder for list resolve block walks. */
export function listResolveBlockVisitTestRecorder(): {
  readonly blockVisits: number;
  reset(): void;
} {
  return {
    get blockVisits() {
      return listResolveBlockVisits;
    },
    reset() {
      listResolveBlockVisits = 0;
    },
  };
}

/**
 * Attach one-use layout scope evidence before semantic layout runs.
 *
 * @internal
 */
export function attachListResolveChangeEvidence(session: LayoutSession, scope: LayoutScope): void {
  const storySafe =
    scope.dependencyKeys.size === 0 ||
    [...scope.dependencyKeys].every((key) => key === DEPENDENCY_KEY_IDS.story);
  listResolveEvidenceBySession.set(session, {
    preservesNumberedSequence:
      scope.impact === 'text-local' &&
      !scope.structural &&
      scope.created.size === 0 &&
      scope.deleted.size === 0 &&
      storySafe,
  });
}

function consumeListResolveChangeEvidence(
  session: LayoutSession
): ListResolveChangeEvidence | undefined {
  const evidence = listResolveEvidenceBySession.get(session);
  listResolveEvidenceBySession.delete(session);
  return evidence;
}

/** Fields of {@link ResolvedRunStyle} that change a marker's measured width. */
function markerMeasureToken(style: ResolvedRunStyle): string {
  return [
    style.fontFamily ?? '',
    style.fontSizePt,
    style.bold ? 1 : 0,
    style.italic ? 1 : 0,
    style.characterSpacingPt,
    style.horizontalScalePercent,
    style.verticalAlign,
    style.hidden ? 1 : 0,
    style.kerningMinPt,
    style.caps ? 1 : 0,
    style.smallCaps ? 1 : 0,
  ].join(',');
}

/**
 * A paragraph's list membership fully resolved: definition, level, marker text and geometry.
 *
 * `markerText` is already expanded through the counter state, so it is the string a reader sees
 * rather than the `w:lvlText` template.
 */
export interface ResolvedListItem {
  readonly numId: string;
  readonly ilvl: number;
  readonly abstractNumId: string;
  /** `w:numFmt` of the resolved level — `bullet` or a numbering format. */
  readonly numFmt: string;
  readonly markerText: string;
  readonly markerAlign: ListMarkerAlign;
  readonly suffix: ListSuffix;
  /** Effective indent after merging level + paragraph indents, in points. */
  readonly indent: NumberingLevelIndent;
  readonly markerStyle: ResolvedRunStyle;
  /** Fingerprint for layout cache keys (indent, marker text, marker face). */
  readonly cacheToken: string;
}

function isElement(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

function attrVal(node: OoxmlElement, localName: string): string | undefined {
  for (const a of node.attributes) {
    if (a.localName === localName) return a.value;
  }
  return undefined;
}

function childNamed(node: OoxmlElement, localName: string): OoxmlElement | undefined {
  for (const child of node.children) {
    if (isElement(child) && child.localName === localName) return child;
  }
  return undefined;
}

/**
 * Read `w:numPr` from cascaded paragraph-property nodes (last wins).
 *
 * Flat `OoxmlProperty[]` bags drop nested `ilvl`/`numId`, so this walks the tree nodes
 * the same way borders and tabs do.
 */
export function readNumPr(
  paragraphPropertyNodes: readonly OoxmlNode[]
): { numId: string; ilvl: number } | null {
  let found: { numId: string; ilvl: number } | null = null;
  for (const node of paragraphPropertyNodes) {
    if (!isElement(node)) continue;
    const numPr = childNamed(node, 'numPr');
    if (!numPr) continue;
    const ilvlNode = childNamed(numPr, 'ilvl');
    const numIdNode = childNamed(numPr, 'numId');
    const numId = numIdNode ? attrVal(numIdNode, 'val') : undefined;
    const ilvlRaw = ilvlNode ? attrVal(ilvlNode, 'val') : '0';
    if (!numId || numId === '0') {
      found = null;
      continue;
    }
    if (numId.length > 64) {
      found = null;
      continue;
    }
    const ilvl = /^\d{1,2}$/.test(ilvlRaw ?? '') ? Number(ilvlRaw) : 0;
    if (ilvl < 0 || ilvl > 8) {
      found = null;
      continue;
    }
    found = { numId, ilvl };
  }
  return found;
}

/**
 * The `w:numId` a style numbers with, following `w:basedOn` (§17.9.21 link target).
 *
 * A `w:numStyleLink` names a style, not a number: Word's own List Bullet / List Number are
 * paragraph styles whose `w:numPr` points at the `w:num` that owns the real levels. The walk
 * is depth-capped with a visited set because the `basedOn` chain comes from the file.
 */
function numIdForStyle(styleCascade: StyleCascadeTable, styleId: string): string | undefined {
  const seen = new Set<string>();
  let current: StyleDefinition | undefined = styleCascade.styles.get(styleId);
  for (let depth = 0; current !== undefined && depth < MAX_STYLE_BASED_ON_DEPTH; depth += 1) {
    if (seen.has(current.styleId)) return undefined;
    seen.add(current.styleId);
    const node = current.paragraphPropertiesNode;
    const numPr = node ? readNumPr([node]) : null;
    if (numPr) return numPr.numId;
    current = current.basedOn === null ? undefined : styleCascade.styles.get(current.basedOn);
  }
  return undefined;
}

/**
 * Memo keyed on the index object, validated against the cascade. A WeakMap so a disposed
 * document's index releases its entry, and entered under the LINKED index too: layout
 * links the raw index once per flush, then hands the linked result back through this
 * function again, and without the self-entry that second call would clobber the memo
 * every flush. Level-object identity across edits is NOT this memo's doing —
 * `resolveNumberingStyleLinks` reuses the delegation target's `levels` maps by reference,
 * so the per-paragraph `perLevel` caches stay warm even on a miss here.
 */
const linkedIndexMemos = new WeakMap<
  NumberingIndex,
  { readonly styleCascade: StyleCascadeTable; readonly linked: NumberingIndex }
>();

/**
 * Resolve `w:numStyleLink` delegation using the document's styles (§17.9.21).
 *
 * Without a style table there is nothing to follow, so the index is returned unchanged —
 * and so it is when nothing delegates, which keeps layout cache identity.
 */
export function withNumberingStyleLinks(
  index: NumberingIndex,
  styleCascade: StyleCascadeTable | undefined
): NumberingIndex {
  if (!styleCascade) return index;
  const memo = linkedIndexMemos.get(index);
  if (memo && memo.styleCascade === styleCascade) return memo.linked;
  const linked = resolveNumberingStyleLinks(index, (styleId) =>
    numIdForStyle(styleCascade, styleId)
  );
  const entry = { styleCascade, linked };
  linkedIndexMemos.set(index, entry);
  linkedIndexMemos.set(linked, entry);
  return linked;
}

/** Bound a file-derived indent both ways — negative is legal, unbounded is not. */
function clampIndentPt(pt: number): number {
  if (!Number.isFinite(pt)) return 0;
  if (pt > MAX_LEVEL_INDENT_PT) return MAX_LEVEL_INDENT_PT;
  if (pt < -MAX_LEVEL_INDENT_PT) return -MAX_LEVEL_INDENT_PT;
  return pt;
}

/** The first-line slot as one `w:ind` states it, or null when it states neither spelling. */
function firstLineOffsetOf(
  props: readonly OoxmlProperty[]
): { hanging: number; firstLine: number } | null {
  let found: { hanging: number; firstLine: number } | null = null;
  for (const property of props) {
    if (property.localName !== 'ind') continue;
    const h = property.attributes?.hanging;
    const f = property.attributes?.firstLine;
    // Mutually exclusive (§17.3.1.10, §17.3.1.12): one signed first-line offset, two spellings,
    // so an `w:ind` stating either replaces both. `w:firstLine` is read SIGNED because Word
    // keeps a negative value as a hang. A bare `w:left` states neither and leaves them alone.
    if (h === undefined && f === undefined) continue;
    found = {
      hanging: h !== undefined && /^\d{1,9}$/.test(h) ? clampIndentPt(Number(h) / 20) : 0,
      firstLine: f !== undefined && /^-?\d{1,9}$/.test(f) ? clampIndentPt(Number(f) / 20) : 0,
    };
  }
  return found;
}

/** Whether any `w:ind` in the list states left (or its `w:start` spelling). */
function statesLeft(props: readonly OoxmlProperty[]): boolean {
  return props.some(
    (property) =>
      property.localName === 'ind' &&
      (property.attributes?.left !== undefined || property.attributes?.start !== undefined)
  );
}

function statesRight(props: readonly OoxmlProperty[]): boolean {
  return props.some(
    (property) =>
      property.localName === 'ind' &&
      (property.attributes?.right !== undefined || property.attributes?.end !== undefined)
  );
}

/**
 * The effective indent of a list paragraph: STYLE, then the numbering LEVEL, then DIRECT.
 *
 * Word applies a level's `w:pPr/w:ind` between the paragraph style and the paragraph's own
 * formatting, per attribute — and the ordering matters on real documents. A converted
 * agreement numbers its `(a)` items with a level stating `left=1512 hanging=738` under a
 * `ListParagraph` style stating `left=775 hanging=624`, and states only `hanging="737"` on
 * the paragraph itself. Reading the flattened cascade as "the paragraph's indent" gave the
 * STYLE's 775 to a level that had overridden it, so every lettered sub-item hung a full
 * indent step to the left of where Word puts it.
 *
 * `inherited` is the cascade WITHOUT the paragraph's own `w:pPr` (defaults, table cell style,
 * style chain); `direct` is that `w:pPr` alone.
 */
export function mergeListIndent(
  levelIndent: NumberingLevelIndent,
  inherited: readonly OoxmlProperty[],
  direct: readonly OoxmlProperty[] = []
): NumberingLevelIndent {
  // A level built by hand (a unit test, not a file) carries no presence record; it then
  // states nothing and the style still wins, which is the behaviour those callers had.
  const levelStates = levelIndent.stated ?? {
    left: false,
    right: false,
    firstLineOffset: false,
  };
  const inheritedIndent = paragraphIndent(inherited);
  const directIndent = paragraphIndent(direct);
  const levelOffset = { hanging: levelIndent.hanging, firstLine: levelIndent.firstLine };

  const left = statesLeft(direct)
    ? directIndent.left
    : levelStates.left
      ? levelIndent.left
      : statesLeft(inherited)
        ? inheritedIndent.left
        : levelIndent.left;
  const right = statesRight(direct)
    ? directIndent.right
    : levelStates.right
      ? levelIndent.right
      : statesRight(inherited)
        ? inheritedIndent.right
        : levelIndent.right;
  const firstLineOffset =
    firstLineOffsetOf(direct) ??
    (levelStates.firstLineOffset ? levelOffset : (firstLineOffsetOf(inherited) ?? levelOffset));

  return { left, right, ...firstLineOffset };
}

/**
 * Collect paragraphs of a block list in document order, descending into tables.
 *
 * Caps nesting so a hostile nested-table document cannot recurse without bound.
 */
export function walkStoryParagraphs(
  blocks: readonly OoxmlElement[],
  maxTableDepth = 8
): OoxmlElement[] {
  const out: OoxmlElement[] = [];
  const visit = (blockList: readonly OoxmlElement[], depth: number): void => {
    for (const block of blockList) {
      if (block.kind === 'paragraph') {
        out.push(block);
        continue;
      }
      if (block.kind !== 'table' || depth >= maxTableDepth) continue;
      for (const row of flattenContentControls(block.children)) {
        if (row.kind !== 'tableRow') continue;
        for (const cell of flattenContentControls(row.children)) {
          if (cell.kind !== 'tableCell') continue;
          // Flatten cell SDTs under the shared content-control budget; table nesting still
          // uses `maxTableDepth` for the table walk itself.
          const inner = collectFlowBlocks(cell.children);
          visit(inner, depth + 1);
        }
      }
    }
  };
  visit(blocks, 0);
  return out;
}

/**
 * Per-paragraph prelude for the story walk below, memoized on the paragraph NODE: which
 * `numPr` a paragraph resolves to — and the cascaded property tiers feeding its indent and
 * marker face — are pure functions of the immutable paragraph and the cascade table. An
 * edit republishes only the touched paragraphs, yet the resolver walks the WHOLE story per
 * keystroke; without this cache every unchanged paragraph re-ran the full style cascade
 * just to learn (usually) that it has no numbering. Only the counter advance is genuinely
 * sequential. `perLevel` holds level-derived indent/marker work, keyed on the level object
 * (identity-stable because `resolveNumberingStyleLinks` reuses the target's `levels` maps
 * by reference) — a WeakMap, so level objects orphaned by a numbering edit take their
 * entries with them.
 */
interface ParagraphListPrelude {
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly numPr: { readonly numId: string; readonly ilvl: number } | null;
  readonly inheritedParagraphProperties: readonly OoxmlProperty[];
  readonly directProps: readonly OoxmlProperty[];
  readonly inheritedMarkProps: readonly OoxmlProperty[];
  readonly perLevel: WeakMap<
    object,
    { indent: NumberingLevelIndent; markerStyle: ResolvedRunStyle }
  >;
}
const paragraphListPreludes = new WeakMap<OoxmlElement, ParagraphListPrelude>();

function paragraphListPrelude(
  paragraph: OoxmlElement,
  styleCascade: StyleCascadeTable | undefined
): ParagraphListPrelude {
  const cached = paragraphListPreludes.get(paragraph);
  if (cached && cached.styleCascade === styleCascade) return cached;
  const pPr = paragraph.children.find((child) => child.kind === 'paragraphProperties');
  const cascaded = styleCascade ? cascadeParagraphFormatting(styleCascade, pPr) : null;
  const nodes: readonly OoxmlNode[] = cascaded ? cascaded.paragraphPropertyNodes : pPr ? [pPr] : [];
  const directMarkRun = pPr && isElement(pPr) ? childNamed(pPr, 'rPr') : undefined;
  const prelude: ParagraphListPrelude = {
    styleCascade,
    numPr: readNumPr(nodes),
    inheritedParagraphProperties: cascaded?.inheritedParagraphProperties ?? [],
    directProps: propertiesOf(pPr),
    inheritedMarkProps: cascaded ? cascaded.markRunProperties : propertiesOf(directMarkRun),
    perLevel: new WeakMap(),
  };
  paragraphListPreludes.set(paragraph, prelude);
  return prelude;
}

/**
 * Resolve every list paragraph in a story to a {@link ResolvedListItem}, keyed by node id.
 *
 * Non-list paragraphs are absent from the map. Hostile / missing numbering resolves inertly
 * (paragraph omitted — laid out as ordinary text).
 */
export function resolveStoryListItems(
  blocks: readonly OoxmlElement[],
  index: NumberingIndex,
  styleCascade: StyleCascadeTable | undefined,
  isFontAvailable?: (family: string) => boolean
): ReadonlyMap<string, ResolvedListItem> {
  const map = new Map<string, ResolvedListItem>();
  if (index.nums.size === 0) return map;

  // A definition that delegates through `w:numStyleLink` has no levels of its own; resolving
  // the link here is what keeps those paragraphs from losing their markers entirely.
  const linked = withNumberingStyleLinks(index, styleCascade);
  const counters = createListCounterState(linked);
  for (const paragraph of walkStoryParagraphs(blocks)) {
    const prelude = paragraphListPrelude(paragraph, styleCascade);
    const numPr = prelude.numPr;
    if (!numPr) continue;

    const advanced = counters.advance(numPr.numId, numPr.ilvl);
    if (!advanced) continue;

    let levelDerived = prelude.perLevel.get(advanced.level);
    if (!levelDerived) {
      // Split, not flattened: the level's indent outranks the STYLE's and is outranked by
      // the paragraph's OWN `w:pPr`, so the merge needs the two tiers apart.
      const indent = mergeListIndent(
        advanced.level.indent,
        prelude.inheritedParagraphProperties,
        prelude.directProps
      );
      const markerProps = cascadeRunProperties(
        prelude.inheritedMarkProps,
        advanced.level.runProperties,
        styleCascade
      );
      levelDerived = {
        indent,
        markerStyle: resolveRunStyle(markerProps, styleCascade?.themeFonts),
      };
      prelude.perLevel.set(advanced.level, levelDerived);
    }
    const { indent, markerStyle } = levelDerived;
    // Word writes a Symbol/Wingdings bullet as font-byte + 0xF000 (`` = U+F0B7 in
    // Symbol), which is a private-use codepoint no other font can draw. Mapping it here —
    // where the marker's FAMILY is finally known — keeps measurement and paint on the same
    // string; doing it in the painter would size the marker box for a glyph nobody draws.
    const markerText = mapSymbolPuaText(
      advanced.markerText,
      markerStyle.fontFamily,
      isFontAvailable
    );
    const cacheToken = [
      advanced.numId,
      advanced.ilvl,
      advanced.level.numFmt,
      advanced.level.lvlText,
      indent.left,
      indent.right,
      indent.hanging,
      indent.firstLine,
      advanced.level.lvlJc,
      advanced.level.suff,
      advanced.level.vanish ? 1 : 0,
      // The MARKER ITSELF, not its length. The first line starts where the marker ends
      // whenever the marker overflows its hanging slot, so `9.` and `10.` break differently —
      // and so do `ii.` and `vi.`, which the length cannot tell apart. A warm cache then
      // served the previous marker's width to the new one, and the line wrapped a word late.
      markerText,
      // The FACE, not just the glyphs. `listFirstLineOffset` measures with `markerStyle`,
      // so a level `w:sz` or font change moves the wrap while the text and indent stay put.
      markerMeasureToken(markerStyle),
    ].join('|');

    map.set(paragraph.id, {
      numId: advanced.numId,
      ilvl: advanced.ilvl,
      abstractNumId: advanced.abstractNumId,
      numFmt: advanced.level.numFmt,
      markerText,
      markerAlign: advanced.level.lvlJc,
      suffix: advanced.level.suff,
      indent,
      markerStyle,
      cacheToken,
    });
  }
  return map;
}

interface ResolvedListItemsMemoEntry {
  readonly rawIndex: NumberingIndex | undefined;
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly isFontAvailable: ((family: string) => boolean) | undefined;
  readonly linkedIndex: NumberingIndex;
  readonly listItems: ReadonlyMap<string, ResolvedListItem> | undefined;
}

/**
 * Memo for {@link withResolvedListItems}, keyed on the blocks array (stable per part via
 * the `storyBlocks` memo) and validated against the remaining RAW inputs by identity —
 * the unlinked numbering index, the style cascade, and the font oracle. A WeakMap on the
 * blocks array so a disposed document's entry dies with its part instead of pinning an
 * O(document) item map at module scope. A miss on any input recomputes the sequential
 * full-story counter walk exactly as before.
 */
const resolvedListItemsMemos = new WeakMap<readonly OoxmlElement[], ResolvedListItemsMemoEntry>();

/** Session-stable outer memo for semantic body layout. */
const resolvedListItemsMemosBySession = new WeakMap<LayoutSession, ResolvedListItemsMemoEntry>();

type WithResolvedListItemsOptions = {
  readonly numberingIndex?: NumberingIndex;
  readonly listItems?: ReadonlyMap<string, ResolvedListItem>;
  readonly styleCascade?: StyleCascadeTable;
  readonly isFontAvailable?: (family: string) => boolean;
};

function resolvedListItemsMemoHit(
  options: WithResolvedListItemsOptions,
  blocks: readonly OoxmlElement[],
  memoOwner: LayoutSession | undefined
): ResolvedListItemsMemoEntry | undefined {
  const memo = memoOwner
    ? resolvedListItemsMemosBySession.get(memoOwner)
    : resolvedListItemsMemos.get(blocks);
  if (
    memo &&
    memo.rawIndex === options.numberingIndex &&
    memo.styleCascade === options.styleCascade &&
    memo.isFontAvailable === options.isFontAvailable
  ) {
    return memo;
  }
  return undefined;
}

function rememberResolvedListItemsMemo(
  blocks: readonly OoxmlElement[],
  memoOwner: LayoutSession | undefined,
  entry: ResolvedListItemsMemoEntry
): void {
  if (memoOwner) resolvedListItemsMemosBySession.set(memoOwner, entry);
  else resolvedListItemsMemos.set(blocks, entry);
}

function withResolvedListItemsInternal<T extends WithResolvedListItemsOptions>(
  options: T,
  blocks: readonly OoxmlElement[],
  memoOwner: LayoutSession | undefined
): T & {
  readonly numberingIndex: NumberingIndex;
  readonly listItems?: ReadonlyMap<string, ResolvedListItem>;
} {
  if (options.listItems === undefined) {
    const memo = resolvedListItemsMemoHit(options, blocks, memoOwner);
    if (memo && memoOwner === undefined) {
      return {
        ...options,
        numberingIndex: memo.linkedIndex,
        ...(memo.listItems ? { listItems: memo.listItems } : {}),
      };
    }
  }
  const memoBeforeResolve =
    options.listItems === undefined
      ? resolvedListItemsMemoHit(options, blocks, memoOwner)
      : undefined;
  const numberingIndex =
    memoBeforeResolve &&
    memoBeforeResolve.rawIndex === options.numberingIndex &&
    memoBeforeResolve.styleCascade === options.styleCascade &&
    memoBeforeResolve.isFontAvailable === options.isFontAvailable
      ? memoBeforeResolve.linkedIndex
      : withNumberingStyleLinks(
          options.numberingIndex ?? EMPTY_NUMBERING_INDEX,
          options.styleCascade
        );
  const listItems =
    options.listItems ??
    (numberingIndex.nums.size > 0
      ? resolveStoryListItemsStable(
          blocks,
          options.numberingIndex,
          numberingIndex,
          options.styleCascade,
          options.isFontAvailable,
          memoOwner
        )
      : undefined);
  if (options.listItems === undefined) {
    rememberResolvedListItemsMemo(blocks, memoOwner, {
      rawIndex: options.numberingIndex,
      styleCascade: options.styleCascade,
      isFontAvailable: options.isFontAvailable,
      linkedIndex: numberingIndex,
      listItems,
    });
  }
  return {
    ...options,
    numberingIndex,
    ...(listItems ? { listItems } : {}),
  };
}

/**
 * Attach a full-story list-item map to layout options.
 *
 * Resolves once over `blocks` (body story including table cells) so counters continue across
 * section boundaries. No-ops when numbering is absent.
 */
export function withResolvedListItems<
  T extends {
    readonly numberingIndex?: NumberingIndex;
    readonly listItems?: ReadonlyMap<string, ResolvedListItem>;
    readonly styleCascade?: StyleCascadeTable;
    readonly isFontAvailable?: (family: string) => boolean;
  },
>(
  options: T,
  blocks: readonly OoxmlElement[]
): T & {
  readonly numberingIndex: NumberingIndex;
  readonly listItems?: ReadonlyMap<string, ResolvedListItem>;
} {
  return withResolvedListItemsInternal(options, blocks, undefined);
}

/**
 * Session-stable list resolve for semantic body layout.
 *
 * @internal
 */
export function withResolvedListItemsForSession<T extends WithResolvedListItemsOptions>(
  options: T,
  blocks: readonly OoxmlElement[],
  session: LayoutSession
): T & {
  readonly numberingIndex: NumberingIndex;
  readonly listItems?: ReadonlyMap<string, ResolvedListItem>;
} {
  return withResolvedListItemsInternal(options, blocks, session);
}

/** Numbered paragraphs of one top-level block, memoized per (immutable block, cascade). */
interface NumberedBlockMemo {
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly numbered: readonly OoxmlElement[];
}
const numberedBlockMemos = new WeakMap<OoxmlElement, NumberedBlockMemo>();
const NO_NUMBERED_PARAGRAPHS: readonly OoxmlElement[] = Object.freeze([]);

function numberedParagraphsOfBlock(
  block: OoxmlElement,
  styleCascade: StyleCascadeTable | undefined
): readonly OoxmlElement[] {
  const cached = numberedBlockMemos.get(block);
  if (cached && cached.styleCascade === styleCascade) return cached.numbered;
  const collected = walkStoryParagraphs([block]).filter(
    (paragraph) => paragraphListPrelude(paragraph, styleCascade).numPr !== null
  );
  const numbered = collected.length > 0 ? collected : NO_NUMBERED_PARAGRAPHS;
  numberedBlockMemos.set(block, { styleCascade, numbered });
  return numbered;
}

/**
 * The previous full-story resolve, for reuse BY IDENTITY across keystrokes.
 *
 * The resolved item map is a pure function of the SEQUENCE of numbered paragraph nodes
 * (the counter walk skips everything else), the linked numbering index, the cascade, and
 * the font oracle. A text edit republishes the whole blocks array — which is what the
 * per-array memo above keys on — while replacing one non-list paragraph node, so the
 * numbered sequence is unchanged and the previous map still answers. Handing back the SAME
 * map object is also what lets a section-level prepass memo validate list inputs with one
 * identity compare.
 *
 * Keyed on the story's FIRST block node in a WeakMap rather than held in a module slot, so
 * a closed document's resolve — its numbered subtrees, item map, cascade and index — dies
 * with its tree instead of being pinned until some other document lays out. An edit to the
 * first block itself only misses (one extra resolve), never mixes: the numbered sequence is
 * still compared node-for-node.
 */
interface LastStoryResolve {
  readonly rawIndex: NumberingIndex | undefined;
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly isFontAvailable: ((family: string) => boolean) | undefined;
  readonly blocks: readonly OoxmlElement[];
  readonly numberedByBlock: readonly (readonly OoxmlElement[])[];
  readonly listItems: ReadonlyMap<string, ResolvedListItem>;
}
const lastStoryResolvesByAnchor = new WeakMap<OoxmlElement, LastStoryResolve>();
const lastStoryResolvesBySession = new WeakMap<LayoutSession, LastStoryResolve>();

function sameNumberingSequence(a: readonly OoxmlElement[], b: readonly OoxmlElement[]): boolean {
  return (
    a.length === b.length &&
    a.every((paragraph, index) => {
      const previous = b[index];
      if (!previous || paragraph.id !== previous.id) return false;
      const properties = paragraph.children.find((child) => child.kind === 'paragraphProperties');
      const previousProperties = previous.children.find(
        (child) => child.kind === 'paragraphProperties'
      );
      return properties === previousProperties;
    })
  );
}

function resolveStoryListItemsStable(
  blocks: readonly OoxmlElement[],
  rawIndex: NumberingIndex | undefined,
  linkedIndex: NumberingIndex,
  styleCascade: StyleCascadeTable | undefined,
  isFontAvailable: ((family: string) => boolean) | undefined,
  memoOwner: LayoutSession | undefined
): ReadonlyMap<string, ResolvedListItem> {
  const first = blocks[0];
  const lastBlock = blocks[blocks.length - 1];
  const last = memoOwner
    ? lastStoryResolvesBySession.get(memoOwner)
    : ((first ? lastStoryResolvesByAnchor.get(first) : undefined) ??
      (lastBlock ? lastStoryResolvesByAnchor.get(lastBlock) : undefined));
  const evidence = memoOwner ? consumeListResolveChangeEvidence(memoOwner) : undefined;
  if (
    evidence?.preservesNumberedSequence &&
    last &&
    last.rawIndex === rawIndex &&
    last.styleCascade === styleCascade &&
    last.isFontAvailable === isFontAvailable
  ) {
    return last.listItems;
  }

  const numberedByBlock = new Array<readonly OoxmlElement[]>(blocks.length);
  let numberedSequenceUnchanged =
    last !== undefined &&
    last.rawIndex === rawIndex &&
    last.styleCascade === styleCascade &&
    last.isFontAvailable === isFontAvailable &&
    last.blocks.length === blocks.length;
  for (let index = 0; index < blocks.length; index += 1) {
    listResolveBlockVisits += 1;
    const block = blocks[index]!;
    const numbered =
      last && last.blocks[index] === block
        ? last.numberedByBlock[index]!
        : numberedParagraphsOfBlock(block, styleCascade);
    numberedByBlock[index] = numbered;
    if (
      numberedSequenceUnchanged &&
      !sameNumberingSequence(numbered, last!.numberedByBlock[index]!)
    ) {
      numberedSequenceUnchanged = false;
    }
  }
  if (last && numberedSequenceUnchanged) {
    const next = { ...last, blocks, numberedByBlock };
    if (memoOwner) lastStoryResolvesBySession.set(memoOwner, next);
    else {
      if (first) lastStoryResolvesByAnchor.set(first, next);
      if (lastBlock && lastBlock !== first) lastStoryResolvesByAnchor.set(lastBlock, next);
    }
    return last.listItems;
  }
  const listItems = resolveStoryListItems(blocks, linkedIndex, styleCascade, isFontAvailable);
  const next = { rawIndex, styleCascade, isFontAvailable, blocks, numberedByBlock, listItems };
  if (memoOwner) lastStoryResolvesBySession.set(memoOwner, next);
  else {
    if (first) lastStoryResolvesByAnchor.set(first, next);
    if (lastBlock && lastBlock !== first) lastStoryResolvesByAnchor.set(lastBlock, next);
  }
  return listItems;
}

/**
 * Horizontal marker box inside the hanging indent slot.
 *
 * Coordinates are relative to the same origin as paragraph content (`indent.left` is the
 * text start). Returns null when there is nothing to paint.
 */
export function listMarkerBox(
  item: ResolvedListItem,
  markerWidth: number,
  lineY: number,
  lineHeight: number
): { x: number; y: number; width: number; height: number } | null {
  if (!item.markerText || (item.indent.hanging <= 0 && markerWidth <= 0)) {
    if (!item.markerText) return null;
  }
  if (!item.markerText) return null;

  const textLeft = item.indent.left;
  const hanging = item.indent.hanging;
  // Markers stop at the content origin — except for a paragraph the author pulled INTO the
  // margin with a negative `w:ind` (§17.3.1.12), where pinning the marker at zero would put
  // the number to the RIGHT of the text it numbers.
  const floor = Math.min(0, textLeft);
  const slotLeft = Math.max(floor, textLeft - hanging);
  const slotWidth = Math.max(hanging, markerWidth);
  let x = slotLeft;
  if (item.markerAlign === 'right') {
    x = textLeft - markerWidth;
  } else if (item.markerAlign === 'center') {
    x = slotLeft + (slotWidth - markerWidth) / 2;
  }
  if (x < floor) x = floor;
  return { x, y: lineY, width: Math.max(markerWidth, 0), height: lineHeight };
}

/**
 * Where the FIRST line of a list paragraph starts, relative to `indent.left` (§17.9.30).
 *
 * A list paragraph's hanging indent is the marker's slot, so ordinarily the text starts at
 * `indent.left` and this is 0 — `w:suff="tab"` with a marker that fits is exactly that case.
 * The other three cases are where Word and a forced zero part company:
 *
 * - `w:suff="space"` — one space after the marker, then the text. Not a tab, not the indent.
 * - `w:suff="nothing"` — the text begins immediately after the marker.
 * - `w:suff="tab"` with a marker WIDER than its slot (`viii.`, `%1.%2.%3.`) — the suffix tab
 *   advances to the next tab stop past the marker, so the first line moves right instead of
 *   the marker being painted over its own first word.
 */
export function listFirstLineOffset(
  item: ResolvedListItem,
  measurer: TextMeasurer,
  tabStops: ResolvedTabStops = EMPTY_TAB_STOPS,
  rightEdge = Number.POSITIVE_INFINITY
): number {
  if (!item.markerText) return 0;
  const markerWidth = measurer.measure(item.markerText, item.markerStyle);
  const box = listMarkerBox(item, markerWidth, 0, 0);
  if (!box) return 0;
  const textLeft = item.indent.left;
  const markerEnd = box.x + box.width;
  if (item.suffix === 'nothing') return markerEnd - textLeft;
  if (item.suffix === 'space') {
    return markerEnd + measurer.measure(' ', item.markerStyle) - textLeft;
  }
  // `tab`: the implied stop is the paragraph indent itself; only an overflowing marker has
  // to look further along the paragraph's own stops.
  if (markerEnd <= textLeft) return 0;
  return nextTabDestination(tabStops, markerEnd, rightEdge).positionPt - textLeft;
}

/**
 * First-line offset for ANY paragraph: `w:firstLine` right, `w:hanging` left — except a list
 * item, whose first line is placed by its marker and `w:suff` ({@link listFirstLineOffset}).
 */
export function firstLineShift(
  item: ResolvedListItem | undefined,
  indent: { readonly left: number; readonly hanging: number; readonly firstLine: number },
  measurer: TextMeasurer,
  tabStops?: ResolvedTabStops,
  available?: number
): number {
  if (item) {
    return listFirstLineOffset(
      item,
      measurer,
      tabStops,
      available === undefined ? undefined : indent.left + available
    );
  }
  return indent.hanging > 0 ? -indent.hanging : indent.firstLine;
}
