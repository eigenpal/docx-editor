// Editor adapter over the shared layout embedded-font mapper.

import type { EmbeddedFont } from '@docx-editor.dev/core/store';
import {
  EditorFontError,
  type FontFaceRequest,
  type FontSource,
} from '@docx-editor.dev/core/contracts/editor';
import {
  boundedExplicitFontSources as mapBoundedExplicitFontSources,
  embeddedFontSources as mapEmbeddedFontSources,
  embeddedFontSourcesAfterExplicit as mapEmbeddedFontSourcesAfterExplicit,
} from '../layout/embedded-font-sources.ts';

export interface DroppedEmbeddedFont {
  readonly request: FontFaceRequest;
  readonly partName: string;
  readonly reason: 'overLimit' | 'malformed';
}

export interface EmbeddedFontSources {
  readonly sources: readonly FontSource[];
  readonly dropped: readonly DroppedEmbeddedFont[];
}

export const explicitFontBudgetError = (source: FontSource): EditorFontError =>
  new EditorFontError('overLimit', `font source ${source.id} exceeds the font byte budget`, {
    request: source.request,
  });

export const embeddedFontDropError = (drop: DroppedEmbeddedFont): EditorFontError =>
  new EditorFontError(
    drop.reason,
    drop.reason === 'overLimit'
      ? `embedded font ${drop.request.family} (${drop.partName}) exceeds the font byte budget`
      : `embedded font part ${drop.partName} declares an invalid family name`,
    { request: drop.request }
  );

/** Apply engine byte ceilings before explicit sources can reduce the document budget. */
export function boundedExplicitFontSources(
  sources: readonly FontSource[],
  maxFontBytes: number
): { readonly sources: readonly FontSource[]; readonly dropped: readonly FontSource[] } {
  return mapBoundedExplicitFontSources(sources, maxFontBytes);
}

/** Map document fonts after admitted explicit sources take precedence and budget. */
export function embeddedFontSourcesAfterExplicit(
  embedded: readonly EmbeddedFont[],
  explicit: readonly FontSource[],
  maxFontBytes: number
): EmbeddedFontSources {
  return mapEmbeddedFontSourcesAfterExplicit(embedded, explicit, maxFontBytes);
}

/** Map embedded faces to `FontSource`s under the given byte budgets. */
export function embeddedFontSources(
  embedded: readonly EmbeddedFont[],
  budgets: {
    readonly maxFontBytes: number;
    readonly aggregateBudget: number;
    readonly shadowedRequests?: ReadonlySet<string>;
  }
): EmbeddedFontSources {
  return mapEmbeddedFontSources(embedded, budgets);
}
