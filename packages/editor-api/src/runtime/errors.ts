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

/** What went wrong, as a value a consumer may branch on. */
export type DocxEditorErrorCode =
  /** A property was read before a `load(...)` for it completed in a `sync()`. */
  | 'PropertyNotLoaded'
  /** A `ClientResult` value was read before the sync that fills it. */
  | 'ValueNotLoaded'
  /**
   * The object cannot be addressed, in either of the two ways that happens.
   *
   * NOT YET: an item accessor answers a proxy the read that names it has not answered for, and it
   * becomes usable at the next `sync()`. NOT ANY MORE: its run ended and nothing tracked it, which
   * is terminal. One code because from a consumer's side both are "this object cannot be used
   * here"; the message says which one, because the fix for one is not the fix for the other.
   */
  | 'InvalidObjectPath'
  /** The object still belongs to a run that has not finished, so it cannot be handed over. */
  | 'ObjectInUse'
  /** An argument or load option this API does not accept. */
  | 'InvalidArgument'
  /** Text carried a paragraph mark where the API accepts one paragraph's text only. */
  | 'ParagraphMarkInText'
  /** The collection has no such item — `getFirst()` on an empty one. */
  | 'ItemNotFound'
  /** The host cannot do this at all — a capability it reports false. */
  | 'NotSupported'
  /**
   * The member exists in this API's shape but this version does not implement it.
   *
   * Distinct from `NotSupported`, which is about the HOST: a headless document really has no
   * caret, and no version of this library will give it one. This code means the library, not the
   * document, is the limit — so a consumer knows to check the release notes rather than the host.
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
  /** The document moved under a context that had already read from it; nothing was applied. */
  | 'StaleDocument'
  /** The host is live but holds no document right now — an editor between mounts. */
  | 'DocumentUnavailable'
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
    'the object cannot be addressed. An object an item accessor answered is usable after the ' +
    'next await context.sync(); an object whose run has ended is released for good, unless ' +
    'context.trackedObjects.add(...) kept it.',
  ObjectInUse:
    'the object still belongs to a run that has not finished. Await that run before passing the ' +
    'object to another one.',
  InvalidArgument: 'the argument is not one this API accepts.',
  ParagraphMarkInText:
    'text cannot contain a paragraph mark. Use insertParagraph(...) or replaceParagraphs(...).',
  ItemNotFound: 'the collection has no such item.',
  NotSupported: 'this document host does not support that operation.',
  NotImplemented: 'this version does not implement that yet.',
  ConflictingChanges:
    'two changes in this batch affect the same paragraph. Split them across two ' +
    'context.sync() calls.',
  InvalidRequestContext: 'the request context has finished. Start another run to continue.',
  RuntimeDisposed: 'the runtime has been disposed.',
  StaleDocument: 'the document changed after this context read it, so nothing was applied.',
  DocumentUnavailable: 'the document is not available right now.',
  GeneralException: 'the document could not complete the request.',
});

/**
 * The fields a {@link DocxEditorError} is constructed from.
 *
 * @public
 */
export interface DocxEditorErrorInit {
  /** Which refusal this is. The stable thing to branch on. */
  readonly code: DocxEditorErrorCode;
  /**
   * The consumer-facing path of the object or property involved — `document.body.text`, not a
   * handle. Omitted when there is nothing to name.
   */
  readonly target?: string;
  /** The revision the context had read at, for `StaleDocument`. */
  readonly expectedRevision?: number;
  /** The revision the document was actually at, for `StaleDocument`. */
  readonly actualRevision?: number;
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
 *   if (error instanceof DocxEditorError && error.code === 'StaleDocument') {
 *     // Re-read and retry: someone else changed the document first.
 *   }
 * }
 * ```
 *
 * @public
 */
export class DocxEditorError extends Error {
  /** Which refusal this is. Stable across versions; the thing to branch on. */
  readonly code: DocxEditorErrorCode;
  /** Consumer-facing path of the object or property involved, when there is one to name. */
  readonly target?: string;
  /** For `StaleDocument`: the revision the context had read at. */
  readonly expectedRevision?: number;
  /** For `StaleDocument`: the revision the document was actually at. */
  readonly actualRevision?: number;

  constructor(init: DocxEditorErrorInit) {
    const message = init.target ? `${MESSAGES[init.code]} (${init.target})` : MESSAGES[init.code];
    super(message);
    this.name = 'DocxEditorError';
    this.code = init.code;
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
export function messageFor(code: DocxEditorErrorCode): string {
  return MESSAGES[code];
}

export function fail(init: DocxEditorErrorInit): never {
  throw new DocxEditorError(init);
}
