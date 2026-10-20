/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The runtime's own error vocabulary.
//
// DocxEditor owns every code here. Three of them — `PropertyNotLoaded`, `InvalidObjectPath`,
// `NotSupported` — carry the meanings a batching object model has to have if `load`/`sync` is
// to mean anything at all, and the compatibility contract names them; the rest are this
// runtime's, chosen to make each refusal distinguishable from every other.
//
// TWO RULES, both of which exist because an SDK error is a public API:
//
// STABLE CODES. `code` is the thing to branch on, and it never changes shape. A consumer that
// handles `PropertyNotLoaded` by loading and syncing again must keep working across versions,
// so codes are added rather than repurposed.
//
// NOTHING FROM THE ENGINE IN THE MESSAGE. The host answers refusals with its own codes and
// details — a store rejection reason, an opaque handle ref, an offset range. None of it is
// copied into a thrown error. A ref in a message is a name a consumer can start depending on,
// and a store's rejection reason is an implementation detail that would become a documented
// one the moment somebody matched on it. What a consumer gets instead is a stable code, a
// fixed sentence, and `target` — the consumer-facing path of the object or property involved,
// which is the only identifier they wrote themselves.

import type { DiagnosticCode } from '@docx-editor.dev/core/automation';
import { explainDiagnostic } from '@docx-editor.dev/core/automation';

/** What went wrong, as a value a consumer may branch on. */
export type DocxEditorErrorCode =
  /** A property was read before a `load(...)` for it completed in a `sync()`. */
  | 'PropertyNotLoaded'
  /** A `ClientResult` value was read before the sync that fills it. */
  | 'ValueNotLoaded'
  /**
   * The object cannot be addressed, in one of three ways.
   *
   * NOT YET: an item accessor answers a proxy the read that names it has not answered for, and it
   * becomes usable at the next `sync()`. NOT ANY MORE: its run ended and nothing tracked it, which
   * is terminal. GONE: the document no longer holds the object, because an edit removed or merged
   * it; `debugInfo.innerError.code` is then `edit.stale-target` and the message says so. One
   * code because from a consumer's side all three are "this object cannot be used here"; the
   * message says which one, because the fix for one is not the fix for the others.
   */
  | 'InvalidObjectPath'
  /** The object still belongs to a run that has not finished, so it cannot be handed over. */
  | 'ObjectInUse'
  /** An argument or load option this API does not accept. */
  | 'InvalidArgument'
  /** Opening the document exceeded a bounded reader resource limit. */
  | 'ResourceLimitExceeded'
  /** The collection has no such item — `getFirst()` on an empty one. */
  | 'ItemNotFound'
  /**
   * The call is outside the supported subset for this host, mode, or content, and nothing
   * changed. Examples: a server has no selection to move; `TrackMineOnly` has no tracked form
   * for the operation; the OOXML or the field result holds content the subset does not take.
   *
   * Never retry the same call. Read `debugInfo.innerError.code` for the rule, then choose a
   * supported call, another mode, or other content.
   */
  | 'NotSupported'
  /**
   * The member or rule is one this API does not implement for the target, and nothing changed.
   * Examples: a range member that a field result does not support; a tracked edit that touches
   * your own pending change or another author's pending structural change.
   *
   * Never retry the same call. Read `debugInfo.innerError.code` for the rule, then read the
   * target again and edit a different range, decide the pending change first, or use another
   * member.
   */
  | 'NotImplemented'
  /**
   * Two calls in one batch make claims on the same paragraph that cannot both hold.
   *
   * A batch is one transaction planned against the state at its start, which stops being
   * unambiguous once two calls restructure the same paragraph. Split them across two `sync()`
   * calls and each gets exactly what it asked for.
   */
  | 'ConflictingChanges'
  /** The request context's `run` has finished, so it can no longer be used. */
  | 'InvalidRequestContext'
  /** The runtime was disposed. Every later operation fails this way. */
  | 'RuntimeDisposed'
  /**
   * The request was built from an older read, so nothing was applied: another writer moved the
   * document, or a range's text moved since the range was read, including by this context's own
   * earlier sync. Read again before retrying.
   */
  | 'StaleDocument'
  /** The host is live but holds no document right now — an editor between mounts. */
  | 'DocumentUnavailable'
  /**
   * A preview is open over the editor, so it refuses this write or a second preview. Commit or
   * discard the open preview first. Browser runtime only.
   */
  | 'PreviewActive'
  /** The preview has ended — committed, discarded, or replaced by a remount — so it cannot commit. */
  | 'PreviewEnded'
  /** The document refused the change, or answered something this runtime cannot use. */
  | 'GeneralException';

/**
 * One sentence per code, and only these sentences.
 *
 * A table rather than call-site strings: it is what makes "no engine detail leaks into a
 * message" checkable instead of aspirational, and `runtime-failures.test.ts` asserts every
 * thrown message is one of these.
 */
const MESSAGES: Readonly<Record<DocxEditorErrorCode, string>> = Object.freeze({
  PropertyNotLoaded:
    'the property has not been loaded. Call load(...) and await context.sync() before reading it.',
  ValueNotLoaded: 'the result has not been filled in yet. Await context.sync() before reading it.',
  InvalidObjectPath:
    'the object cannot be addressed. Await context.sync() after creating an object with an edit. ' +
    'Keep proxies within their run, or use context.trackedObjects.add(...) before the run ends.',
  ObjectInUse:
    'the object still belongs to a run that has not finished. Await that run before passing the ' +
    'object to another one.',
  InvalidArgument: 'the argument is not one this API accepts.',
  ResourceLimitExceeded: 'the document exceeds a supported resource limit.',
  ItemNotFound: 'the collection has no such item.',
  NotSupported:
    'the operation or argument is outside the supported subset for this host, mode, or content.',
  NotImplemented: 'this API does not implement that operation for this target.',
  ConflictingChanges:
    'these operations cannot share one atomic batch. Split them across separate ' +
    'context.sync() calls.',
  InvalidRequestContext: 'the request context has finished. Start another run to continue.',
  RuntimeDisposed: 'the runtime has been disposed.',
  StaleDocument:
    'the document or a range changed after this context read it, so nothing was applied. ' +
    'The change can come from another writer or from an earlier sync of this context.',
  DocumentUnavailable: 'the document is not available right now.',
  PreviewActive:
    'a preview is open over the document. Commit or discard it before writing or opening another.',
  PreviewEnded: 'the preview has ended. Start another preview to show other wording.',
  GeneralException: 'the document could not complete the request.',
});

/**
 * The message for `InvalidObjectPath` when the host reports that the object is gone. Fixed, like
 * every other message, so it names no document content.
 */
const REMOVED_OBJECT_MESSAGE =
  'the object no longer exists in the document. An edit removed or merged it. Read the ' +
  'document again to get a fresh object.';

/** The fixed message for an error, from its code and the diagnostic the engine gave. */
function messageOf(code: DocxEditorErrorCode, diagnostic: DiagnosticCode | undefined): string {
  return code === 'InvalidObjectPath' && diagnostic === 'edit.stale-target'
    ? REMOVED_OBJECT_MESSAGE
    : MESSAGES[code];
}

/**
 * The fields a {@link DocxEditorError} is constructed from.
 *
 * @public
 */
export interface DocxEditorErrorInit {
  /** Which refusal this is. The stable thing to branch on. */
  readonly code: DocxEditorErrorCode;
  /** The resource limit exceeded while opening a document. */
  readonly limit?:
    | 'zip.maxEntries'
    | 'zip.maxTotalBytes'
    | 'zip.maxRatio'
    | 'xml.maxBytes'
    | 'xml.maxElements'
    | 'xml.maxDepth'
    | 'maxXmlParts'
    | 'maxRelationships';

  /**
   * The consumer-facing path of the object or property involved — `document.body.text`, not a
   * handle. Omitted when there is nothing to name.
   */
  readonly target?: string;
  /** The revision the context had read at, for `StaleDocument`. */
  readonly expectedRevision?: number;
  /** The revision the document was actually at, for `StaleDocument`. */
  readonly actualRevision?: number;
  /**
   * The engine's public diagnostic code for this refusal, when it has one. It becomes
   * `debugInfo.innerError`.
   */
  readonly diagnostic?: DiagnosticCode;
}

/**
 * Why the engine refused, as a public diagnostic code with its fixed hint.
 *
 * @public
 */
export interface DocxEditorInnerError {
  /** A stable public diagnostic code, such as `edit.tracked-drawing-delete-unsupported`. */
  readonly code: DiagnosticCode;
  /** The fixed hint for the code: the cause, then the action. Never document content. */
  readonly message: string;
}

/**
 * Debug details in the shape of Office.js `OfficeExtension.DebugInfo`.
 *
 * @public
 */
export interface DocxEditorDebugInfo {
  /** The same code as {@link DocxEditorError.code}. */
  readonly code: DocxEditorErrorCode;
  /** The same message as the error's own. */
  readonly message: string;
  /** The consumer-facing path of the object or property involved, when there is one. */
  readonly errorLocation?: string;
  /**
   * Why the engine refused, when it knows a specific reason. Handle the outer `code`; read
   * `innerError.message` to tell a person or a model what to change.
   */
  readonly innerError?: DocxEditorInnerError;
}

/**
 * Every refusal this runtime throws.
 *
 * Branch on {@link DocxEditorError.code}, never on the message. Codes are stable public API —
 * added rather than repurposed — so a consumer that handles `PropertyNotLoaded` by loading and
 * syncing again keeps working across versions.
 *
 * Nothing from the engine appears in the message. Host rejection reasons, opaque handle refs and
 * offset ranges are all withheld: a ref in a message is a name a consumer can start depending on,
 * and a store's rejection reason would become a documented one the moment somebody matched on it.
 * What a consumer gets instead is a stable code, a fixed sentence, and `target` — the
 * consumer-facing path they wrote themselves.
 *
 * @example
 * ```ts
 * try {
 *   await context.sync();
 * } catch (error) {
 *   if (isDocxEditorError(error) && error.code === 'StaleDocument') {
 *     // Re-read, re-anchor, and reconsider: someone else changed the document first.
 *   }
 * }
 * ```
 *
 * @public
 */
export class DocxEditorError extends Error {
  /** Which refusal this is. Stable across versions; the thing to branch on. */
  readonly code: DocxEditorErrorCode;
  /** For `ResourceLimitExceeded`: the resource limit that prevented opening. */
  readonly limit?: DocxEditorErrorInit['limit'];
  /** Consumer-facing path of the object or property involved, when there is one to name. */
  readonly target?: string;
  /**
   * For `StaleDocument`: the revision the context had last read at, when the refused batch
   * wrote. Absent for a batch that only read, on every host.
   *
   * When it equals {@link DocxEditorError.actualRevision}, the document is where this context
   * last saw it, and a range it holds is out of date: an edit after the range was read (often
   * this context's own earlier sync) moved its text. Search for the text again. When the two
   * differ, another writer changed the document after this context's last read. Read again
   * before you decide.
   */
  readonly expectedRevision?: number;
  /** For `StaleDocument`: the revision the document was actually at. */
  readonly actualRevision?: number;
  /**
   * Debug details, as Office.js `OfficeExtension.Error.debugInfo` has them. `innerError` names
   * the engine's reason with a stable diagnostic code and a fixed hint, when there is one.
   *
   * @example
   * ```ts
   * catch (error) {
   *   if (isDocxEditorError(error) && error.debugInfo.innerError) {
   *     console.warn(error.debugInfo.innerError.code, error.debugInfo.innerError.message);
   *   }
   * }
   * ```
   */
  readonly debugInfo: DocxEditorDebugInfo;

  constructor(init: DocxEditorErrorInit) {
    const base = messageOf(init.code, init.diagnostic);
    const message = init.target ? `${base} (${init.target})` : base;
    super(message);
    this.name = 'DocxEditorError';
    this.code = init.code;
    this.debugInfo = Object.freeze({
      code: init.code,
      message,
      ...(init.target === undefined ? {} : { errorLocation: init.target }),
      ...(init.diagnostic === undefined
        ? {}
        : {
            innerError: Object.freeze({
              code: init.diagnostic,
              message: explainDiagnostic(init.diagnostic).hint,
            }),
          }),
    });
    if (init.limit !== undefined) this.limit = init.limit;
    if (init.target !== undefined) this.target = init.target;
    if (init.expectedRevision !== undefined) this.expectedRevision = init.expectedRevision;
    if (init.actualRevision !== undefined) this.actualRevision = init.actualRevision;
  }
}

/**
 * Whether a caught value is one of ours.
 *
 * By `name` as well as by `instanceof`: a consumer can end up with two copies of this module
 * (a bundle plus a dependency's), and an `instanceof` that fails across them would send a
 * perfectly ordinary `PropertyNotLoaded` down a consumer's unexpected-error path.
 */
export function isDocxEditorError(value: unknown): value is DocxEditorError {
  if (value instanceof DocxEditorError) return true;
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { name?: unknown }).name === 'DocxEditorError' &&
    typeof (value as { code?: unknown }).code === 'string'
  );
}

/** The message this runtime uses for a code, for tests that assert nothing else is thrown. */
export function messageFor(code: DocxEditorErrorCode, diagnostic?: DiagnosticCode): string {
  return messageOf(code, diagnostic);
}

export function fail(init: DocxEditorErrorInit): never {
  throw new DocxEditorError(init);
}
