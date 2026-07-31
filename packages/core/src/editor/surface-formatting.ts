// Formatting queries over the published layout (paginated-surface seam).
//
// This module owns what a toolbar reads and what a formatting command merges against:
// the agreement-based formatting snapshot, run/paragraph property lookups indexed per
// layout, and the merge rule for property containers. Everything is a pure function of
// (layout, selection) — the surface closure supplies its current values.

import {
  paragraphFragmentsOf,
  spansInSelection,
  type SemanticLayout,
  type SemanticSelection,
} from '@docx-editor.dev/core-contract/layout';
import type { SurfaceFormatting } from './paginated-surface-contract.ts';

/** One property as the ops and the layout records carry it: an element name plus attributes. */
export interface SurfaceProperty {
  readonly localName: string;
  readonly attributes?: Record<string, string>;
}

/**
 * Paragraph properties by paragraph id, one map per published layout.
 *
 * Weakly keyed on the layout because a layout is immutable: a new revision is a new
 * object, and superseded revisions release their index with the records.
 */
const fragmentPropsByLayout = new WeakMap<
  SemanticLayout,
  Map<string, readonly SurfaceProperty[]>
>();

/** A paragraph's own properties, read back from the layout records. */
export function paragraphPropertiesOf(
  layout: SemanticLayout,
  paragraphId: string
): readonly SurfaceProperty[] {
  // Indexed per layout: the host reads formatting after every commit, and scanning all
  // pages for one paragraph's `w:pPr` projection made that read O(document).
  let index = fragmentPropsByLayout.get(layout);
  if (!index) {
    index = new Map();
    for (const page of layout.pages) {
      for (const fragment of paragraphFragmentsOf(page)) {
        if (!index.has(fragment.paragraphId)) index.set(fragment.paragraphId, fragment.props);
      }
    }
    fragmentPropsByLayout.set(layout, index);
  }
  return index.get(paragraphId) ?? [];
}

/**
 * Merge one property into a set, replacing any entry with the same name.
 *
 * `setRunProperties` and `setParagraphProperties` REPLACE the whole container, so sending
 * one property alone deleted every other: pressing Bold stripped a run's font, size and
 * colour, and pressing Centre stripped a paragraph's style, numbering and indents.
 */
export function mergedProperties(
  existing: readonly SurfaceProperty[],
  incoming: SurfaceProperty
): SurfaceProperty[] {
  const kept = existing.filter((entry) => entry.localName !== incoming.localName);
  return [...kept, incoming];
}

/** The run properties in force across the selection, taken from its first span. */
export function selectionRunProperties(
  layout: SemanticLayout,
  selection: SemanticSelection
): readonly SurfaceProperty[] {
  const spans = spansInSelection(layout, selection);
  return spans[0]?.props ?? [];
}

/**
 * Whether a run property is already set across the WHOLE selection.
 *
 * Word's rule, and the one that makes a toggle feel right: a partly-bold selection goes
 * fully bold on the first press rather than clearing the bold that is there.
 */
export function isRunPropertyActive(
  layout: SemanticLayout,
  selection: SemanticSelection,
  localName: string
): boolean {
  const spans = spansInSelection(layout, selection);
  if (spans.length === 0) return false;
  const flagOf = (span: (typeof spans)[number]): boolean => {
    switch (localName) {
      case 'b':
        return span.style.bold;
      case 'i':
        return span.style.italic;
      case 'u':
        return span.style.underline !== null;
      default:
        return false;
    }
  };
  return spans.every(flagOf);
}

/** The formatting snapshot at a selection, for a toolbar to reflect. */
export function formattingAt(
  layout: SemanticLayout,
  selection: SemanticSelection
): SurfaceFormatting {
  const spans = spansInSelection(layout, selection);
  const styles = spans.map((span) => span.style);
  // Agreement across the WHOLE selection, or nothing. `every` over an empty list is
  // true, so an empty selection reports the caret paragraph's alignment and no run
  // properties — which is what a toolbar should show with nothing selected.
  const agreed = <T>(pick: (style: (typeof styles)[number]) => T): T | null => {
    if (styles.length === 0) return null;
    const first = pick(styles[0]!);
    return styles.every((style) => pick(style) === first) ? first : null;
  };
  const properties = paragraphPropertiesOf(layout, selection.head.paragraphId);
  const jc = properties.find((property) => property.localName === 'jc')?.attributes?.val;
  const style = properties.find((property) => property.localName === 'pStyle')?.attributes?.val;
  return {
    bold: styles.length > 0 && styles.every((entry) => entry.bold),
    italic: styles.length > 0 && styles.every((entry) => entry.italic),
    underline: styles.length > 0 && styles.every((entry) => entry.underline !== null),
    strikethrough: styles.length > 0 && styles.every((entry) => entry.strike),
    superscript: styles.length > 0 && styles.every((e) => e.verticalAlign === 'superscript'),
    subscript: styles.length > 0 && styles.every((e) => e.verticalAlign === 'subscript'),
    fontFamily: agreed((entry) => entry.fontFamily),
    fontSizeHalfPoints: (() => {
      const points = agreed((entry) => entry.fontSizePt);
      return points === null ? null : Math.round(points * 2);
    })(),
    color: agreed((entry) => entry.color),
    highlight: agreed((entry) => entry.highlight),
    alignment:
      jc === 'center' || jc === 'right' || jc === 'both' ? jc : jc === 'end' ? 'right' : 'left',
    styleId: style ?? null,
  } satisfies SurfaceFormatting;
}
