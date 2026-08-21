// The story-parity rule: what an operation may do differently depending on which story the
// caret is in.
//
// A DOCX holds several independent stories: the body, each header and footer part, and the
// footnote and endnote parts. Two specs already require that editing behaves the same in all
// of them:
//
//   - `scoped-header-footer-editing/specs/header-footer-editing/spec.md`: a command enabled in
//     an open header scope "SHALL apply to that story with the same semantics it would have on
//     equivalent body content".
//   - `typed-notes-footnotes-endnotes/specs/notes-authoring-surface/spec.md`: typing, formatting
//     and undo "SHALL behave as in the body", and the toolbar reflects the formatting there.
//
// Nothing enforced that, so the engine drifted: reads indexed the body while writes stayed
// scoped, and the two disagreed. This file is the machine-readable rule. Its tests check the
// engine against it by running the same operation on an identical paragraph in every story.
//
// `SLOT_PARITY` is a `Record<ChromeSlotId, ...>`, so a slot added to `CHROME_GROUPS` without a
// declared rule is a compile error rather than an untested control.

import type { ChromeSlotId } from '../chrome-controls.ts';

/** The stories the contract covers. Text boxes are not an editable scope yet. */
export type StoryKind = 'body' | 'header' | 'footer' | 'footnote' | 'endnote';

export const STORY_KINDS: readonly StoryKind[] = [
  'body',
  'header',
  'footer',
  'footnote',
  'endnote',
];

/** Every story that is not the body. The ones a body-only read gets wrong. */
export const FURNITURE_AND_NOTE_STORIES: readonly StoryKind[] = [
  'header',
  'footer',
  'footnote',
  'endnote',
];

/**
 * What a control may do differently per story.
 *
 * `bodyOnly` and `furnitureOnly` carry the REQUIRED refusal reason, and the tests assert it in
 * every story that must refuse. That field is the point of the type. A refusal that merely
 * says "disabled" cannot be told apart from one the engine never meant to make, and a rule
 * that only checked "is it disabled" would ratify both.
 */
export type ParityRule =
  /** Identical enabled / active / value in every story. */
  | { readonly parity: 'same' }
  /** Live in the body, refused everywhere else with exactly `reason`. */
  | { readonly parity: 'bodyOnly'; readonly reason: string }
  /** Live in a header or footer, refused in the body and in notes with exactly `reason`. */
  | { readonly parity: 'furnitureOnly'; readonly reason: string };

/**
 * The rule for every chrome slot.
 *
 * Almost everything is `same`. A control that formats, inserts or deletes text has no business
 * caring which story it is in, which is what both specs say. The exceptions are the four
 * commands that address body structure (a table of contents, the two note references, a
 * section break) and the four that address page furniture (the page-number fields).
 */
export const SLOT_PARITY: Readonly<Record<ChromeSlotId, ParityRule>> = Object.freeze({
  'history.undo': { parity: 'same' },
  'history.redo': { parity: 'same' },
  'zoom.level': { parity: 'same' },
  'styles.style': { parity: 'same' },
  'font.family': { parity: 'same' },
  'font.size': { parity: 'same' },
  'text.bold': { parity: 'same' },
  'text.italic': { parity: 'same' },
  'text.underline': { parity: 'same' },
  'text.strike': { parity: 'same' },
  'text.color': { parity: 'same' },
  'text.highlight': { parity: 'same' },
  'text.link': { parity: 'same' },
  'script.super': { parity: 'same' },
  'script.sub': { parity: 'same' },
  'alignment.left': { parity: 'same' },
  'alignment.center': { parity: 'same' },
  'alignment.right': { parity: 'same' },
  'alignment.justify': { parity: 'same' },
  'list.bullet': { parity: 'same' },
  'list.numbered': { parity: 'same' },
  'list.outdent': { parity: 'same' },
  'list.indent': { parity: 'same' },
  'list.lineSpacing': { parity: 'same' },
  'format.clear': { parity: 'same' },
  'review.comments': { parity: 'same' },
  'review.editingMode': { parity: 'same' },
  'contentControl.showAll': { parity: 'same' },
  'contentControl.formFill': { parity: 'same' },
  'contentControl.inspector': { parity: 'same' },
  'contentControl.remove': { parity: 'same' },
  'image.insert': { parity: 'same' },
  'image.properties': { parity: 'same' },
  'image.wrap': { parity: 'same' },
  'image.altText': { parity: 'same' },
  'table.insert': { parity: 'same' },
  'table.borderTarget': { parity: 'same' },
  'table.borderColor': { parity: 'same' },
  'table.borderStyle': { parity: 'same' },
  'table.borderWidth': { parity: 'same' },
  'table.cellFill': { parity: 'same' },
  'file.open': { parity: 'same' },
  'file.save': { parity: 'same' },
  'file.pageSetup': { parity: 'same' },
  'insert.pageBreak': { parity: 'same' },

  // A note reference is a body-story concept: `w:footnoteReference` lives in the main document
  // part, and Word refuses a note inside a note for the same reason.
  'insert.footnote': { parity: 'bodyOnly', reason: 'insertNote requires body scope' },
  'insert.endnote': { parity: 'bodyOnly', reason: 'insertNote requires body scope' },

  // A table of contents indexes the body outline and lives in the body.
  'insert.toc': {
    parity: 'bodyOnly',
    reason: 'a table of contents can only be inserted in the editable document body',
  },

  // A section break splits the body's `w:sectPr` chain, and `insertSectionBreak` already
  // refuses outside the body. The reason below is the one the gate OUGHT to publish; it does
  // not publish any today, which is the defect recorded in KNOWN_BROKEN.
  'insert.sectionBreakNextPage': {
    parity: 'bodyOnly',
    reason: 'a section break can only be inserted in the editable document body',
  },
  // Deliberately unwired: a continuous section break has no `insertBreak` command shape, so the
  // slot is disabled everywhere with the registry's own unwired reason.
  'insert.sectionBreakContinuous': { parity: 'same' },

  // PAGE / NUMPAGES / SECTIONPAGES project per page, so they mean something only in furniture.
  'insert.pageNumber': {
    parity: 'furnitureOnly',
    reason: 'insertPageField requires an open header or footer scope',
  },
  'insert.totalPages': {
    parity: 'furnitureOnly',
    reason: 'insertPageField requires an open header or footer scope',
  },
  'insert.sectionPages': {
    parity: 'furnitureOnly',
    reason: 'insertPageField requires an open header or footer scope',
  },
  'insert.pageXofY': {
    parity: 'furnitureOnly',
    reason: 'insertPageField requires an open header or footer scope',
  },
} as const);

/** Which observable a defect shows up in, so an entry cannot be kept alive by an unrelated one. */
export type ParityDimension = 'enabled' | 'active' | 'value' | 'reason';

export interface KnownBroken {
  /** The dimension that must still diverge. A defect fixed in `active` cannot hide behind `enabled`. */
  readonly dimension: ParityDimension;
  /** The root cause, named precisely enough to start from. */
  readonly cause: string;
}

/**
 * Slots the engine does NOT satisfy yet.
 *
 * The tests assert these still fail, in the named dimension, so the list cannot rot: fixing one
 * without removing its entry fails as loudly as breaking one. Every entry is a defect with a
 * known root cause, never "this is fine really". A control that is legitimately different
 * belongs in {@link SLOT_PARITY} as `bodyOnly` or `furnitureOnly`.
 */
export const KNOWN_BROKEN: Readonly<Partial<Record<ChromeSlotId, KnownBroken>>> = Object.freeze({
  // `canInsertTable` validates the op against `session.part()`, the BODY part, so a caret whose
  // paragraph lives in `header1.xml` is refused before the op is ever applied.
  //
  // The refusal the user sees is worse than silence. `docx-editor-derive.ts` has no scope gate
  // for `insertTable`; it falls back to a message that says a table may be inserted "in
  // editable body, cell, or note text" — which reads as a considered limit, and is wrong twice
  // over, because the engine refuses it in note text too.
  'table.insert': {
    dimension: 'enabled',
    cause: 'canInsertTable validates against the body part, so any other story is refused',
  },

  // The section-break gate exists and is correct (`surface-structure.ts` refuses when
  // `storyScope().kind !== 'body'`), but nothing surfaces it: there is no `insertBreak` arm in
  // `docx-editor-derive.ts`, so the toolbar reports the slot ENABLED in a header, and pressing
  // it silently does nothing. That is the read/write disagreement this contract exists to
  // catch, in its purest form: a live-looking button over a write that refuses.
  'insert.sectionBreakNextPage': {
    dimension: 'enabled',
    cause:
      'the body-only gate in insertSectionBreak is not published to the toolbar, so the control looks live everywhere',
  },

  // A `w:numPr` paragraph in a header is a list in the FILE, and neither the page nor the
  // toolbar agrees. `withResolvedListItems` runs only for the body, so no marker is resolved
  // for a furniture story; `markerOf` then reads null through `fragmentHolding`, and
  // `listKindOf` reports "not a list".
  //
  // The base commit settled the READ half of this deliberately: no marker is painted, so the
  // control agreeing with the page is consistent, and it called the missing rendering a
  // separate gap. It did not settle the WRITE half, which is a defect on its own. Measured, on
  // an identical `w:numPr` paragraph:
  //
  //   body     button active,   toggleList -> true,  w:numPr removed
  //   header   button inactive, toggleList -> true,  w:numPr STILL THERE
  //   footnote button inactive, toggleList -> true,  w:numPr STILL THERE
  //
  // `toggleList` enumerates through the scoped `paragraphOrder()`, so it writes to the right
  // story; but it decides on-or-off from `listKindOf`, so outside the body `turningOff` is
  // always false and the button can only ever turn a list ON. It reports success and changes
  // nothing. There is no way to remove list formatting from a header paragraph.
  'list.numbered': {
    dimension: 'active',
    cause:
      'list items are never resolved for a furniture or note story, so the marker read is null and toggleList can only ever turn a list on',
  },

  // The same root cause as `list.numbered`, and it needs its own entry because it needs its own
  // probe paragraph. With only a decimal list item in the fixture, `list.bullet` read inactive
  // in EVERY story including the body, so the body-only marker read looked like agreement. The
  // fixture carries a bulleted item as well for exactly this reason.
  'list.bullet': {
    dimension: 'active',
    cause: 'the same null marker read as list.numbered, on a bulleted item',
  },
} as const);
