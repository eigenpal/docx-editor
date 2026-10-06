import {
  DEFAULT_REVISION_MARKUP,
  type ResolvedRevisionMarkup,
} from '../contracts/revision-markup.ts';
import type { RevisionAuthorFilter } from '../layout/revision-projection.ts';
import type { OoxmlPart } from '@docx-editor.dev/core/store';

/** Viewer settings participate in layout cache identity without changing the package. */
export function createSurfaceRevisionMarkup(
  initial: ResolvedRevisionMarkup | undefined,
  baseFilter: () => RevisionAuthorFilter | undefined,
  beforeChange: () => void,
  afterChange: () => void
) {
  let current = initial ?? DEFAULT_REVISION_MARKUP;
  let previousBase: RevisionAuthorFilter | undefined;
  let previousSettings: ResolvedRevisionMarkup | undefined;
  let cached: RevisionAuthorFilter | undefined;
  return {
    current: () => current,
    filter(): RevisionAuthorFilter {
      const base = baseFilter();
      if (!cached || base !== previousBase || current !== previousSettings) {
        previousBase = base;
        previousSettings = current;
        cached = {
          ...base,
          hiddenAuthors: base?.hiddenAuthors ?? new Set(),
          revisionMarkup: current,
          cacheKey: `${base?.cacheKey ?? ''}|markup:${JSON.stringify(current)}`,
        };
      }
      return cached;
    },
    set(next: ResolvedRevisionMarkup) {
      if (JSON.stringify(next) === JSON.stringify(current)) return;
      beforeChange();
      current = next;
      afterChange();
    },
  };
}

export function revisionFacingPages(settings: OoxmlPart | null): boolean {
  return (
    settings?.root.children.some(
      (node) =>
        node.kind !== 'textValue' &&
        (node.localName === 'mirrorMargins' || node.localName === 'evenAndOddHeaders') &&
        !node.attributes.some(
          (attribute) =>
            attribute.localName === 'val' && ['0', 'false', 'off'].includes(attribute.value)
        )
    ) ?? false
  );
}
