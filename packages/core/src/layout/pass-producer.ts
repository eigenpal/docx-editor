// Identity-stable producer strings for layout passes.
//
// The producer folds the content-control token in, and that token runs to kilobytes on a
// control-heavy document. It reaches every section's prepass memo, break-cache key prefix
// and session comparison — so the string OBJECT must stay stable while its content does,
// or every one of those `===` checks degrades from a pointer check to a memcmp per section
// per pass. The inputs are identity-stable when unchanged, so a hit is a handful of
// pointer compares.

import { noteMarksCacheToken, type NoteMarkContext } from './note-projection.ts';
import { DEFAULT_REVISION_DISPLAY_MODE, type RevisionDisplayMode } from './revision-projection.ts';
import type { StyleCascadeTable } from './style-cascade.ts';

/**
 * One retained slot. Strings only — the slot pins a few kilobytes of the last document's
 * token, never its tree — so a module slot is a bounded trade; two live editors merely
 * alternate one concat per pass instead of sharing the hit.
 */
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

interface PassProducerEntry {
  readonly base: string | undefined;
  readonly noteMarks: NoteMarkContext | undefined;
  readonly defaultTabStopPt: number | undefined;
  readonly displayMode: RevisionDisplayMode;
  readonly producer: string;
}

/**
 * Keyed weakly on the style cascade — the one heavy object among the inputs — so a closed
 * document's cascade, mark context and producer die with it instead of staying pinned in a
 * module slot, and two live editors keep separate entries. A cascade-less caller (bare
 * tests, furniture-only passes) falls back to one strings-and-marks slot, which retains no
 * document tree.
 */
const passProducersByCascade = new WeakMap<StyleCascadeTable, PassProducerEntry>();
let cascadeFreeProducerSlot: PassProducerEntry | null = null;

function passProducerEntryMatches(
  entry: PassProducerEntry | null | undefined,
  base: string | undefined,
  noteMarks: NoteMarkContext | undefined,
  defaultTabStopPt: number | undefined,
  displayMode: RevisionDisplayMode
): entry is PassProducerEntry {
  return (
    entry != null &&
    entry.base === base &&
    entry.noteMarks === noteMarks &&
    entry.defaultTabStopPt === defaultTabStopPt &&
    entry.displayMode === displayMode
  );
}

/**
 * The per-pass producer: base plus cascade, note-mark, default-tab and display-mode tokens.
 *
 * A multi-section pass derives this once per SECTION; rebuilding a content-equal
 * multi-kilobyte string per section made every downstream `===` a memcmp.
 */
export function passProducerOf(
  base: string | undefined,
  styleCascade: StyleCascadeTable | undefined,
  noteMarks: NoteMarkContext | undefined,
  defaultTabStopPt: number | undefined,
  displayMode: RevisionDisplayMode
): string {
  const entry = styleCascade ? passProducersByCascade.get(styleCascade) : cascadeFreeProducerSlot;
  if (passProducerEntryMatches(entry, base, noteMarks, defaultTabStopPt, displayMode)) {
    return entry.producer;
  }
  const producer =
    (base ?? 'unversioned-measurer') +
    (styleCascade ? `|sc:${styleCascade.cacheToken}` : '') +
    (noteMarks ? `|nm:${noteMarksCacheToken(noteMarks)}` : '') +
    (defaultTabStopPt !== undefined ? `|dts:${defaultTabStopPt}` : '') +
    (displayMode === DEFAULT_REVISION_DISPLAY_MODE ? '' : `|rev:${displayMode}`);
  const fresh: PassProducerEntry = { base, noteMarks, defaultTabStopPt, displayMode, producer };
  if (styleCascade) passProducersByCascade.set(styleCascade, fresh);
  else cascadeFreeProducerSlot = fresh;
  return producer;
}
