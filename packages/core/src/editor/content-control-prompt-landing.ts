// Where typed text lands beside a prompt.
//
// The store replaces a `w:showingPlcHdr` prompt whole when text is inserted at either of
// its edges, so the characters go where the prompt began, not where the caret was pressed.
// The surface asks the same question the store answers, before the write, so the caret it
// places afterwards counts from the landing rather than from an offset the replacement
// made stale — which had left it past the paragraph's new end, with every later keystroke
// landing in the wrong place.

import type { OoxmlPart } from '@docx-editor.dev/core/store';
import { placeholderControlForInsertion } from '../store/store/tree-op-content-controls.ts';

/** The caret offset after `textLength` characters land at `offset` in `paragraphId`. */
export function promptInsertionLanding(
  part: OoxmlPart,
  paragraphId: string,
  offset: number,
  textLength: number
): number {
  const prompt = placeholderControlForInsertion(part, paragraphId, offset);
  return (prompt?.offset ?? offset) + textLength;
}
