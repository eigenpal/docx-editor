// WHICH RUNS A FORMATTING LANE MAY REACH — one walk, for every lane that formats.
//
// Two lanes plan formatting edits: the store lane (`direct-properties.ts`, which the
// automation object model writes through) and the surface lane (`surface-formatting.ts`,
// which the toolbar writes through). They must reach the SAME runs for the same range, or a
// press applies through one and plans zero edits through the other — silently, because an op
// list that is empty is not an error anywhere.
//
// They drifted per container kind twice. `w:fldSimple`: the store descended and the surface
// did not, so automation formatted a simple field's result while the toolbar did nothing to
// the same selection. Inline `w:sdt`: the surface descended and the store did not, so
// automation `setFont` inside a form field planned no run edits at all. This module is the
// one answer, and both lanes call it.
//
// THE CONTAINERS ARE THE ONES `segmentsOf` DESCENDS. That is not a coincidence and not a
// choice: `segmentsOf` assigns the UTF-16 offsets an op addresses, so a container it walks
// into holds addressable runs and a container it treats as opaque does not. Descending
// somewhere it does not would format runs the offsets do not name; stopping short of one it
// does leaves an addressable run unreachable. `w:fldSimple` is the one container whose inner
// runs are addressed indirectly — the field is one atom, and its result runs carry that
// atom's formatting through `formatRunIds` — so it is descended for FORMATTING while staying
// one unit for text edits.
//
// The revision wrappers are gated by what the reader can SEE (see
// {@link FormattingDisplayMode}). Everything else is unconditional.

import { contentControlContentOf, isContentControlNode } from './tree-op-nodes.ts';
import { isFldSimple } from '../package/field-nodes.ts';
import { isContentRevisionKind } from '../package/ooxml-shared.ts';
import type { OoxmlNode, OoxmlParagraphNode } from '../package/ooxml-tree.ts';

/**
 * Which revision halves the reader is looking at.
 *
 * Structurally identical to layout's `RevisionDisplayMode`, and pinned equal to it by
 * `packages/core/src/layout/__tests__/revision-display-mode-parity.test.ts`. Redeclared
 * rather than imported because the `store` lane may import no other lane (see
 * `packages/core/src/__tests__/core-lane-graph.ts`), and the formatting walks live here so
 * that the automation lane — which has no layout at all — reaches them.
 */
export type FormattingDisplayMode = 'all-markup' | 'proposed' | 'original';

/**
 * What the formatting lanes assume when nobody names a view.
 *
 * The RESOLVED result — Word's "No Markup" — because a caller with no view is a caller with
 * no reader: a headless automation host answers for the text that survives. It is not what a
 * mounted surface uses; that one names its own mode, and with the review module registered
 * the layout default is `all-markup`.
 */
export const DEFAULT_FORMATTING_DISPLAY_MODE: FormattingDisplayMode = 'proposed';

/**
 * Whether a formatting lane may reach the runs inside this revision wrapper.
 *
 * A FORMATTING WRITE MAY ONLY TOUCH TEXT THE READER CAN SEE. The store offsets cover every
 * revision half whatever the view does with them, so a selection across visible text sweeps
 * hidden halves at the same offsets: in the default `proposed` view a tracked deletion paints
 * nothing yet still owns its characters, and a Bold press over the visible words restyled
 * text nobody could see — text that reappears, differently formatted, the moment somebody
 * rejects the deletion.
 *
 * So the rule is the view's own: `proposed` shows what the document becomes and hides the
 * deletion halves, `original` shows what it was and hides the insertion halves, `all-markup`
 * shows both and reaches both.
 *
 * A MOVE PAIR IS NOT MIRRORED. `w:moveFrom` and `w:moveTo` hold the same words at different
 * offsets, and a write reaches only the half the view renders. That is the correct answer
 * rather than a gap: the decision on the move keeps exactly one half — accept keeps
 * `w:moveTo` with whatever formatting it was given, reject restores `w:moveFrom` as it was —
 * so copying the format onto the twin would put it on text that only ever appears when the
 * user asked for the original back.
 */
export function revisionReachedInMode(
  kind: OoxmlNode['kind'],
  displayMode: FormattingDisplayMode
): boolean {
  switch (kind) {
    case 'revisionInsert':
    case 'revisionMoveTo':
      return displayMode !== 'original';
    case 'revisionDelete':
    case 'revisionMoveFrom':
      return displayMode !== 'proposed';
    default:
      return false;
  }
}

/** Matches the cap `segmentsOf` applies to the same containers; see `MAX_INLINE_CONTAINER_DEPTH`. */
const MAX_FORMATTABLE_RUN_DEPTH = 32;

/**
 * Every `w:r` in a paragraph a formatting read or write may address, in document order.
 *
 * Callers pair each run with the range `runAddressRanges` gives it and clip that against the
 * range being formatted; this answers only WHICH runs exist for the lane, never which of them
 * a particular range covers.
 */
export function formattableRunsOfParagraph(
  paragraph: OoxmlParagraphNode,
  displayMode: FormattingDisplayMode = DEFAULT_FORMATTING_DISPLAY_MODE
): readonly OoxmlNode[] {
  const runs: OoxmlNode[] = [];
  collectFormattableRuns(paragraph.children, displayMode, 0, runs);
  return runs;
}

function collectFormattableRuns(
  children: readonly OoxmlNode[],
  displayMode: FormattingDisplayMode,
  depth: number,
  out: OoxmlNode[]
): void {
  // File-controlled nesting costs an attacker nothing, so the bound is on the walk rather
  // than on the document. Past it the content stays in the tree and simply stops being
  // formattable — the fail-closed direction.
  if (depth >= MAX_FORMATTABLE_RUN_DEPTH) return;
  for (const child of children) {
    if (child.kind === 'textValue' || child.kind === 'paragraphProperties') continue;
    if (child.kind === 'run') {
      out.push(child);
      continue;
    }
    // A revision wrapper and a link are both run containers, and either can hold the other:
    // a link inside a tracked insertion is ordinary. Stopping at the wrapper made every
    // property write over tracked text plan zero edits (#493).
    if (child.kind === 'hyperlink') {
      collectFormattableRuns(child.children, displayMode, depth + 1, out);
      continue;
    }
    if (isContentRevisionKind(child.kind)) {
      if (!revisionReachedInMode(child.kind, displayMode)) continue;
      collectFormattableRuns(child.children, displayMode, depth + 1, out);
      continue;
    }
    // `w:fldSimple` is ONE atom in the offset space and SEVERAL runs in the formatting one:
    // its result runs own the displayed face (`formatRunIds`), so `runAddressRanges` gives
    // them the atom's range and a write over the field reaches each of them with its own
    // merged bag.
    if (isFldSimple(child)) {
      collectFormattableRuns(child.children, displayMode, depth + 1, out);
      continue;
    }
    // An inline content control flattens into the paragraph's run stream exactly as it does
    // for `segmentsOf`, so text inside a form field is ordinary formattable text.
    if (isContentControlNode(child)) {
      const content = contentControlContentOf(child);
      if (content) collectFormattableRuns(content.children, displayMode, depth + 1, out);
      continue;
    }
  }
}
