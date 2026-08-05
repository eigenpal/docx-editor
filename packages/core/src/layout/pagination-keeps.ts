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
