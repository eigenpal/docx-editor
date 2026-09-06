// Word's paragraph-level pagination controls: widow/orphan, keep-with-next, keep-lines.
//
// These decide WHERE a paragraph is allowed to cross a page boundary, not how it measures.
// `semantic-layout.ts` owns the flow cursor and calls in here for the decision, so the rule
// itself stays a pure function of line counts and can be reasoned about (and tested) without
// a page, a measurer or a DOM.
//
// All three are style-inheritable, so they are read from the CASCADED paragraph property bag
// (`docDefaults` → `basedOn` chain → style → direct), the same bag `w:pageBreakBefore` and
// `w:spacing` are read from. Reading direct `w:pPr` alone would miss every heading that gets
// its `w:keepNext` from the `Heading 1` style — which is all of them.
//
// Everything here fails OPEN. A keep rule that cannot be honoured places the content anyway,
// because Word does the same: a paragraph taller than a page still prints, and a keep chain
// that cannot fit is abandoned rather than looped over.
//
// TABLES — these apply to the BODY flow only, never to paragraphs inside a cell. Row
// pagination is the authority there: `w:cantSplit` (§17.4.6) decides whether a row may be cut,
// and a row moves or splits as ONE unit across all its cells. A cell paragraph asking to keep
// with the next cannot be honoured without moving the whole row, which is a decision
// `w:cantSplit` already owns, and honouring it per cell would tear a row's columns apart at
// different heights. A `w:keepNext` chain that reaches a table therefore stops there
// (unpriceable → the keep is abandoned), which is also what Word does with a heading kept with
// a table it cannot fit beside.

import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import { framedTokenJoin } from './layout-cache.ts';

/**
 * How many blocks one `w:keepNext` chain may bind together before layout gives up.
 *
 * Word abandons a chain it cannot place rather than searching forever, and the chain length
 * is file-derived: a document can declare `w:keepNext` on every paragraph it contains. This
 * bounds both the lookahead work and the string a chain contributes to the flow key.
 */
export const MAX_KEEP_NEXT_CHAIN = 8;

/** Minimum lines Word leaves on each side of a page break under widow/orphan control. */
const MIN_LINES_EITHER_SIDE = 2;

/**
 * A paragraph's resolved pagination keeps.
 *
 * `widowControl` is the one that matters for every document: ECMA-376 §17.3.1.44 says that
 * when the setting is never specified anywhere in the style hierarchy it is ON, and Word's
 * own UI ships it checked. A renderer that treats absence as "off" strands a single line at
 * the top or bottom of a page on documents that never mention the property at all.
 */
export interface ParagraphKeeps {
  /** `w:keepNext` (§17.3.1.15) — stay on the page the FOLLOWING paragraph starts on. */
  readonly keepNext: boolean;
  /** `w:keepLines` (§17.3.1.16) — every line of this paragraph on ONE page. */
  readonly keepLines: boolean;
  /** `w:widowControl` (§17.3.1.44) — never one line alone either side of a page break. */
  readonly widowControl: boolean;
}

/** What a paragraph that states none of the three gets: widow/orphan control ON. */
export const DEFAULT_PARAGRAPH_KEEPS: ParagraphKeeps = Object.freeze({
  keepNext: false,
  keepLines: false,
  widowControl: true,
});

/**
 * `w:val` of an `CT_OnOff` toggle. Absent attribute means true (the element's presence IS
 * the assertion); `0`/`false`/`off` is the explicit negation Word writes when a style turns
 * an inherited toggle back off.
 */
function onOff(attributes: Readonly<Record<string, string>> | undefined): boolean {
  const raw = attributes?.val;
  return raw !== '0' && raw !== 'false' && raw !== 'off';
}

/**
 * Resolve the three keeps from cascaded paragraph properties.
 *
 * Last statement wins, which is how the cascade is ordered (`docDefaults` first, direct
 * `w:pPr` last). An explicit `<w:widowControl w:val="0"/>` in a style therefore turns off
 * what `w:docDefaults` asserted, and a direct `<w:widowControl/>` turns it back on.
 */
export function paragraphKeeps(props: readonly OoxmlProperty[]): ParagraphKeeps {
  let keepNext = false;
  let keepLines = false;
  let widowControl = true;
  for (const property of props) {
    switch (property.localName) {
      case 'keepNext':
        keepNext = onOff(property.attributes);
        break;
      case 'keepLines':
        keepLines = onOff(property.attributes);
        break;
      case 'widowControl':
        widowControl = onOff(property.attributes);
        break;
      default:
        break;
    }
  }
  if (!keepNext && !keepLines && widowControl) return DEFAULT_PARAGRAPH_KEEPS;
  return { keepNext, keepLines, widowControl };
}

/**
 * Pull a page break back so it satisfies `w:keepLines` and `w:widowControl`.
 *
 * Returns the line index the break must happen at, never earlier than `fragmentStart` (the
 * first line of the paragraph on the page being cut) and never later than `lineIndex` (the
 * natural break: the first line that does not fit). The caller un-places the lines between
 * the two and re-flows them onto the next page.
 *
 * `w:keepLines` (§17.3.1.16) is all-or-nothing: the break retreats to the start of what this
 * page holds of the paragraph, so the whole thing moves. `w:widowControl` (§17.3.1.44) is
 * arithmetic on the two sides of the cut — at least two lines must remain on the page and at
 * least two must go over, so a break that would strand one line retreats by one line, and a
 * retreat that then strands one line at the bottom retreats again to move the lot.
 *
 * Order matters: the widow test runs first because fixing it can CREATE an orphan (a 3-line
 * paragraph with room for 2 moves entirely, which is what Word does), and the orphan test
 * then finishes the job.
 *
 * `aloneOnPage` — the lines from `fragmentStart` are all this page holds — is the fail-open
 * switch. Moving them again lands them on an identical empty page, so the rule would fire
 * forever; Word prints the near miss instead, and so does this.
 */
export function adjustedBreakIndex(
  lineIndex: number,
  fragmentStart: number,
  lineCount: number,
  keeps: ParagraphKeeps,
  aloneOnPage: boolean
): number {
  if (lineIndex <= fragmentStart) return lineIndex;

  // keepLines: move everything this page holds of the paragraph. Skipped when it holds
  // nothing else, because the paragraph is simply taller than a page.
  if (keeps.keepLines && !aloneOnPage) return fragmentStart;

  if (!keeps.widowControl || lineCount < MIN_LINES_EITHER_SIDE) return lineIndex;

  let breakAt = lineIndex;
  // Widow: one line of the paragraph would open the next page alone.
  if (lineCount - breakAt < MIN_LINES_EITHER_SIDE) breakAt -= 1;
  // Orphan: one line of the paragraph would close this page alone.
  if (breakAt - fragmentStart === 1) breakAt -= 1;
  if (breakAt < fragmentStart) breakAt = fragmentStart;

  // Retreating to the fragment start on a page the paragraph already owns makes no progress.
  if (breakAt === fragmentStart && aloneOnPage) return lineIndex;
  return breakAt;
}

/**
 * The slice of a laid-out block {@link keepNextGroupHeight} reads.
 *
 * `spacing`/`keeps` are optional because a story's block list also holds tables, which carry
 * neither — and a table is a chain terminator this cannot price, so it reads as a stop.
 */
export interface KeepNextBlock {
  readonly kind: string;
  readonly spacing?: { readonly before: number; readonly after: number };
  readonly keeps?: ParagraphKeeps;
}

/**
 * Flow height a `w:keepNext` chain starting at `start` needs to hold together (§17.3.1.15).
 *
 * The chain is every consecutive block that declares `w:keepNext`, plus the block the last of
 * them is kept WITH — of which only the opening line has to share the page, since that is all
 * Word requires to consider a heading attached to its body. Where widow control is on that
 * block, two lines are required instead: one would be pulled over anyway and the heading
 * would be stranded a moment later.
 *
 * Returns null for anything the lookahead cannot price — a table in the chain, a chain that
 * runs past {@link MAX_KEEP_NEXT_CHAIN} — and null means the caller places on ordinary fit
 * rules. Word abandons a keep it cannot honour rather than searching, and so does this: the
 * content is placed, just not moved. `lineHeights` is asked for lazily, one block at a time,
 * so a chain that stops early never measures the blocks past its end.
 *
 * Paragraph borders are deliberately NOT priced in. Under-estimating degrades to the
 * behaviour without the rule (the keep does not fire); over-estimating would move content to
 * a page it never needed to be on, which is a visible fidelity regression.
 */
export function keepNextGroupHeight(
  blocks: readonly KeepNextBlock[],
  start: number,
  carry: number,
  lineHeights: (index: number) => readonly number[]
): number | null {
  let total = 0;
  let after = carry;
  for (let index = start; index - start < MAX_KEEP_NEXT_CHAIN; index += 1) {
    const block = blocks[index];
    if (!block || block.kind !== 'paragraph' || !block.spacing || !block.keeps) return null;
    // Adjacent before/after collapse to the larger gap rather than summing (Word).
    total += Math.max(block.spacing.before, after) - after;
    const heights = lineHeights(index);
    // The story's LAST block keeps with nothing, so it terminates the chain however authored.
    if (!block.keeps.keepNext || index + 1 >= blocks.length) {
      total += heights[0] ?? 0;
      if (block.keeps.widowControl && heights.length > 1) total += heights[1]!;
      return total;
    }
    for (const height of heights) total += height;
    total += block.spacing.after;
    after = block.spacing.after;
  }
  return null;
}

/**
 * Rewrite layout cache keys into FLOW keys, which is what incremental resume compares.
 *
 * `w:keepNext` makes a paragraph's PLACEMENT depend on the block after it, so its own key no
 * longer describes where it lands. Editing the body text under a heading would otherwise put
 * the first changed block at the body, and a resume starting there would keep a decision the
 * heading took against the old body. Folding the successor's flow key in moves the first
 * changed block back to the head of the chain — the first block whose placement can move.
 *
 * Bounded by {@link MAX_KEEP_NEXT_CHAIN}, so a document declaring `w:keepNext` on every
 * paragraph cannot grow a key linear in its own length. Returns the input array unchanged
 * when nothing keeps, which is the overwhelming majority of passes.
 */
/**
 * Flow keys that also carry each block's LIST MARKER text.
 *
 * The marker is derived from `numbering.xml` and the counter state, not from the paragraph, so
 * a `w:start`, `w:startOverride` or restart change renumbers a list while every paragraph
 * subtree stays byte-identical. The break-cache key holds the marker's LENGTH on purpose —
 * only the length can move a line break — so on its own it let `1.` become `2.` with no key
 * moving anywhere, and the unchanged-document exit then returned the previous pages whole.
 *
 * Separate from the break key for that same reason: renumbering must re-place the blocks
 * without discarding measurements that are still correct.
 */
export function listMarkerFlowKeys(
  keys: string[],
  markerAt: (index: number) => string | undefined
): string[] {
  let flow = keys;
  for (let index = 0; index < keys.length; index += 1) {
    const marker = markerAt(index);
    if (marker === undefined) continue;
    if (flow === keys) flow = [...keys];
    flow[index] = `${flow[index]}~mk~${marker}`;
  }
  return flow;
}

/**
 * Flow keys that also carry each block's `w:contextualSpacing` VERDICT.
 *
 * `w:contextualSpacing` (§17.3.1.9) drops a paragraph's space before or after when the
 * neighbour on that side is a paragraph of the SAME style, so the block's own height is a
 * function of two blocks it does not contain. Its content key cannot see that: inserting a
 * list item under the last one has to change the last one's space-after from 8pt to zero,
 * and with the key unmoved the incremental pass resumed past it and kept the stale height —
 * a list whose items closed up on open, and stopped closing up as soon as it was edited.
 *
 * The same cross-block fold as {@link keepNextFlowKeys}, and folded for the same reason.
 * Only the two booleans go in the key, not the neighbours' style ids: what the verdict
 * depends on is whether each side matches, so a rename that moves both sides together must
 * not re-place a block whose spacing is identical.
 *
 * `styleAt` answers null for a block that can never match — a table, or a paragraph with no
 * style — which is what makes an unstyled run of paragraphs keep its spacing.
 */
export function contextualSpacingFlowKeys(
  keys: string[],
  contextualAt: (index: number) => boolean,
  styleAt: (index: number) => string | null
): string[] {
  let flow = keys;
  for (let index = 0; index < keys.length; index += 1) {
    if (!contextualAt(index)) continue;
    const style = styleAt(index);
    if (style === null) continue;
    const before = index > 0 && styleAt(index - 1) === style;
    const after = index + 1 < keys.length && styleAt(index + 1) === style;
    if (flow === keys) flow = [...keys];
    flow[index] = `${flow[index]}~cs~${before ? 1 : 0}${after ? 1 : 0}`;
  }
  return flow;
}

/**
 * Flow keys that also carry each block's PARAGRAPH BORDER GROUP membership.
 *
 * Consecutive paragraphs with identical border settings are ONE bordered block in Word
 * (`w:between`, §17.3.1.24): the box opens above the first and closes below the last, and
 * every interior boundary carries the `between` rule instead of a top and a bottom. So a
 * paragraph's own bottom edge — which rule is drawn, how much vertical extent it claims, and
 * whether it publishes a `bottomBorder` record at all — is a function of the block AFTER it.
 *
 * Nothing about that reaches the block's content key, so the incremental pass resumed past a
 * paragraph that had just stopped being the last of its group and kept the closing edge it no
 * longer owned. The extent is real height, so the error compounds down the flow: a
 * three-paragraph group edited on its last member laid out over three pages where the same
 * bytes reopened took two.
 *
 * Both bits go in, not only the forward one. Incremental RESUME is a prefix cut, where a
 * backward dependency is safe because the earlier block moving re-places everything after it.
 * The convergence tail is a SUFFIX cut, where backward is the exposed direction: a block can
 * sit inside the common suffix while the paragraph above it joins or leaves its group.
 *
 * No repro is known for that, and the reason is worth writing down: the tail's guard compares
 * fragment SIGNATURES, and `semantic-fragment-signature.ts` hashes every `w:pBdr` stroke, so
 * even a height-neutral group change (a different `w:color` on the same `w:sz`) moves the
 * signature of the paragraph that changed. `above` is folded anyway. That guard only sees a
 * changed paragraph still pending on the page being built, it is not the guard that owns this
 * question, and the bit is free — one string comparison the fold already has in hand.
 *
 * `groupKeyAt` answers `''` for a block that can never group: a table, or a paragraph with no
 * borders at all. Two paragraphs group only when their keys are EQUAL, which is what makes an
 * indent change split a group — the key carries the box geometry as well as the rules.
 */
export function borderGroupFlowKeys(
  keys: string[],
  groupKeyAt: (index: number) => string
): string[] {
  let flow = keys;
  for (let index = 0; index < keys.length; index += 1) {
    const group = groupKeyAt(index);
    if (group === '') continue;
    const above = index > 0 && groupKeyAt(index - 1) === group;
    const below = index + 1 < keys.length && groupKeyAt(index + 1) === group;
    if (flow === keys) flow = [...keys];
    flow[index] = `${flow[index]}~bg~${above ? 1 : 0}${below ? 1 : 0}`;
  }
  return flow;
}

/**
 * Flow keys that also carry each block's TOC FIELD verdict.
 *
 * A TOC is a complex field spanning paragraphs: a begin paragraph holding `fldChar begin` and
 * the `TOC` instruction, cached result paragraphs, an end paragraph. Layout answers three
 * questions per paragraph from that shape — suppress the field chrome, keep one placeholder
 * line on the begin paragraph because the TOC resolved to nothing, suppress a blank cached
 * result row — and each answer is read from the OTHER paragraphs of the same field.
 *
 * The begin paragraph is the sharp case: whether it keeps a placeholder line depends on
 * whether any RESULT paragraph after it still carries visible text. Refreshing a TOC that
 * comes back empty rewrites the result paragraphs and leaves the begin paragraph untouched,
 * so resume started at the first result and reused a begin paragraph that had just gone from
 * "emits nothing" to "emits a placeholder line" — the line simply vanished for the life of
 * the session, and reopening the same bytes brought it back.
 *
 * The three raw membership bits go in rather than the two booleans layout derives from them,
 * so the fold stays correct whatever the derivation grows into. `verdictAt` answers `''` for
 * a block no TOC touches, which is every block of a document that has no TOC.
 */
export function tocFieldFlowKeys(keys: string[], verdictAt: (index: number) => string): string[] {
  let flow = keys;
  for (let index = 0; index < keys.length; index += 1) {
    const verdict = verdictAt(index);
    if (verdict === '') continue;
    if (flow === keys) flow = [...keys];
    flow[index] = `${flow[index]}~toc~${verdict}`;
  }
  return flow;
}

/**
 * Flow keys that carry a `w:keepNext` chain's SUCCESSOR KEY.
 *
 * RUN THIS FOLD LAST. It is the only one that splices a neighbour's whole key into a
 * block's own, so every other fold has to have finished: run it first and a chain head
 * carries its members' pre-fold keys, and a head that never re-places when a member's
 * marker text or contextual verdict moves is a stale keep-next group.
 */
export function keepNextFlowKeys(keys: string[], keepsNext: (index: number) => boolean): string[] {
  let flow = keys;
  let chain = 0;
  for (let index = keys.length - 2; index >= 0; index -= 1) {
    if (keepsNext(index) && chain < MAX_KEEP_NEXT_CHAIN) {
      if (flow === keys) flow = [...keys];
      flow[index] = `${keys[index]}~kn~${flow[index + 1]}`;
      chain += 1;
    } else {
      chain = 0;
    }
  }
  return flow;
}

/** The per-block answers {@link composeFlowKeys} folds over the break-cache keys. */
export interface FlowKeyFoldInputs {
  /** Shared token forces resume before every member of a terminal floating-table group. */
  readonly terminalTableGroup?: {
    readonly start: number;
    readonly anchorIndex: number;
    readonly token: string;
  };
  readonly contextualSpacingAt: (index: number) => boolean;
  /** `null` for a block that can never match a neighbour — a table, or an unstyled paragraph. */
  readonly styleIdAt: (index: number) => string | null;
  /** `''` for a block outside every border group. */
  readonly borderGroupKeyAt: (index: number) => string;
  /** Empty when the part has no TOC; the fold is then skipped outright. */
  readonly tocVerdicts: readonly string[];
  readonly markerTextAt: (index: number) => string | undefined;
  readonly keepsNextAt: (index: number) => boolean;
}

/**
 * The one composition of the flow-key folds — what incremental resume compares.
 *
 * `keys` stays what the break cache is stored under; the CROSS-BLOCK properties make the
 * two differ: `w:contextualSpacing` (§17.3.1.9), paragraph border groups (§17.3.1.24), the
 * TOC field verdicts, the list marker, and `w:keepNext` (§17.3.1.15) — each of which makes
 * a block's placement depend on a block it does not contain.
 *
 * Each fold returns its input BY IDENTITY when nothing folds, so a document that reads
 * across no boundary at all reaches the end holding the array it started with.
 *
 * `keepNextFlowKeys` runs LAST, and the order is load-bearing. It is the only fold that
 * splices a NEIGHBOUR'S WHOLE KEY into a block's own, so whatever it reads has to be
 * finished: run it first and a chain head carries its members' pre-fold keys, which is a
 * head that never re-places when a member's marker, contextual or border verdict moves.
 * That is latent rather than live today only because `keepNextGroupHeight` prices AUTHORED
 * spacing; folding last makes the composition correct whatever that lookahead grows into.
 * The composition lives HERE, next to the folds, so the order is testable — see
 * `pagination-keeps.test.ts`.
 */
export function composeFlowKeys(keys: string[], at: FlowKeyFoldInputs): string[] {
  const group = at.terminalTableGroup;
  const grouped = group
    ? keys.map((key, index) =>
        index >= group.start && index <= group.anchorIndex
          ? framedTokenJoin([key, group.token])
          : key
      )
    : keys;
  let flow = contextualSpacingFlowKeys(grouped, at.contextualSpacingAt, at.styleIdAt);
  flow = borderGroupFlowKeys(flow, at.borderGroupKeyAt);
  if (at.tocVerdicts.length > 0) flow = tocFieldFlowKeys(flow, (index) => at.tocVerdicts[index]!);
  flow = listMarkerFlowKeys(flow, at.markerTextAt);
  flow = keepNextFlowKeys(flow, at.keepsNextAt); // LAST — see the doc comment above.
  return flow;
}
