// Engine refusals → catalogue keys.
//
// An engine `disabledReason` is chrome a user reads, so it has to reach them in their own
// language. The engine states them in English because it has no locale, and this table is
// where that English becomes a key. A refusal with no entry here renders raw in every
// locale — which nothing else catches, so `disabled-reasons.test.ts` pins the ones that
// name a real limit rather than a diagnostic.

import type { TFunction, TranslationKey } from './index';

export const DISABLED_REASON_KEYS: Readonly<Record<string, TranslationKey>> = Object.freeze({
  'editor is not ready': 'disabledReason.editorNotReady',
  'not wired to an editor command': 'disabledReason.notWired',
  'this document was opened for viewing': 'disabledReason.viewing',
  'the document is open for viewing': 'disabledReason.viewing',
  'this document permits editing only as tracked changes': 'disabledReason.trackedOnly',
  'no document is loaded': 'disabledReason.noDocument',
  'no document is open': 'disabledReason.noDocument',
  'no content control at the selection': 'disabledReason.noContentControl',
  'no drawing is selected': 'disabledReason.noDrawing',
  'the drawing is locked': 'disabledReason.drawingLocked',
  'a comment needs a selected range': 'disabledReason.commentSelection',
  'cell merge is not supported yet': 'disabledReason.mergeUnsupported',
  'cell split is not supported yet': 'disabledReason.splitUnsupported',
  'image property edits are not supported in suggesting mode': 'disabledReason.imageSuggesting',
  'invalid table chrome value': 'disabledReason.invalidValue',
  'invalid value for toolbar command': 'disabledReason.invalidValue',
  'unsupported table command': 'disabledReason.unavailable',
  // Scope refusals. Each names a story limit the engine really enforces, so each is chrome the
  // user reads — and each rendered as raw English in every locale until it was listed here.
  'a section break can only be inserted in the editable document body':
    'disabledReason.bodyOnlySectionBreak',
  'a table of contents can only be inserted in the editable document body':
    'disabledReason.bodyOnlyToc',
  'insertNote requires body scope': 'disabledReason.bodyOnlyNote',
  'insertPageField requires an open header or footer scope':
    'disabledReason.furnitureOnlyPageField',
  // Not a scope refusal: the story is right and the MODE is not. A section break's type
  // lands on the section that follows it, and Word's record for that change is one this
  // engine refuses to accept or reject — so it cannot be proposed.
  'a section break that changes where the next section starts cannot be suggested; turn off suggesting to insert it':
    'disabledReason.suggestingSectionBreak',
  'a section break cannot be inserted inside a table cell': 'disabledReason.tableCellSectionBreak',
  // Deliberately NOT the store's `locked` / `bound` enums. Those are shared by every op —
  // `locked` covers a locked CONTROL whose content is editable as well as locked content —
  // so one sentence cannot be true of all of them. Each lane says what its own refusal means.
  'a section break cannot change a section that a locked or linked content control holds':
    'disabledReason.lockedSectionBreak',
  'a section break cannot be inserted in locked or linked content':
    'disabledReason.lockedContentBreak',
});

/**
 * Translate a known engine refusal for adapter chrome.
 *
 * Unknown diagnostics stay exact, so integrations never lose the engine's explanation.
 *
 * @public
 */
export function localizeDisabledReason(reason: string | null, t: TFunction): string | null {
  if (!reason) return null;
  const key = DISABLED_REASON_KEYS[reason];
  return key ? t(key) : reason;
}
