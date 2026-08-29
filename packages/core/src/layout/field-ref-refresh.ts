// Save-time REF result refresh: plan the one `refreshFieldResults` op that makes the saved
// bytes carry what the pages paint.
//
// Painted REF values are a layout projection; the file keeps Word's cached result runs, so
// an export after a renumbering edit is stale until Word refreshes fields. The plan reuses
// the layout's own resolution (`resolveStoryRefFields` — grammar, bookmark index, number
// composition AND the per-field calibration verdict, all shared, so save and paint cannot
// drift) and pairs it with the store's result locator, then keeps only the fields whose
// plain-run cached text differs from the LIVE value. `liveValueOf` answers null for a field
// that failed calibration, so a field painting its cache keeps that cache on save too —
// rewriting it would export the very value the calibration gate exists to suppress. A fresh
// document plans NOTHING: the caller sees null, runs no transaction, bumps no revision, and
// the save is byte-identical to one without the refresh.
//
// Scope: the BODY story. Note-story results still paint live through the shared context but
// keep their cached runs on save — rewriting them needs per-note-part transactions, tracked
// with the notes half of the follow-up. The field INSTRUCTION is never modified, and any
// result the locator calls non-rewritable (revision markup, nested fields, locks, anything
// but plain runs) keeps its cache untouched.

import type { OoxmlPart } from '@docx-editor.dev/core/store';
import { resolveNotesPart } from '../store/package/note-references.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import {
  locateFieldResults,
  MAX_FIELD_RESULT_TEXT_CHARS,
  MAX_FIELD_RESULT_UPDATES,
  type RefreshFieldResultsOp,
} from '../store/store/tree-op-field-results.ts';
import { noteRefNumberingForPart } from './field-noteref.ts';
import {
  parseRefInstruction,
  resolveStoryRefFieldsWithNoteNumbers,
  type RefNoteParts,
} from './field-ref.ts';
import { walkStoryParagraphs, withResolvedListItems } from './list-resolve.ts';
import type { NumberingIndex } from './numbering-index.ts';
import { DEFAULT_REVISION_DISPLAY_MODE } from './revision-projection.ts';
import type { RevisionDisplayMode } from './revision-projection.ts';
import { storyBlocks } from './story-roots.ts';
import type { StyleCascadeTable } from './style-cascade.ts';

export interface RefFieldRefreshOptions {
  /**
   * The package the part belongs to, for the note-part half of the resolution context —
   * the same context paint uses, so a body REF that targets a footnote bookmark computes
   * the same value both places. Absent narrows resolution to body-declared bookmarks.
   */
  readonly package?: OoxmlPackage;
  readonly styleCascade?: StyleCascadeTable;
  readonly numberingIndex?: NumberingIndex;
  /** The mode the surface painted under, so the saved values match the painted ones. */
  readonly displayMode?: RevisionDisplayMode;
}

/**
 * Plan the refresh for one body part, or null when every supported REF result is already
 * fresh (the no-op save path — no transaction, no revision bump, no undo entry).
 *
 * Every skip is conservative and per-field: an unrecognized instruction or switch, a
 * missing bookmark, an unnumbered target under a number switch, a non-plain result, a
 * locked field and a field whose calibration verdict is "keeps the cache" all keep their
 * cached runs exactly as loaded.
 */
export function planRefFieldResultRefresh(
  part: OoxmlPart,
  options: RefFieldRefreshOptions
): RefreshFieldResultsOp | null {
  const blocks = storyBlocks(part, options.displayMode ?? DEFAULT_REVISION_DISPLAY_MODE);
  const listItems = withResolvedListItems(
    { numberingIndex: options.numberingIndex, styleCascade: options.styleCascade },
    blocks
  ).listItems;
  const notes: RefNoteParts | undefined = options.package
    ? {
        footnotesPart: resolveNotesPart(options.package, 'footnote'),
        endnotesPart: resolveNotesPart(options.package, 'endnote'),
      }
    : undefined;
  // NOTEREF results ride the same plan: the numbering input rebuilds from the package the
  // way the surface builds its notes input, so a refreshed result carries the painted value.
  const context = resolveStoryRefFieldsWithNoteNumbers(
    blocks,
    listItems,
    notes,
    options.package ? noteRefNumberingForPart(options.package, part, blocks) : undefined
  );
  if (context === null) return null;

  const updates: { paragraphId: string; fieldNodeId: string; text: string }[] = [];
  for (const paragraph of walkStoryParagraphs(blocks)) {
    if (updates.length >= MAX_FIELD_RESULT_UPDATES) break;
    // The context already scanned every paragraph; only the ones holding recognized REF
    // specs are worth the locate walk.
    if (context.tokenForParagraph(paragraph.id) === '') continue;
    for (const located of locateFieldResults(paragraph)) {
      if (updates.length >= MAX_FIELD_RESULT_UPDATES) break;
      if (!located.rewritable) continue;
      const spec = parseRefInstruction(located.instruction);
      if (spec === null) continue;
      // The locator's field id IS the calibration anchor (begin fldChar / fldSimple node),
      // so this read returns exactly what the pages paint — or null for a field painting
      // its cache, which then saves as loaded.
      const value = context.liveValueOf(located.fieldNodeId, spec);
      if (value === null || value === located.cachedText) continue;
      // The op's own bounds, applied per field so one outlier cannot refuse the whole plan:
      // length-capped, and no line breaks (a rewrite expresses tabs, never `w:br`).
      if (value.length > MAX_FIELD_RESULT_TEXT_CHARS) continue;
      if (value.includes('\n') || value.includes('\r')) continue;
      updates.push({ paragraphId: paragraph.id, fieldNodeId: located.fieldNodeId, text: value });
    }
  }
  if (updates.length === 0) return null;
  return { op: 'refreshFieldResults', updates };
}
