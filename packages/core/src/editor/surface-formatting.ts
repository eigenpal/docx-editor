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
      case 'strike':
        return span.style.strike;
      default:
        // Every toggleable mark MUST be listed: answering false for one that is
        // active makes its toggle re-apply forever instead of clearing.
        return false;
    }
  };
  return spans.every(flagOf);
}

/**
 * The run defaults a paragraph's content inherits, injected by the surface (a session
 * derivation over the styles and theme parts — this module never reads those trees).
 */
export type InheritedRunDefaults = (
  paragraphId: string,
  runProperties: readonly SurfaceProperty[]
) => { readonly fontFamily: string | null; readonly fontSizeHalfPoints: number | null };

/** The formatting snapshot at a selection, for a toolbar to reflect. */
export function formattingAt(
  layout: SemanticLayout,
  selection: SemanticSelection,
  inherited?: InheritedRunDefaults
): SurfaceFormatting {
  const spans = spansInSelection(layout, selection);
  const styles = spans.map((span) => span.style);
  // Agreement across the WHOLE selection, or nothing. A collapsed caret yields the one
  // span beside it (Word's rule), so the toolbar reflects the run the user is typing in.
  const agreed = <T>(pick: (style: (typeof styles)[number]) => T): T | null => {
    if (styles.length === 0) return null;
    const first = pick(styles[0]!);
    return styles.every((style) => pick(style) === first) ? first : null;
  };
  const agreedOver = <T>(values: readonly T[]): T | null =>
    values.length > 0 && values.every((value) => value === values[0]) ? values[0]! : null;

  // Font family and size answer the EFFECTIVE value, the way Word's boxes do: a span
  // without a direct `w:rFonts`/`w:sz` falls back to what it inherits (style chain,
  // docDefaults, theme fonts). A caret in an empty paragraph inherits too.
  const hasDirect = (span: (typeof spans)[number], localName: string): boolean =>
    span.props.some((property) => property.localName === localName);
  const familyOf = (span: (typeof spans)[number]): string | null =>
    span.style.fontFamily ?? inherited?.(span.range.paragraphId, span.props).fontFamily ?? null;
  const sizeOf = (span: (typeof spans)[number]): number =>
    hasDirect(span, 'sz')
      ? Math.round(span.style.fontSizePt * 2)
      : (inherited?.(span.range.paragraphId, span.props).fontSizeHalfPoints ??
        Math.round(span.style.fontSizePt * 2));
  const caretInherited =
    spans.length === 0 ? inherited?.(selection.head.paragraphId, []) : undefined;

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
    fontFamily:
      spans.length > 0 ? agreedOver(spans.map(familyOf)) : (caretInherited?.fontFamily ?? null),
    fontSizeHalfPoints:
      spans.length > 0
        ? agreedOver(spans.map(sizeOf))
        : (caretInherited?.fontSizeHalfPoints ?? null),
    color: agreed((entry) => entry.color),
    highlight: agreed((entry) => entry.highlight),
    alignment:
      jc === 'center' || jc === 'right' || jc === 'both' ? jc : jc === 'end' ? 'right' : 'left',
    styleId: style ?? null,
  } satisfies SurfaceFormatting;
}

/**
 * The paragraph-mark edit that keeps a whole-paragraph format change honest.
 *
 * Word writes the same run properties onto the paragraph MARK (`w:pPr/w:rPr`) whenever
 * formatting is applied to an entire paragraph. That mark is what a list marker inherits
 * its face from, so without it, sizing a bulleted paragraph left the bullet at the old
 * size beside text that had grown.
 *
 * Returns nothing when the range does not cover the whole paragraph — formatting part of a
 * paragraph must not restyle its pilcrow, and therefore must not move its marker.
 */
export function paragraphMarkOps(
  paragraphText: string,
  from: { readonly paragraphId: string; readonly offset: number },
  to: { readonly paragraphId: string; readonly offset: number },
  properties: readonly SurfaceProperty[]
): readonly {
  readonly op: 'setParagraphMarkProperties';
  readonly paragraphId: string;
  readonly properties: readonly SurfaceProperty[];
}[] {
  if (from.paragraphId !== to.paragraphId) return [];
  if (from.offset !== 0 || to.offset !== paragraphText.length) return [];
  if (paragraphText.length === 0) return [];
  return [{ op: 'setParagraphMarkProperties', paragraphId: from.paragraphId, properties }];
}
