// A layout of the pages a body pass has completed so far, for a host that shows them before
// the pass ends (`layout-steps.ts`). It applies what the end of the pass applies to its pages:
// page-field sources and their projection, and list labels on reused records. It writes no
// session state, so the pass that reported the pages can still finish or be dropped.

import { finalizePageFieldProjection, withPageFieldSources } from './field-projection.ts';
import { relabelListMarkers } from './list-marker-reuse.ts';
import type { ResolvedListItem } from './list-resolve.ts';
import type { LayoutSteps } from './layout-steps.ts';
import type { PageRecord, SemanticLayout, TextMeasurer } from './semantic-records.ts';

export interface InterimLayoutInput {
  readonly revision: number;
  readonly numbering?: { readonly start?: number; readonly fmt?: string };
  readonly listItems?: ReadonlyMap<string, ResolvedListItem>;
  readonly measurer?: TextMeasurer;
}

/** `steps`, with every progress report able to build an interim layout of its pages. */
export function* withInterimLayout<T>(
  steps: LayoutSteps<T>,
  input: InterimLayoutInput
): LayoutSteps<T> {
  const finalize = (pages: readonly PageRecord[]): SemanticLayout =>
    relabelListMarkers(
      finalizePageFieldProjection({
        revision: input.revision,
        pages: withPageFieldSources(
          pages,
          input.numbering?.start ?? 1,
          pages.length,
          input.numbering?.fmt
        ),
      }),
      input.listItems,
      input.measurer
    );
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
    yield next.value ? { pages: next.value.pages, finalize } : undefined;
  }
}
