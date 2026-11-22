// The number a field number switch reads from a list paragraph (REF and STYLEREF).
import { composeFullContextNumber } from './list-counters.ts';
import { listItemNumberSource, type ResolvedListItem } from './list-resolve.ts';

/** Word trims one trailing period off a referenced number: `1.` → `1`, `1.2` stays `1.2`. */
export function trimTrailingPeriod(marker: string): string {
  return marker.length > 1 && marker.endsWith('.') ? marker.slice(0, -1) : marker;
}

/**
 * A list paragraph's number as a field number switch reads it, without one trailing period.
 *
 * `ownLevelOnly` is the `\n` switch: the paragraph's own level only, per Word's cached values
 * for that switch. Otherwise it is the full context that REF reads for `\r` and `\w`: a deep
 * level's marker states only its own placeholder, and painting bare `(c)` for a `1.2(c)`
 * paragraph is worse than a stale cache. Items built outside `resolveStoryListItems` carry no counter source; their marker is
 * the bounded fallback, except under `\t`. That filter runs on the level templates and cannot
 * strip an already-expanded marker. A bullet has a marker but no number a reader can cite.
 * Null means the caller keeps its cached result.
 */
export function listItemReferenceNumber(
  item: ResolvedListItem,
  ownLevelOnly: boolean,
  suppressNonDelimiterText = false
): string | null {
  const source = listItemNumberSource(item);
  const composed =
    source !== undefined
      ? composeFullContextNumber(source, ownLevelOnly, suppressNonDelimiterText)
      : null;
  const fallback =
    !suppressNonDelimiterText &&
    item.numFmt !== 'bullet' &&
    item.numFmt !== 'none' &&
    item.markerText.length > 0
      ? item.markerText
      : null;
  const value = composed ?? fallback;
  return value === null ? null : trimTrailingPeriod(value);
}
