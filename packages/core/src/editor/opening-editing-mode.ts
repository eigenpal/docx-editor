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
 *
 * The same two preconditions gate the RUNTIME request, `setEditingMode('suggesting')`,
 * through `suggestingModeRefusal`. Entering suggesting without an author used to succeed
 * and then refuse every keystroke: the pill read Suggesting, the document took focus, and
 * typing changed nothing. A missing author is a host configuration error, so the request
 * is refused with the reason, and `createSuggestingConfigurationReporter` raises it once
 * through the editor's error channel for the host that never reads the result.
 */

import type { DocumentEditingMode, EditorError, ExecResult } from '../contracts/editor.ts';
import type { DocumentTrackingSettings } from '../store/package/tracking-settings.ts';
import { editorError } from './docx-editor-support.ts';

/** A refused command, as `can` and `exec` both answer it. */
export type CommandRefusal = Extract<ExecResult, { ok: false }>;

/**
 * The refusal every review write gets when no review module is registered.
 *
 * One string, quoted verbatim by `toolbarCommandState` as the disabled tooltip — the
 * same "the engine's own reason" channel every other unavailable control uses.
 */
export const PRO_REVIEW_REASON =
  'comments and tracked changes require the pro review module (@docx-editor.dev/pro)';

/**
 * The refusal any attach or undo-takeover path gets when no collaboration
 * module is registered.
 */
export const PRO_COLLABORATION_REASON =
  'realtime collaboration requires the pro collaboration module (@docx-editor.dev/pro)';

/**
 * The refusal a HOST request for suggesting gets when no author is configured.
 *
 * One sentence for one configuration error, whether the host asked at construction
 * (`config.mode`), through `setMode`, or through `setEditingMode`: a proposal has to be
 * attributed to someone, and `author` is where the host says who.
 */
export const SUGGESTING_AUTHOR_REASON =
  'suggesting mode needs an author; configure author before enabling it';

/** The published reason when the DOCUMENT asks for tracking and no author is configured. */
const DOCUMENT_TRACKING_AUTHOR_REASON =
  'this document asks for tracked changes, but no author is configured';

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
  const refusal = suggestingModeRefusal(guards);
  if (refusal !== null) return { mode: null, rejection: refusal.reason };
  return { mode: 'suggesting', rejection: null };
}

/**
 * Why a request to enter suggesting is refused right now, or null when it can be entered.
 *
 * ONE statement of suggesting's preconditions, asked by `can` and `exec` for
 * `setEditingMode('suggesting')` and by the construction-time decision above, so the
 * toolbar's disabled reason, the command's refusal and the published rejection are the
 * same sentence. The module comes first: without one there is no author to miss.
 */
export function suggestingModeRefusal(guards: OpeningModeGuards): CommandRefusal | null {
  if (!guards.reviewEnabled) return { ok: false, code: 'unsupported', reason: PRO_REVIEW_REASON };
  if (!guards.hasAuthor) {
    return { ok: false, code: 'invalidArgs', reason: SUGGESTING_AUTHOR_REASON };
  }
  return null;
}

/** The once-per-editor report of the suggesting-without-author configuration error. */
export interface SuggestingConfigurationReporter {
  /** Raise the error for `rejection` when it is the author one; every other reason is ignored. */
  report(rejection: string | null): void;
  /** Drop a report still waiting; the editor is going away. */
  dispose(): void;
}

/**
 * Raise the suggesting-without-author configuration error once per editor.
 *
 * The refusal already reaches the host as an `ExecResult` and as the published
 * `lastRejection`; this is for the host that reads neither, like an `onReady` that calls
 * `setEditingMode('suggesting')` and drops the result. It goes out through the editor's
 * `error` event, the channel every other engine-raised error uses, and falls back to the
 * console only when nobody listens — a host that reports errors in its own UI does not
 * need library noise it cannot switch off (the `reportFontError` precedent).
 *
 * DEFERRED by a task, not raised inline. The adapters build the instance from first-render
 * props and apply a later `author` from an effect, and StrictMode builds, destroys and
 * rebuilds the instance before either; a report raised at construction would name a
 * misconfiguration those hosts fix a moment later. `stillMissing` is asked when the task
 * runs, so an author that arrived or an editor that was destroyed in between raises nothing.
 */
export function createSuggestingConfigurationReporter(input: {
  /** True while the author is still missing and the editor is still alive. */
  readonly stillMissing: () => boolean;
  /** True when a host handler is subscribed to the editor's `error` event. */
  readonly hasListener: () => boolean;
  readonly emit: (error: EditorError) => void;
  readonly log?: (message: string) => void;
}): SuggestingConfigurationReporter {
  let reported = false;
  let pending: ReturnType<typeof setTimeout> | null = null;
  const log = input.log ?? ((message: string) => console.error(message));
  return {
    report(rejection) {
      if (rejection !== SUGGESTING_AUTHOR_REASON || reported || pending !== null) return;
      pending = setTimeout(() => {
        pending = null;
        if (!input.stillMissing()) return;
        reported = true;
        const message =
          `${SUGGESTING_AUTHOR_REASON}. Edits are not tracked until an author is set ` +
          '(the author option at construction, setAuthor(), or the adapter author prop).';
        input.emit(editorError('suggestingNeedsAuthor', message));
        if (!input.hasListener()) log(`[@docx-editor.dev/core] ${message}`);
      }, 0);
    },
    dispose() {
      if (pending !== null) clearTimeout(pending);
      pending = null;
    },
  };
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
  if (!input.hasAuthor) return { mode: null, rejection: DOCUMENT_TRACKING_AUTHOR_REASON };
  return { mode: 'suggesting', rejection: null };
}

/** Refuse editing when document protection permits tracked changes only. */
export function documentEditingModeRestriction(
  tracking: DocumentTrackingSettings,
  next: DocumentEditingMode
): CommandRefusal | null {
  if (next !== 'editing' || !tracking.restrictedToTrackedChanges) return null;
  return {
    ok: false,
    code: 'locked',
    reason: 'this document permits editing only as tracked changes',
  };
}
