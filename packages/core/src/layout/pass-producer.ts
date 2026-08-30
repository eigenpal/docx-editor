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
 * A small retained LRU. Strings only — it pins a bounded set of control tokens, never their
 * trees, and keeps concurrently exported documents warm without an unbounded module cache.
 */
interface ControlProducerSlot {
  readonly base: string | undefined;
  readonly token: string;
  readonly producer: string;
}

const MAX_CONTROL_PRODUCER_SLOTS = 8;
const controlProducerSlots: ControlProducerSlot[] = [];
let nextControlProducerId = 0n;

/** The document producer with the control token folded in, identity-stable across passes. */
export function producerWithControlContext(base: string | undefined, token: string): string {
  const slotIndex = controlProducerSlots.findIndex(
    (candidate) => candidate.base === base && candidate.token === token
  );
  if (slotIndex >= 0) {
    const [slot] = controlProducerSlots.splice(slotIndex, 1);
    controlProducerSlots.push(slot);
    return slot.producer;
  }
  // Control-heavy documents can have a multi-megabyte token. The producer reaches every
  // paragraph cache key (often more than once at different widths), so embedding the token
  // there multiplies it by the paragraph count and makes the published SemanticLayout retain
  // gigabytes. A small exact-match LRU gives each live context an opaque identity: unlike a
  // file-derived hash it cannot collide, and eviction only causes a safe cache miss.
  nextControlProducerId += 1n;
  const producer = `control-producer:${nextControlProducerId}`;
  controlProducerSlots.push({ base, token, producer });
  if (controlProducerSlots.length > MAX_CONTROL_PRODUCER_SLOTS) controlProducerSlots.shift();
  return producer;
}

interface PassProducerEntry {
  readonly base: string | undefined;
  readonly noteMarks: NoteMarkContext | undefined;
  readonly defaultTabStopPt: number | undefined;
  readonly displayMode: RevisionDisplayMode;
  readonly pageNumberFormat: string | undefined;
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
  displayMode: RevisionDisplayMode,
  pageNumberFormat: string | undefined
): entry is PassProducerEntry {
  return (
    entry != null &&
    entry.base === base &&
    entry.noteMarks === noteMarks &&
    entry.defaultTabStopPt === defaultTabStopPt &&
    entry.displayMode === displayMode &&
    entry.pageNumberFormat === pageNumberFormat
  );
}

/**
 * The per-pass producer: base plus cascade, note-mark, default-tab, display-mode and
 * page-number-format tokens.
 *
 * `pageNumberFormat` is the section's `w:pgNumType/@w:fmt` as the body flow MEASURES against
 * it. It belongs in the producer, not only in the section context string, because it changes
 * what a paragraph EMITS: it decides the text of a body page-field placeholder and whether the
 * atom carries its `\#` picture to finalize at all. The context governs session resume; the
 * producer is what reaches `paragraphLayoutKey`, and a cache hit returns the frozen lines
 * before the field walk runs — so a format edit would otherwise serve a stale placeholder and a
 * stale marker until that paragraph was edited for some other reason.
 *
 * A multi-section pass derives this once per SECTION; rebuilding a content-equal
 * multi-kilobyte string per section made every downstream `===` a memcmp.
 */
export function passProducerOf(
  base: string | undefined,
  styleCascade: StyleCascadeTable | undefined,
  noteMarks: NoteMarkContext | undefined,
  defaultTabStopPt: number | undefined,
  displayMode: RevisionDisplayMode,
  pageNumberFormat?: string
): string {
  const entry = styleCascade ? passProducersByCascade.get(styleCascade) : cascadeFreeProducerSlot;
  if (
    passProducerEntryMatches(
      entry,
      base,
      noteMarks,
      defaultTabStopPt,
      displayMode,
      pageNumberFormat
    )
  ) {
    return entry.producer;
  }
  const producer =
    (base ?? 'unversioned-measurer') +
    (styleCascade ? `|sc:${styleCascade.cacheToken}` : '') +
    (noteMarks ? `|nm:${noteMarksCacheToken(noteMarks)}` : '') +
    (defaultTabStopPt !== undefined ? `|dts:${defaultTabStopPt}` : '') +
    (displayMode === DEFAULT_REVISION_DISPLAY_MODE ? '' : `|rev:${displayMode}`) +
    (pageNumberFormat !== undefined ? `|pnf:${pageNumberFormat}` : '');
  const fresh: PassProducerEntry = {
    base,
    noteMarks,
    defaultTabStopPt,
    displayMode,
    pageNumberFormat,
    producer,
  };
  if (styleCascade) passProducersByCascade.set(styleCascade, fresh);
  else cascadeFreeProducerSlot = fresh;
  return producer;
}
