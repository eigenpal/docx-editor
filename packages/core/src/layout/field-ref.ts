// REF cross-reference fields (§17.16.5.45): live results from the bookmark target and the
// resolved numbering, so a reference tracks its section instead of painting a stale cache.
//
// The instruction is attacker-controlled and NEVER executes. Recognition is one bounded,
// quote-aware tokenize pass over a length-capped string; anything outside the supported
// grammar — an unknown switch (`\p`, `\f`, `\d`, `\#`, …), a missing bookmark argument, an
// over-long name — resolves to null and the field keeps painting its cached result exactly as
// before. `\* MERGEFORMAT` is inert; `\h` only parses (navigation is not wired here).
//
// Resolution reads three story-derived inputs, all bounded:
//   - bookmark name → target paragraph, indexed ONLY for referenced names (the index can never
//     outgrow the capped reference count), first declaration in document order wins;
//   - a number switch (`\r` / `\w` / `\n`) → the target's number in FULL CONTEXT, composed
//     from the counter path by `composeFullContextNumber` — a deep legal level like `(%3)`
//     states only its own placeholder, so its marker (`(c)`) is not the number a reader
//     cites; the composition paints `1.2(c)` the way Word's cached result does;
//   - a plain REF → the bookmarked text inside the target paragraph, length-capped.
//
// DEVIATION: `\r` (relative context) and `\w` (full context) both paint the full-context
// number. Deriving Word's relative form would need the referencing paragraph's own list
// position and is out of scope. All three number switches share Word's trailing-period trim
// (`1.2` stays `1.2`, a bare `1.` becomes `1`).
//
// DEVIATION: plain-REF extraction stays inside the target paragraph. A bookmark whose end
// marker sits outside that paragraph contributes the start paragraph's tail only — the cap
// that keeps a hostile range from inflating layout keys and painted spans.
//
// Every per-paragraph scan is memoized on the immutable paragraph node and every per-block
// aggregate on the block node, so an incremental pass pays pointer lookups for unchanged
// content. `resolveStoryRefFields` returns null for the common no-REF story, which costs
// callers nothing downstream.

import {
  fldSimpleInstr,
  isFldSimple,
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import {
  consumeScanNode,
  createFieldParseState,
  createScanBudget,
  effectiveFieldInstruction,
  ingestInstrTextBounded,
  isFldChar,
  isInstrText,
  MAX_FIELD_INSTRUCTION_CHARS,
  MAX_STORY_FIELD_SCAN_DEPTH,
  onFldCharBegin,
  onFldCharEnd,
  onFldCharSeparate,
} from './field-instruction.ts';
import { composeFullContextNumber } from './list-counters.ts';
import {
  listItemNumberSource,
  walkStoryParagraphs,
  type ResolvedListItem,
} from './list-resolve.ts';

/** Word's own bookmark-name limit is 40; this is the fail-closed bound, not a fidelity claim. */
const MAX_REF_BOOKMARK_NAME_CHARS = 256;
/** Ceiling on live-resolved REF fields per story; fields past it keep their cached results. */
const MAX_REF_FIELDS_PER_STORY = 512;
/** Length cap on a plain REF's extracted text — file data must not inflate keys or spans. */
const MAX_REF_TEXT_CHARS = 1024;
/** Ceiling on bookmark names remembered per top-level block (hostile declaration spam). */
const MAX_REF_BOOKMARKS_PER_BLOCK = 2048;

/** One recognized REF instruction: the target name and the supported switches, nothing else. */
export interface RefFieldSpec {
  readonly bookmark: string;
  /** `r` / `w` paint the target's number; `n` the same without context; null the range text. */
  readonly numberSwitch: 'r' | 'w' | 'n' | null;
  /** `\h` parsed and inert — the reference paints; navigation is a follow-up. */
  readonly hyperlink: boolean;
}

/**
 * Split a whitespace-collapsed instruction into space- or quote-delimited tokens.
 *
 * One linear pass, no regex over file-derived text. An unterminated quote fails the whole
 * parse (null) rather than guessing where the argument ends.
 */
function tokenizeInstruction(collapsed: string): string[] | null {
  const tokens: string[] = [];
  let index = 0;
  while (index < collapsed.length) {
    const char = collapsed[index]!;
    if (char === ' ') {
      index += 1;
      continue;
    }
    if (char === '"') {
      const close = collapsed.indexOf('"', index + 1);
      if (close === -1) return null;
      tokens.push(collapsed.slice(index + 1, close));
      index = close + 1;
      continue;
    }
    let end = index;
    while (end < collapsed.length && collapsed[end] !== ' ') end += 1;
    tokens.push(collapsed.slice(index, end));
    index = end;
  }
  return tokens;
}

/**
 * Recognize `REF <bookmark> [\r|\w|\n] [\h] [\* MERGEFORMAT]`, or null for anything else.
 *
 * The keyword matches case-insensitively; the bookmark name keeps its authored case (it is a
 * lookup key into a Map, never an object property, so hostile names like `__proto__` are just
 * names that resolve to nothing). Any unrecognized switch fails the parse so the field falls
 * back to its cached result — never the raw instruction, never a guess.
 */
export function parseRefInstruction(raw: string): RefFieldSpec | null {
  if (raw.length > MAX_FIELD_INSTRUCTION_CHARS) return null;
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed.length > MAX_FIELD_INSTRUCTION_CHARS) return null;
  const tokens = tokenizeInstruction(collapsed);
  if (tokens === null || tokens.length < 2) return null;
  if (tokens[0]!.toUpperCase() !== 'REF') return null;
  const bookmark = tokens[1]!;
  if (
    bookmark.length === 0 ||
    bookmark.length > MAX_REF_BOOKMARK_NAME_CHARS ||
    bookmark.startsWith('\\')
  ) {
    return null;
  }
  let numberSwitch: RefFieldSpec['numberSwitch'] = null;
  let hyperlink = false;
  for (let index = 2; index < tokens.length; index += 1) {
    const token = tokens[index]!.toUpperCase();
    if (token === '\\R') numberSwitch = 'r';
    else if (token === '\\W') numberSwitch = 'w';
    else if (token === '\\N') numberSwitch = 'n';
    else if (token === '\\H') hyperlink = true;
    else if (token === '\\*' && tokens[index + 1]?.toUpperCase() === 'MERGEFORMAT') index += 1;
    else if (token === '\\*MERGEFORMAT') continue;
    else return null;
  }
  return { bookmark, numberSwitch, hyperlink };
}

/**
 * The story's resolved REF inputs for one layout pass.
 *
 * Threaded as a runtime rider on the layout options (see `layoutSemanticDocument`) rather
 * than a `SemanticLayoutOptions` member, so the public options surface stays put. Absent
 * means every REF field paints its cached result — the pre-existing degradation, and the one
 * header/footer, note and text-box stories still take.
 */
export interface RefFieldContext {
  /**
   * Content token over every resolvable REF value in the story, for the section prepass
   * memo. A renumbering edit can move a REF value in a section whose own blocks and list
   * map are identity-unchanged, and this token is the only validator that sees it.
   */
  readonly valuesToken: string;
  /** The paragraph's REF values folded for its block cache key; `''` when it holds none. */
  tokenForParagraph(paragraphId: string): string;
  /** Resolve one recognized instruction, or null to keep the cached result. */
  valueOf(spec: RefFieldSpec): string | null;
}

function wmlAttribute(node: OoxmlElement, localName: string): string | undefined {
  for (const attribute of node.attributes) {
    if (attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === localName) {
      return attribute.value;
    }
  }
  return undefined;
}

/** REF specs and bookmark names one paragraph carries; shared empty for the common case. */
interface ParagraphRefScan {
  readonly specs: readonly RefFieldSpec[];
  readonly bookmarks: readonly string[];
}
const EMPTY_STRINGS: readonly string[] = Object.freeze([]);
const EMPTY_SPECS: readonly RefFieldSpec[] = Object.freeze([]);
const EMPTY_REF_SCAN: ParagraphRefScan = Object.freeze({
  specs: EMPTY_SPECS,
  bookmarks: EMPTY_STRINGS,
});

/** Memoized per immutable paragraph node — an edit republishes only touched paragraphs. */
const paragraphRefScans = new WeakMap<OoxmlElement, ParagraphRefScan>();

/** A drawing hosts its own story; its bookmarks and fields are not this paragraph's. */
function isDrawingHost(node: OoxmlElement): boolean {
  return node.kind === 'drawing' || node.localName === 'drawing' || node.localName === 'pict';
}

/**
 * Bounded scan of one paragraph: level-1 complex REF instructions (the only ones projection
 * live-paints), `w:fldSimple` REF instructions, and declared bookmark names.
 *
 * Mirrors the projection walk's capture sites — the outermost `separate`, the no-separate
 * outermost `end` — so this is a superset of what synthesis will ask to resolve; a spec seen
 * here and never painted only widens a cache token, which can cost a re-measure but never
 * leave one stale.
 */
function scanParagraphRefs(paragraph: OoxmlElement): ParagraphRefScan {
  const cached = paragraphRefScans.get(paragraph);
  if (cached) return cached;
  let specs: RefFieldSpec[] | null = null;
  let bookmarks: string[] | null = null;
  const budget = createScanBudget();
  const field = createFieldParseState();

  const pushSpec = (raw: string): void => {
    const spec = parseRefInstruction(raw);
    if (spec) (specs ??= []).push(spec);
  };
  const captureLevelOne = (): void => {
    if (field.nesting !== 1 || field.phase !== 'instruction' || field.nestingOverflow) return;
    const effective = effectiveFieldInstruction(field);
    if (!effective.overflow) pushSpec(effective.instruction);
  };

  const visit = (node: OoxmlNode, depth: number): void => {
    if (node.kind === 'textValue') return;
    if (budget.exhausted || depth > MAX_STORY_FIELD_SCAN_DEPTH) return;
    if (node.kind === 'bookmarkStart') {
      const name = wmlAttribute(node, 'name');
      if (name !== undefined && name.length > 0 && name.length <= MAX_REF_BOOKMARK_NAME_CHARS) {
        (bookmarks ??= []).push(name);
      }
      return;
    }
    if (node.kind === 'run') {
      for (const grand of node.children) {
        if (!consumeScanNode(budget)) return;
        if (grand.kind === 'runProperties') continue;
        if (isFldChar(grand, 'begin')) {
          onFldCharBegin(field);
          continue;
        }
        if (isInstrText(grand)) {
          ingestInstrTextBounded(field, grand, budget, depth + 1);
          continue;
        }
        if (isFldChar(grand, 'separate')) {
          captureLevelOne();
          onFldCharSeparate(field);
          continue;
        }
        if (isFldChar(grand, 'end')) {
          captureLevelOne();
          onFldCharEnd(field);
        }
      }
      return;
    }
    if (isFldSimple(node)) {
      // The outer instruction only: a field nested in a simple field's cached result is never
      // live-projected as a REF, so descending would key on values nothing paints.
      pushSpec(fldSimpleInstr(node) ?? '');
      return;
    }
    if (isDrawingHost(node)) return;
    if (!consumeScanNode(budget)) return;
    for (const child of node.children) visit(child, depth + 1);
  };
  for (const child of paragraph.children) {
    if (!consumeScanNode(budget)) break;
    visit(child, 1);
  }

  const scan: ParagraphRefScan =
    specs === null && bookmarks === null
      ? EMPTY_REF_SCAN
      : Object.freeze({ specs: specs ?? EMPTY_SPECS, bookmarks: bookmarks ?? EMPTY_STRINGS });
  paragraphRefScans.set(paragraph, scan);
  return scan;
}

/** One top-level block's aggregate, memoized on the block node (tables included). */
interface BlockRefScan {
  readonly specsByParagraph: ReadonlyMap<string, readonly RefFieldSpec[]> | null;
  readonly bookmarkOwners: ReadonlyMap<string, OoxmlElement> | null;
}
const EMPTY_BLOCK_SCAN: BlockRefScan = Object.freeze({
  specsByParagraph: null,
  bookmarkOwners: null,
});
const blockRefScans = new WeakMap<OoxmlElement, BlockRefScan>();

function scanBlockRefs(block: OoxmlElement): BlockRefScan {
  const cached = blockRefScans.get(block);
  if (cached) return cached;
  let specsByParagraph: Map<string, readonly RefFieldSpec[]> | null = null;
  let bookmarkOwners: Map<string, OoxmlElement> | null = null;
  for (const paragraph of walkStoryParagraphs([block])) {
    const scan = scanParagraphRefs(paragraph);
    if (scan.specs.length > 0) (specsByParagraph ??= new Map()).set(paragraph.id, scan.specs);
    for (const name of scan.bookmarks) {
      bookmarkOwners ??= new Map();
      // First declaration wins, the same rule the jump-target index applies: a duplicate name
      // must not make a reference move when an unrelated edit re-declares it later.
      if (!bookmarkOwners.has(name) && bookmarkOwners.size < MAX_REF_BOOKMARKS_PER_BLOCK) {
        bookmarkOwners.set(name, paragraph);
      }
    }
  }
  const scan: BlockRefScan =
    specsByParagraph === null && bookmarkOwners === null
      ? EMPTY_BLOCK_SCAN
      : Object.freeze({ specsByParagraph, bookmarkOwners });
  blockRefScans.set(block, scan);
  return scan;
}

/** Word trims one trailing period off a referenced number: `1.` → `1`, `1.2` stays `1.2`. */
function trimTrailingPeriod(marker: string): string {
  return marker.length > 1 && marker.endsWith('.') ? marker.slice(0, -1) : marker;
}

/** Plain-REF text per (target paragraph, name), memoized on the immutable paragraph. */
const bookmarkTextMemos = new WeakMap<OoxmlElement, Map<string, string>>();

/**
 * The bookmarked text inside the target paragraph: from the named `w:bookmarkStart` to the
 * `w:bookmarkEnd` carrying the same `w:id`, or to the paragraph's end when the range runs
 * past it. Length-capped; collects `w:t` and tabs only — deleted text, field chrome and
 * drawings never join a computed result.
 */
function bookmarkRangeText(paragraph: OoxmlElement, name: string): string {
  let memo = bookmarkTextMemos.get(paragraph);
  const cached = memo?.get(name);
  if (cached !== undefined) return cached;

  let collecting = false;
  let done = false;
  let endId: string | undefined;
  let text = '';
  const budget = createScanBudget();

  const append = (value: string): void => {
    const room = MAX_REF_TEXT_CHARS - text.length;
    if (room <= 0) {
      done = true;
      return;
    }
    text += value.length > room ? value.slice(0, room) : value;
  };

  const visit = (node: OoxmlNode, depth: number): void => {
    if (done || node.kind === 'textValue') return;
    if (budget.exhausted || depth > MAX_STORY_FIELD_SCAN_DEPTH) return;
    if (node.kind === 'bookmarkStart') {
      if (!collecting && wmlAttribute(node, 'name') === name) {
        collecting = true;
        endId = wmlAttribute(node, 'id');
      }
      return;
    }
    if (node.kind === 'bookmarkEnd') {
      if (collecting && endId !== undefined && wmlAttribute(node, 'id') === endId) done = true;
      return;
    }
    if (node.kind === 'run') {
      if (!collecting) return;
      for (const grand of node.children) {
        if (done || !consumeScanNode(budget)) return;
        if (grand.kind === 'text') {
          for (const value of grand.children) {
            if (value.kind === 'textValue') append(value.value);
          }
        } else if (grand.kind === 'tab') {
          append('\t');
        }
      }
      return;
    }
    if (isDrawingHost(node) || isFldSimple(node)) return;
    if (!consumeScanNode(budget)) return;
    for (const child of node.children) visit(child, depth + 1);
  };
  for (const child of paragraph.children) {
    if (done || !consumeScanNode(budget)) break;
    visit(child, 1);
  }

  if (!memo) {
    memo = new Map();
    bookmarkTextMemos.set(paragraph, memo);
  }
  memo.set(name, text);
  return text;
}

interface RefContextMemoEntry {
  readonly listItems: ReadonlyMap<string, ResolvedListItem> | undefined;
  readonly context: RefFieldContext | null;
}
/**
 * Memo keyed on the story blocks array (stable per part and display mode via `storyBlocks`)
 * and validated against the list map by identity — the two inputs every resolved value
 * derives from. A keystroke publishes a new part, so a miss re-aggregates, but the per-block
 * memos above make that pointer lookups over unchanged blocks.
 */
const refContextMemos = new WeakMap<readonly OoxmlElement[], RefContextMemoEntry>();

function buildRefFieldContext(
  blocks: readonly OoxmlElement[],
  listItems: ReadonlyMap<string, ResolvedListItem> | undefined
): RefFieldContext | null {
  const specsByParagraph = new Map<string, readonly RefFieldSpec[]>();
  const blockScans: BlockRefScan[] = [];
  let totalSpecs = 0;
  for (const block of blocks) {
    const scan = scanBlockRefs(block);
    blockScans.push(scan);
    if (!scan.specsByParagraph) continue;
    for (const [paragraphId, specs] of scan.specsByParagraph) {
      if (totalSpecs >= MAX_REF_FIELDS_PER_STORY) break;
      specsByParagraph.set(paragraphId, specs);
      totalSpecs += specs.length;
    }
  }
  if (specsByParagraph.size === 0) return null;

  // Index only referenced names, so the map is bounded by the capped reference count. A Map,
  // never an object: bookmark names are attacker-chosen keys.
  const referenced = new Set<string>();
  for (const specs of specsByParagraph.values()) {
    for (const spec of specs) referenced.add(spec.bookmark);
  }
  const targets = new Map<string, OoxmlElement>();
  for (const scan of blockScans) {
    if (!scan.bookmarkOwners) continue;
    for (const [name, paragraph] of scan.bookmarkOwners) {
      if (referenced.has(name) && !targets.has(name)) targets.set(name, paragraph);
    }
  }

  const resolve = (spec: RefFieldSpec): string | null => {
    const target = targets.get(spec.bookmark);
    if (!target) return null;
    if (spec.numberSwitch !== null) {
      const item = listItems?.get(target.id);
      if (!item) return null;
      // Full context first: a deep level's marker states only its own placeholder, and
      // painting bare `(c)` for a `1.2(c)` target is worse than the stale cache. Items built
      // outside `resolveStoryListItems` carry no counter source; their marker (already the
      // full context in the shapes that reach them) is the bounded fallback.
      const source = listItemNumberSource(item);
      const composed = source !== undefined ? composeFullContextNumber(source) : null;
      // A bullet has a marker but no number a reader can cite — cached fallback, not a glyph.
      const fallback =
        item.numFmt !== 'bullet' && item.numFmt !== 'none' && item.markerText.length > 0
          ? item.markerText
          : null;
      const value = composed ?? fallback;
      if (value === null) return null;
      return trimTrailingPeriod(value);
    }
    const text = bookmarkRangeText(target, spec.bookmark);
    return text.length > 0 ? text : null;
  };

  const values = new Map<string, string | null>();
  const valueOf = (spec: RefFieldSpec): string | null => {
    const key = `${spec.numberSwitch ?? 't'}\u0000${spec.bookmark}`;
    const cached = values.get(key);
    if (cached !== undefined || values.has(key)) return cached ?? null;
    const value = resolve(spec);
    values.set(key, value);
    return value;
  };

  // `\u0002` marks an unresolved value so "resolves to nothing" and "resolves to empty" move
  // the token when they trade places.
  const tokens = new Map<string, string>();
  const storyParts: string[] = [];
  for (const [paragraphId, specs] of specsByParagraph) {
    const token = specs
      .map(
        (spec) =>
          `${spec.numberSwitch ?? 't'}\u0001${spec.bookmark}\u0001${valueOf(spec) ?? '\u0002'}`
      )
      .join('\u0003');
    tokens.set(paragraphId, token);
    storyParts.push(token);
  }

  return {
    valuesToken: storyParts.join('\u0004'),
    tokenForParagraph: (paragraphId) => tokens.get(paragraphId) ?? '',
    valueOf,
  };
}

/**
 * Resolve the story's REF fields for one layout pass, or null when it has none.
 *
 * Bookmarks and REF fields resolve within one story: a body REF finds body bookmarks. Other
 * stories (headers, footers, notes, text boxes) are not given a context and keep painting
 * cached results.
 */
export function resolveStoryRefFields(
  blocks: readonly OoxmlElement[],
  listItems: ReadonlyMap<string, ResolvedListItem> | undefined
): RefFieldContext | null {
  const memo = refContextMemos.get(blocks);
  if (memo && memo.listItems === listItems) return memo.context;
  const context = buildRefFieldContext(blocks, listItems);
  refContextMemos.set(blocks, { listItems, context });
  return context;
}

/**
 * Aggregate the REF tokens of every paragraph a table contains, for its prepared-block memo
 * and cache key — the same shape as the table's list-token aggregate, for the same reason: a
 * REF value change inside a cell moves nothing else in the table's key.
 */
export function refTokenForTableBlock(table: OoxmlElement, context: RefFieldContext): string {
  const tokens: string[] = [];
  for (const paragraph of walkStoryParagraphs([table])) {
    const token = context.tokenForParagraph(paragraph.id);
    if (token) tokens.push(token);
  }
  return tokens.join(';');
}
