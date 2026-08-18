/**
 * How a document's opening editing mode is decided — pure decisions over the facade's
 * state, kept out of `docx-editor.ts` so the composition root stays under its line cap.
 *
 * Two callers, in order:
 *
 * 1. `resolveOpeningEditingMode` at CONSTRUCTION: an explicit `config.mode` is the
 *    host's standing choice for every open and wins over the document's own request.
 *    (`'view'` is handled where `editingMode` is initialized; it needs no decision here.)
 * 2. `documentTrackingAdoption` at each MOUNT, once the document's settings are
 *    readable. `w:trackRevisions` ASKS for suggesting: it is a property of the file, not
 *    of the reader, so a package that carries it opens in suggesting — otherwise the
 *    first keystroke is an untracked edit in a document whose author asked for the
 *    opposite, with the pill reading "Editing". An enforced
 *    `w:documentProtection w:edit="trackedChanges"` REQUIRES it: that protection makes
 *    `setEditingMode('editing')` refuse `locked`, so it outranks even an explicit
 *    `mode: 'edit'` — opening in editing there would put the editor in a mode its own
 *    gate refuses to enter.
 *
 * Suggesting has preconditions either way: writing `w:ins`/`w:del` is the review
 * module's capability, and a proposal needs an author to be attributed to. With no
 * module the document opens and edits normally — the edits are simply untracked,
 * exactly as `can(setEditingMode: 'suggesting')` reports. With a module but no author,
 * the editor opens editing and the REASON is published (`rejection`) rather than the
 * request being dropped in silence.
 */

import type { DocumentEditingMode } from '../contracts/editor.ts';

/**
 * The refusal every review write gets when no review module is registered.
 *
 * One string, quoted verbatim by `toolbarCommandState` as the disabled tooltip — the
 * same "the engine's own reason" channel every other unavailable control uses.
 */
export const PRO_REVIEW_REASON =
  'comments and tracked changes require the pro review module (@docx-editor.dev/pro)';

/** What a decision asks the facade to do: adopt a mode, publish a refusal, or neither. */
export interface OpeningModeDecision {
  /** The mode to open in, or null to leave the current mode alone. */
  readonly mode: DocumentEditingMode | null;
  /** The published reason a requested mode was not entered, or null. */
  readonly rejection: string | null;
}

const NO_DECISION: OpeningModeDecision = { mode: null, rejection: null };

/** Suggesting's preconditions, read by both decisions. */
export interface OpeningModeGuards {
  /** True when a review module is registered (suggesting writes `w:ins`/`w:del`). */
  readonly reviewEnabled: boolean;
  /** True when `config.author` names someone a proposal can be attributed to. */
  readonly hasAuthor: boolean;
}

/**
 * The host's construction-time choice, or nothing when `config.mode` is omitted.
 * Runs before the first mount reads the mode, so the surface comes up in it directly.
 */
export function resolveOpeningEditingMode(
  requested: 'edit' | 'view' | 'suggesting' | undefined,
  guards: OpeningModeGuards
): OpeningModeDecision {
  if (requested === undefined || requested === 'view') return NO_DECISION;
  if (requested === 'edit') return { mode: 'editing', rejection: null };
  if (!guards.reviewEnabled) return { mode: null, rejection: PRO_REVIEW_REASON };
  if (!guards.hasAuthor) {
    return { mode: null, rejection: 'suggesting mode was requested, but no author is configured' };
  }
  return { mode: 'suggesting', rejection: null };
}

/**
 * The document's own tracking request at mount, or nothing. See the module comment for
 * the ask/require split; the reader-side overrides are `viewOnly`, a mode the reader
 * has already moved off (`readerChoseMode` — a reload must not undo their choice), and,
 * for the ASK only, an explicit `config.mode` (`hostChoseMode`).
 */
export function documentTrackingAdoption(
  input: OpeningModeGuards & {
    /** True when the facade was constructed `mode: 'view'` — outranks every request. */
    readonly viewOnly: boolean;
    readonly hostChoseMode: boolean;
    readonly readerChoseMode: boolean;
    readonly currentMode: DocumentEditingMode;
    /** The document's `w:trackRevisions` request. */
    readonly trackRevisions: boolean;
    /** Enforced `w:documentProtection w:edit="trackedChanges"` — see the module comment. */
    readonly restrictedToTrackedChanges: boolean;
  }
): OpeningModeDecision {
  if (input.viewOnly || input.currentMode !== 'editing' || input.readerChoseMode) {
    return NO_DECISION;
  }
  const asks = input.trackRevisions && !input.hostChoseMode;
  if (!asks && !input.restrictedToTrackedChanges) return NO_DECISION;
  if (!input.reviewEnabled) return NO_DECISION;
  if (!input.hasAuthor) {
    return {
      mode: null,
      rejection: 'this document asks for tracked changes, but no author is configured',
    };
  }
  return { mode: 'suggesting', rejection: null };
}
