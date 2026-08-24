// Projected text search with model-offset results.

import { findOccurrences, SEARCH_MATCH_LIMIT } from '../store/store/text-match.ts';
import type { AutomationHandleTable } from './handles.ts';
import type { AutomationSearchOptions } from './operations.ts';
import type { AutomationSpan } from './protocol.ts';
import type { AutomationStoryReads } from './reads.ts';
import { spanParagraphIds, type ResolvedSpan } from './spans.ts';

export type ProjectedSearchResult =
  | { readonly ok: true; readonly spans: readonly AutomationSpan[] }
  | { readonly ok: false; readonly paragraphId: string };

/** Search one story view and map each visible hit back to one editable model span. */
export function projectedSearchSpans(
  reads: AutomationStoryReads,
  scope: ResolvedSpan,
  handles: AutomationHandleTable,
  text: string,
  options: AutomationSearchOptions | undefined
): ProjectedSearchResult {
  let budget = Math.min(options?.limit ?? SEARCH_MATCH_LIMIT, SEARCH_MATCH_LIMIT);
  const spans: AutomationSpan[] = [];
  const ids = spanParagraphIds(scope, reads);
  const last = ids.length - 1;
  for (const [position, paragraphId] of ids.entries()) {
    if (budget <= 0) break;
    const projected = reads.projectedText(paragraphId, options?.projection ?? 'allMarkup');
    if (!projected) continue;
    const found = findOccurrences(projected.text, text, budget, {
      matchCase: options?.matchCase === true,
      wholeWord: options?.matchWholeWord === true,
      ...(position === 0 && scope ? { from: projected.projectedOffset(scope.start.offset) } : {}),
      ...(position === last && scope ? { to: projected.projectedOffset(scope.end.offset) } : {}),
    });
    for (const occurrence of found.matches) {
      const mapped = projected.rawRange(occurrence.start, occurrence.start + occurrence.length);
      if (!mapped) return { ok: false, paragraphId };
      if (position === 0 && scope && mapped.start < scope.start.offset) continue;
      if (position === last && scope && mapped.end > scope.end.offset) continue;
      const paragraph = handles.paragraph(paragraphId, reads.story);
      spans.push({
        start: { paragraph, offset: mapped.start },
        end: { paragraph, offset: mapped.end },
      });
      budget -= 1;
    }
  }
  return { ok: true, spans };
}
