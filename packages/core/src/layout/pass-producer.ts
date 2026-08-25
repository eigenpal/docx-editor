// Identity-stable producer strings for layout passes.
//
// The producer folds the content-control token in, and that token runs to kilobytes on a
// control-heavy document. It reaches every section's prepass memo, break-cache key prefix
// and session comparison — so the string OBJECT must stay stable while its content does,
// or every one of those `===` checks degrades from a pointer check to a memcmp per section
// per pass. Both helpers keep one retained slot (bounded); the inputs are identity-stable
// when unchanged, so a hit is a handful of pointer compares.

import { noteMarksCacheToken, type NoteMarkContext } from './note-projection.ts';
import { DEFAULT_REVISION_DISPLAY_MODE, type RevisionDisplayMode } from './revision-projection.ts';
import type { StyleCascadeTable } from './style-cascade.ts';

let controlProducerSlot: {
  readonly base: string | undefined;
  readonly token: string;
  readonly producer: string;
} | null = null;

/** The document producer with the control token folded in, identity-stable across passes. */
export function producerWithControlContext(base: string | undefined, token: string): string {
  const slot = controlProducerSlot;
  if (slot && slot.base === base && slot.token === token) return slot.producer;
  const producer = `${base ?? 'unversioned-measurer'}|cc:${token}`;
  controlProducerSlot = { base, token, producer };
  return producer;
}

let passProducerSlot: {
  readonly base: string | undefined;
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly noteMarks: NoteMarkContext | undefined;
  readonly defaultTabStopPt: number | undefined;
  readonly displayMode: RevisionDisplayMode;
  readonly producer: string;
} | null = null;

/**
 * The per-pass producer: base plus cascade, note-mark, default-tab and display-mode tokens.
 *
 * A multi-section pass derives this once per SECTION, and every input is identity-stable
 * when unchanged, so one retained slot serves the whole pass — and the next one.
 */
export function passProducerOf(
  base: string | undefined,
  styleCascade: StyleCascadeTable | undefined,
  noteMarks: NoteMarkContext | undefined,
  defaultTabStopPt: number | undefined,
  displayMode: RevisionDisplayMode
): string {
  const slot = passProducerSlot;
  if (
    slot &&
    slot.base === base &&
    slot.styleCascade === styleCascade &&
    slot.noteMarks === noteMarks &&
    slot.defaultTabStopPt === defaultTabStopPt &&
    slot.displayMode === displayMode
  ) {
    return slot.producer;
  }
  const producer =
    (base ?? 'unversioned-measurer') +
    (styleCascade ? `|sc:${styleCascade.cacheToken}` : '') +
    (noteMarks ? `|nm:${noteMarksCacheToken(noteMarks)}` : '') +
    (defaultTabStopPt !== undefined ? `|dts:${defaultTabStopPt}` : '') +
    (displayMode === DEFAULT_REVISION_DISPLAY_MODE ? '' : `|rev:${displayMode}`);
  passProducerSlot = { base, styleCascade, noteMarks, defaultTabStopPt, displayMode, producer };
  return producer;
}
