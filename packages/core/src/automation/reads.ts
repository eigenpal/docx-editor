// Every read the protocol answers, derived from one canonical package.
//
// INTERNAL. There is exactly one implementation of "what are the body's paragraphs" and
// "what does this paragraph say", and both hosts run it over the package their port hands
// back. That is the whole reason the browser host cannot drift from the headless one: it is
// not that the two implementations agree, it is that there is one implementation.
//
// Text comes from `paragraphTextOf`, the same offset authority the tree ops validate
// against, so a length a consumer reads and an offset it then writes at are the same
// vocabulary. A paragraph text derived any other way — a layout span, a projection — reads
// a field or a note differently and puts every subsequent offset one character out.

import { deriveOoxmlIndexes } from '../store/package/ooxml-indexes.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import { paragraphTextOf } from '../store/store/tree-ops.ts';

export interface AutomationDocumentReads {
  /** Canonical ids of the body's paragraphs, in document order. */
  readonly bodyParagraphIds: readonly string[];
  /** A paragraph's text in model-offset vocabulary, or null when it is not in the body. */
  paragraphText(paragraphId: string): string | null;
  /** The body's paragraphs joined by newlines — one paragraph, one line. */
  bodyText(): string;
}

const NO_PARAGRAPHS: readonly string[] = Object.freeze([]);

/**
 * Project the reads out of a package snapshot.
 *
 * Pure and cheap to throw away: packages are immutable, so a caller caches this on package
 * IDENTITY and never has to reason about invalidation.
 */
export function documentReads(pkg: OoxmlPackage): AutomationDocumentReads {
  const main: OoxmlPart | undefined = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) {
    return {
      bodyParagraphIds: NO_PARAGRAPHS,
      paragraphText: () => null,
      bodyText: () => '',
    };
  }
  // The canonical derived index, not a bespoke walk: it already answers "the direct
  // paragraphs of this story's body, in order" and it is the projection the rest of the
  // engine reads. The revision tag is not used here — reads are keyed on package identity —
  // so it is passed as zero rather than invented.
  const indexes = deriveOoxmlIndexes(pkg, 0);
  const story = indexes.stories.get(main.name);
  const bodyParagraphIds = Object.freeze(
    (story?.paragraphs ?? []).map((paragraph) => paragraph.nodeId)
  );
  const known = new Set(bodyParagraphIds);
  const paragraphText = (paragraphId: string): string | null =>
    known.has(paragraphId) ? paragraphTextOf(main, paragraphId) : null;
  return {
    bodyParagraphIds,
    paragraphText,
    bodyText: () => bodyParagraphIds.map((id) => paragraphText(id) ?? '').join('\n'),
  };
}
