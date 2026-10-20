import { registerListGeometry, rememberListItemShape } from './list-marker-reuse.ts';
import { walkStoryParagraphs } from './story-paragraph-walk.ts';
import { mergeListIndent } from './list-indent-merge.ts';
import { styleSeparatorMembersOf } from './style-separator-group.ts';
import { markerMeasureToken } from './list-marker-measure-key.ts';
import {
  numberingParagraphProperties,
  numberingParagraphToken,
  withNumberingParagraphProperties,
} from './numbering-paragraph-properties.ts';
// Resolve numbering into marker text, indentation, and font inputs for one story walk.

import type { OoxmlElement, OoxmlNode } from '@docx-editor.dev/core/store';
import type { OoxmlProperty } from '../store/store/tree-op-types.ts';
import { framedTokenJoin } from './layout-cache.ts';
import {
  createListCounterState,
  expandCountersOf,
  loadListCounters,
  numberLevelsOf,
  saveListCounters,
  type FullContextNumberSource,
  type ListCounterSnapshot,
} from './list-counters.ts';
import { resolvePictureBullet, type ResolvedPictureBullet } from './numbering-picture-bullet.ts';
import {
  EMPTY_NUMBERING_INDEX,
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
import { mapSymbolPuaText, mapSymbolBulletText } from './symbol-encoding.ts';
import { markerSymbolFontAvailability } from './marker-symbol-font.ts';
import type { TextMeasurer } from './semantic-records.ts';
import { resolveRunStyle, type ResolvedRunStyle } from './run-style.ts';
import { propertiesOf } from './paragraph-flow.ts';
import { numberingLevelTiers } from './numbering-level-tier.ts';
import { DEPENDENCY_KEY_IDS } from '../store/registry/frozen-ids.ts';
import type { LayoutScope } from './layout-scheduler.ts';
import type { LayoutSession } from './layout-session.ts';
import { numberingFlowBlocks } from './hidden-paragraph-mark.ts';

interface ListResolveChangeEvidence {
  readonly preservesNumberedSequence: boolean;
}

const listResolveEvidenceBySession = new WeakMap<LayoutSession, ListResolveChangeEvidence>();
let listResolveBlockVisits = 0;
let listResolveBlockScans = 0;

/** @internal Read session-scoped list resolve memo for tests. */
export function listResolveSessionMemoListItemsForTest(
  session: LayoutSession
): ReadonlyMap<string, ResolvedListItem> | undefined {
  return lastStoryResolvesBySession.get(session)?.listItems;
}

/** @internal Warm-path recorder for list resolve block walks. */
export function listResolveBlockVisitTestRecorder(): {
  readonly blockVisits: number;
  /** Blocks whose numbered paragraphs were read again rather than reused. */
  readonly blockScans: number;
  reset(): void;
} {
  return {
    get blockVisits() {
      return listResolveBlockVisits;
    },
    get blockScans() {
      return listResolveBlockScans;
    },
    reset() {
      listResolveBlockVisits = 0;
      listResolveBlockScans = 0;
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
  /** Counter value at this item's own level; absent for bullets. */
  readonly ordinal?: number;
  readonly markerAlign: ListMarkerAlign;
  readonly suffix: ListSuffix;
  /** Effective indent after merging level + paragraph indents, in points. */
  readonly indent: NumberingLevelIndent;
  readonly markerStyle: ResolvedRunStyle;
  /**
   * The image marker a `w:lvlPicBulletId` level resolved to, absent on every other item.
   *
   * Present means the marker is an IMAGE: it occupies `width` x `height` points in the
   * hanging slot and `markerText` is only what a sink that cannot draw the image falls back
   * to. The extent is the AUTHORED `v:shape` size scaled by the marker font size — see
   * {@link resolvePictureBullet}, which also decides when the answer is no picture at all.
   * Absent means the level declared none, named one the part does not declare, declared one
   * this projection could not read, or resolved to a size nothing can paint.
   */
  readonly picBullet?: ResolvedPictureBullet;
  /** Fingerprint for layout cache keys (indent, marker text, marker face). */
  readonly cacheToken: string;
}

/**
 * What composing an item's full-context number needs, keyed on the item object itself.
 *
 * A side channel rather than a `ResolvedListItem` member because the item type is public API
 * and only cross-reference resolution reads this. Entries ride the item maps the memos above
 * reuse by identity, and die with them.
 */
const listItemNumberSources = new WeakMap<ResolvedListItem, FullContextNumberSource>();

/** The composition inputs captured when `item` was counted, or undefined off this resolver. */
export function listItemNumberSource(item: ResolvedListItem): FullContextNumberSource | undefined {
  return listItemNumberSources.get(item);
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
 * One `w:numPr` tier read per FIELD. `undefined` means the tier does not state the field.
 *
 * `numId: null` is a tier that states "no numbering": `w:val="0"` (§17.9.18 — the null
 * numbering definition), a `w:numId` with no value, or an oversized value (hostile-input
 * guard). `ilvl: null` is a stated level outside 0–8, which invalidates the tier's
 * numbering the same way; an unparseable level reads as 0, as before.
 */
function numPrFieldsOf(
  node: OoxmlNode
): { numId: string | null | undefined; ilvl: number | null | undefined } | null {
  if (!isElement(node)) return null;
  const numPr = childNamed(node, 'numPr');
  if (!numPr) return null;
  const numIdNode = childNamed(numPr, 'numId');
  const ilvlNode = childNamed(numPr, 'ilvl');
  let numId: string | null | undefined;
  if (numIdNode) {
    const val = attrVal(numIdNode, 'val');
    numId = val !== undefined && val !== '0' && val.length <= 64 ? val : null;
  }
  let ilvl: number | null | undefined;
  if (ilvlNode) {
    const raw = attrVal(ilvlNode, 'val');
    const parsed = /^\d{1,2}$/.test(raw ?? '') ? Number(raw) : 0;
    ilvl = parsed <= 8 ? parsed : null;
  }
  return { numId, ilvl };
}

/**
 * Read `w:numPr` from cascaded paragraph-property nodes (lowest precedence first).
 *
 * Flat `OoxmlProperty[]` bags drop nested `ilvl`/`numId`, so this walks the tree nodes
 * the same way borders and tabs do.
 *
 * `w:ilvl` and `w:numId` inherit INDEPENDENTLY through the style chain and the direct
 * `w:pPr` (§17.3.1.19): a tier stating only the level keeps the id it inherits — Word's
 * standard Heading2–Heading9 shape, where only Heading1 names the `w:num` — and a tier
 * stating only the id keeps the inherited level. Treating each `w:numPr` node as a full
 * replacement dropped the id at every level-only tier and unnumbered the paragraph. A
 * stated `w:numId w:val="0"` (or an invalid value) still switches numbering off at that
 * tier even when a lower tier set one; a higher tier stating a valid id re-enables. A
 * level-only tier with no id inherited from below resolves to no numbering.
 */
export function readNumPr(
  paragraphPropertyNodes: readonly OoxmlNode[]
): { numId: string; ilvl: number } | null {
  let numId: string | null = null;
  let ilvl = 0;
  for (const node of paragraphPropertyNodes) {
    const fields = numPrFieldsOf(node);
    if (!fields) continue;
    if (fields.numId !== undefined) numId = fields.numId;
    if (fields.ilvl !== undefined) {
      if (fields.ilvl === null) numId = null;
      else ilvl = fields.ilvl;
    }
  }
  return numId === null ? null : { numId, ilvl };
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
    const fields = node ? numPrFieldsOf(node) : null;
    // The NEAREST style that states `w:numId` decides, exactly as the merged read above
    // does: a stated `w:val="0"` switches numbering off rather than deferring to the
    // base, and a level-only `w:numPr` keeps walking for the id it inherits.
    if (fields && fields.numId !== undefined) return fields.numId ?? undefined;
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

export { mergeListIndent } from './list-indent-merge.ts';

/**
 * Collect paragraphs of a block list in document order, descending into tables.
 *
 * Caps nesting so a hostile nested-table document cannot recurse without bound.
 */
export { walkStoryParagraphs } from './story-paragraph-walk.ts';

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
  /** Properties below and above the numbering level, from `numberingLevelTiers`. */
  readonly belowLevel: readonly OoxmlProperty[];
  readonly aboveLevel: readonly OoxmlProperty[];
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
  const numPr = readNumPr(nodes);
  // Only a list paragraph reads the tiers; skip the second style-chain walk for the rest.
  const tiers =
    numPr && styleCascade && cascaded
      ? numberingLevelTiers(styleCascade, cascaded.styleId, pPr)
      : { below: [], above: propertiesOf(pPr) };
  const markProps = cascaded ? cascaded.markRunProperties : propertiesOf(directMarkRun);
  // An admitted separator hides its mark, not its heading number. Content and level
  // visibility remain independent, so an actually hidden list keeps its hidden marker.
  const inheritedMarkProps = styleSeparatorMembersOf(paragraph)
    ? [
        ...markProps.filter((property) => property.localName !== 'vanish'),
        ...(cascaded?.runProperties.filter((property) => property.localName === 'vanish') ?? []),
      ]
    : markProps;
  const prelude: ParagraphListPrelude = {
    styleCascade,
    numPr,
    belowLevel: tiers.below,
    aboveLevel: tiers.above,
    inheritedMarkProps,
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
  if (index.nums.size === 0) return new Map();
  return resolveListSequence(walkStoryParagraphs(blocks), index, styleCascade, isFontAvailable)
    .items;
}

/** Numbered paragraphs between two saved counter states of a {@link ListSequenceResolve}. */
const LIST_RESUME_STRIDE = 256;

/** One list walk, with the counter state saved every {@link LIST_RESUME_STRIDE} paragraphs. */
interface ListSequenceResolve {
  readonly items: ReadonlyMap<string, ResolvedListItem>;
  /** `states[k]` is the counter state before paragraph `k * LIST_RESUME_STRIDE`. */
  readonly states: readonly ListCounterSnapshot[];
}

/**
 * The list walk over `paragraphs` in story order. With `resume`, the walk starts from the last
 * saved state at or before paragraph `from`, and takes the items before it from the previous
 * walk: a number depends only on the paragraphs before it, and those are the same.
 */
function resolveListSequence(
  paragraphs: readonly OoxmlElement[],
  index: NumberingIndex,
  styleCascade: StyleCascadeTable | undefined,
  isFontAvailable: ((family: string) => boolean) | undefined,
  resume?: { readonly from: number; readonly previous: ListSequenceResolve }
): ListSequenceResolve {
  const map = new Map<string, ResolvedListItem>();
  // A definition that delegates through `w:numStyleLink` has no levels of its own; resolving
  // the link here is what keeps those paragraphs from losing their markers entirely.
  const linked = withNumberingStyleLinks(index, styleCascade);
  const counters = createListCounterState(linked);
  const states: ListCounterSnapshot[] = [];
  let start = 0;
  if (resume) {
    const checkpoint = Math.min(
      Math.floor(resume.from / LIST_RESUME_STRIDE),
      resume.previous.states.length - 1
    );
    if (checkpoint > 0) {
      start = checkpoint * LIST_RESUME_STRIDE;
      states.push(...resume.previous.states.slice(0, checkpoint + 1));
      loadListCounters(counters, resume.previous.states[checkpoint]!);
      for (let position = 0; position < start; position += 1) {
        const id = paragraphs[position]!.id;
        const item = resume.previous.items.get(id);
        if (item) map.set(id, item);
      }
    }
  }
  for (let position = start; position < paragraphs.length; position += 1) {
    if (position % LIST_RESUME_STRIDE === 0 && states.length === position / LIST_RESUME_STRIDE)
      states.push(saveListCounters(counters));
    const paragraph = paragraphs[position]!;
    const prelude = paragraphListPrelude(paragraph, styleCascade);
    const numPr = prelude.numPr;
    if (!numPr) continue;

    const advanced = counters.advance(numPr.numId, numPr.ilvl);
    if (!advanced) continue;

    let levelDerived = prelude.perLevel.get(advanced.level);
    if (!levelDerived) {
      // Split, not flattened: the merge needs the tiers below and above the level apart.
      const indent = mergeListIndent(advanced.level.indent, prelude.belowLevel, prelude.aboveLevel);
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
    const { indent, markerStyle: authoredMarkerStyle } = levelDerived;
    // Word writes a Symbol/Wingdings bullet as font-byte + 0xF000 (`` = U+F0B7 in
    // Symbol), which is a private-use codepoint no other font can draw. Mapping it here —
    // where the marker's FAMILY is finally known — keeps measurement and paint on the same
    // string; doing it in the painter would size the marker box for a glyph nobody draws.
    const mapMarker = advanced.level.numFmt === 'bullet' ? mapSymbolBulletText : mapSymbolPuaText;
    const markerText = mapMarker(
      advanced.markerText,
      authoredMarkerStyle.fontFamily,
      isFontAvailable
    );
    // The marker keeps its authored face even when its glyph was translated to Unicode. An
    // unavailable symbol face still sizes the line and the marker by its own metrics
    // (`symbol-face-metrics.ts`), and paint draws the Unicode twin in a face that has it.
    // Never mutate the cached level style.
    const markerStyle = authoredMarkerStyle;
    // `w:lvlPicBulletId` names a `w:numPicBullet` of the SAME part. A level naming one the
    // part never declared, or one whose VML this projection could not read, keeps its
    // `w:lvlText` — a missing image must never cost the reader the marker entirely.
    const authoredPicBullet =
      advanced.level.picBulletId === undefined
        ? undefined
        : linked.pictureBullets?.get(advanced.level.picBulletId);
    const picBullet = authoredPicBullet
      ? (resolvePictureBullet(authoredPicBullet, markerStyle.fontSizePt) ?? undefined)
      : undefined;
    // Length-framed: `numFmt`, `lvlText`, and the marker are verbatim file text that can
    // carry any printable separator, so a separator join lets two different level
    // geometries serialize to one token and share a break-cache entry.
    const tokenParts = [
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
      numberingParagraphToken(advanced.level),
      // The MARKER ITSELF, not its length. The first line starts where the marker ends
      // whenever the marker overflows its hanging slot, so `9.` and `10.` break differently —
      // and so do `ii.` and `vi.`, which the length cannot tell apart. A warm cache then
      // served the previous marker's width to the new one, and the line wrapped a word late.
      markerText,
      // The FACE, not just the glyphs. `listFirstLineOffset` measures with `markerStyle`,
      // so a level `w:sz` or font change moves the wrap while the text and indent stay put.
      markerMeasureToken(markerStyle),
      // The picture marker's identity and DRAWN extent. It replaces the marker glyph, so
      // it decides both the first line's start and the first line's height.
      picBullet ? `${picBullet.relationshipId}:${picBullet.width}:${picBullet.height}` : '',
    ].map(String);
    const cacheToken = framedTokenJoin(tokenParts);

    const item: ResolvedListItem = {
      numId: advanced.numId,
      ilvl: advanced.ilvl,
      abstractNumId: advanced.abstractNumId,
      numFmt: advanced.level.numFmt,
      markerText,
      ...(advanced.level.numFmt === 'bullet'
        ? {}
        : { ordinal: advanced.counters[advanced.ilvl] ?? 1 }),
      markerAlign: advanced.level.lvlJc,
      suffix: advanced.level.suff,
      indent,
      markerStyle,
      ...(picBullet ? { picBullet } : {}),
      cacheToken,
    };
    withNumberingParagraphProperties(item, numberingParagraphProperties(advanced.level));
    // Everything but the marker text (part 12), for keys that read its geometry instead.
    rememberListItemShape(
      item,
      framedTokenJoin([...tokenParts.slice(0, 12), ...tokenParts.slice(13)])
    );
    listItemNumberSources.set(item, {
      levels: numberLevelsOf(linked, advanced.numId),
      ilvl: advanced.ilvl,
      expandCounters: expandCountersOf(advanced),
    });
    map.set(paragraph.id, item);
  }
  return { items: map, states };
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
  /**
   * The pass's measurer, read ONLY to learn which legacy symbol faces were admitted.
   *
   * A caller may still pass {@link isFontAvailable} explicitly and it wins; absent one, the
   * measurer answers, because it is the only input that already knows the admitted faces and
   * is already folded into every layout cache key. A caller with no measurer (the REF-refresh
   * save path) keeps the pre-font-resolution answer: translate the private-use bullet.
   */
  readonly measurer?: TextMeasurer;
};

/** The oracle a pass actually resolves with: an explicit one, else the measurer's coverage. */
function listFontAvailability(
  options: WithResolvedListItemsOptions
): ((family: string) => boolean) | undefined {
  return options.isFontAvailable ?? markerSymbolFontAvailability(options.measurer);
}

function resolvedListItemsMemoHit(
  options: WithResolvedListItemsOptions,
  isFontAvailable: ((family: string) => boolean) | undefined,
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
    memo.isFontAvailable === isFontAvailable
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
  flowBlocks: readonly OoxmlElement[],
  memoOwner: LayoutSession | undefined
): T & {
  readonly numberingIndex: NumberingIndex;
  readonly listItems?: ReadonlyMap<string, ResolvedListItem>;
} {
  // Paragraphs a hidden mark took out of the flow still count; see `hidden-paragraph-mark.ts`.
  const blocks = numberingFlowBlocks(flowBlocks);
  const isFontAvailable = listFontAvailability(options);
  if (options.listItems === undefined) {
    const memo = resolvedListItemsMemoHit(options, isFontAvailable, blocks, memoOwner);
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
      ? resolvedListItemsMemoHit(options, isFontAvailable, blocks, memoOwner)
      : undefined;
  const numberingIndex =
    memoBeforeResolve &&
    memoBeforeResolve.rawIndex === options.numberingIndex &&
    memoBeforeResolve.styleCascade === options.styleCascade &&
    memoBeforeResolve.isFontAvailable === isFontAvailable
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
          isFontAvailable,
          memoOwner
        )
      : undefined);
  if (options.listItems === undefined) {
    rememberResolvedListItemsMemo(blocks, memoOwner, {
      rawIndex: options.numberingIndex,
      styleCascade: options.styleCascade,
      isFontAvailable,
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
    readonly measurer?: TextMeasurer;
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
  const resolved = withResolvedListItemsInternal(options, blocks, session);
  registerListGeometry(resolved.listItems, options.measurer);
  return resolved;
}

/** Numbered paragraphs of one top-level block, memoized per (immutable block, cascade). */
interface NumberedBlockMemo {
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly numbered: readonly OoxmlElement[];
}
const numberedBlockMemos = new WeakMap<OoxmlElement, NumberedBlockMemo>();
const NO_NUMBERED_PARAGRAPHS: readonly OoxmlElement[] = Object.freeze([]);

/**
 * Whether any paragraph in `block` can carry a list item under `styleCascade`. Both list
 * resolves give items only to these paragraphs, so a block without one has no list token.
 */
export function blockHasNumberedParagraphs(
  block: OoxmlElement,
  styleCascade: StyleCascadeTable | undefined
): boolean {
  return numberedParagraphsOfBlock(block, styleCascade).length > 0;
}

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
  /** The walk behind `listItems` and the numbered paragraphs it walked, for a resume. */
  readonly walk?: {
    readonly paragraphs: readonly OoxmlElement[];
    readonly resolve: ListSequenceResolve;
  };
}
const lastStoryResolvesByAnchor = new WeakMap<OoxmlElement, LastStoryResolve>();
const lastStoryResolvesBySession = new WeakMap<LayoutSession, LastStoryResolve>();

function sameNumberedParagraph(paragraph: OoxmlElement, previous: OoxmlElement | undefined) {
  if (!previous || paragraph.id !== previous.id) return false;
  const properties = paragraph.children.find((child) => child.kind === 'paragraphProperties');
  const previousProperties = previous.children.find(
    (child) => child.kind === 'paragraphProperties'
  );
  return properties === previousProperties;
}

function sameNumberingSequence(a: readonly OoxmlElement[], b: readonly OoxmlElement[]): boolean {
  return (
    a.length === b.length &&
    a.every((paragraph, index) => sameNumberedParagraph(paragraph, b[index]))
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
  // A paragraph added or removed shifts every block after it: match the unchanged tail from the
  // end, so those blocks keep their scans instead of each being read again.
  const shift = last ? last.blocks.length - blocks.length : 0;
  let tail = 0;
  if (last && shift !== 0) {
    const shorter = Math.min(blocks.length, last.blocks.length);
    while (
      tail < shorter &&
      blocks[blocks.length - 1 - tail] === last.blocks[last.blocks.length - 1 - tail]
    )
      tail += 1;
  }
  for (let index = 0; index < blocks.length; index += 1) {
    listResolveBlockVisits += 1;
    const block = blocks[index]!;
    const previousIndex = index >= blocks.length - tail ? index + shift : index;
    // A style can number a paragraph, so a block's list holds only under the same cascade.
    const numbered =
      last && last.blocks[previousIndex] === block && last.styleCascade === styleCascade
        ? last.numberedByBlock[previousIndex]!
        : (listResolveBlockScans++, numberedParagraphsOfBlock(block, styleCascade));
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
  // Resume from the first numbered paragraph that changed: an Enter in a long numbered
  // document otherwise renumbered every list item before it as well.
  const paragraphs = numberedByBlock.flat();
  const previous =
    last?.walk &&
    last.rawIndex === rawIndex &&
    last.styleCascade === styleCascade &&
    last.isFontAvailable === isFontAvailable
      ? last.walk
      : undefined;
  let from = 0;
  while (
    previous &&
    from < paragraphs.length &&
    sameNumberedParagraph(paragraphs[from]!, previous.paragraphs[from])
  )
    from += 1;
  const resolve = resolveListSequence(
    paragraphs,
    linkedIndex,
    styleCascade,
    isFontAvailable,
    previous ? { from, previous: previous.resolve } : undefined
  );
  const listItems = resolve.items;
  const walk = { paragraphs, resolve };
  const next = {
    rawIndex,
    styleCascade,
    isFontAvailable,
    blocks,
    numberedByBlock,
    listItems,
    walk,
  };
  if (memoOwner) lastStoryResolvesBySession.set(memoOwner, next);
  else {
    if (first) lastStoryResolvesByAnchor.set(first, next);
    if (lastBlock && lastBlock !== first) lastStoryResolvesByAnchor.set(lastBlock, next);
  }
  return listItems;
}

export {
  firstLineShift,
  listFirstLineOffset,
  listMarkerBox,
  listMarkerWidth,
} from './list-marker-geometry.ts';
