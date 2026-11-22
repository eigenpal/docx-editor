// Per-fitter cluster measurement cache for demand-only East Asian line fitting.
import type { StyleSpanRecord } from './semantic-records.ts';

/**
 * One fitter's cluster measurements by span style and font slot. Every attempt re-reads the
 * whole line with fresh span records, so ink and widths would otherwise be measured again.
 * Sound because a resolved run style is never mutated: a changed style is a new object, and
 * measurement reads only the style, the slot, the text, and the fitter's one measurer.
 */
type MemoKind = 'prefixEnds' | 'natural' | 'ink' | 'authored';
export type ClusterMemo = Map<
  StyleSpanRecord['style'],
  Map<StyleSpanRecord['fontSlot'], Map<MemoKind, Map<string, unknown>>>
>;
/** The measurement of `kind` for `text` in the span's style and slot, measured once. */
export function memoized<T>(
  memo: ClusterMemo,
  span: StyleSpanRecord,
  kind: MemoKind,
  text: string,
  measure: () => T
): T {
  let bySlot = memo.get(span.style);
  if (!bySlot) memo.set(span.style, (bySlot = new Map()));
  let byKind = bySlot.get(span.fontSlot);
  if (!byKind) bySlot.set(span.fontSlot, (byKind = new Map()));
  let byText = byKind.get(kind);
  if (!byText) byKind.set(kind, (byText = new Map()));
  const cached = byText.get(text);
  if (cached !== undefined || byText.has(text)) return cached as T;
  const value = measure();
  byText.set(text, value);
  return value;
}
