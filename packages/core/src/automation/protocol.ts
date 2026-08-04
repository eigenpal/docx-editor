// The automation host protocol.
//
// One interface, two implementations: a headless host that owns a package it opened from
// bytes, and a browser host that borrows the live editor's session. Both answer the same
// operations with the same results, because the operations themselves are implemented once,
// above this protocol, over a canonical package neither host is allowed to bypass.
//
// EVERYTHING HERE IS TRANSPORT-SHAPED ON PURPOSE. A request is data, a response is data, and
// a handle is a name rather than a pointer — so the same host can sit behind a worker
// message port, an HTTP boundary, or nothing at all, without the protocol changing shape at
// the moment it crosses one. That is also why nothing in this file names an `OoxmlNode`, a
// store, or a DOM node: a value a consumer receives must not be a reference into the engine.

import type { AutomationOperation } from './operations.ts';

/** What kind of document object a handle names. */
export type AutomationObjectKind = 'document' | 'body' | 'paragraph';

declare const AUTOMATION_HANDLE_BRAND: unique symbol;

/**
 * An opaque host-minted name for a document object.
 *
 * Branded so a consumer cannot invent one: the only way to hold a ref is to have been given
 * it by the host that minted it. Its CONTENT is deliberately meaningless — it is not a node
 * id, not a part name, not a path. A host that returned engine identity here would hand
 * every consumer a way to address the canonical tree directly, and the next thing to arrive
 * would be a second write path.
 */
export type AutomationHandleRef = string & { readonly [AUTOMATION_HANDLE_BRAND]: 'handle' };

/** A stable reference to one document object, valid for the life of the host that minted it. */
export interface AutomationHandle<K extends AutomationObjectKind = AutomationObjectKind> {
  readonly kind: K;
  readonly ref: AutomationHandleRef;
}

/**
 * What a host supports, fixed at construction and frozen.
 *
 * Immutable because capability is a property of the host, not a mode it can be talked into:
 * a consumer that branched on `capabilities` once must not find the answer different later.
 * A headless host reports `selection`, `scrolling` and `layout` false — it paints nothing and
 * has no reader to move — and refuses those operations rather than approximating them.
 */
export interface AutomationCapabilities {
  /** Reading and editing document content. Every document operation requires it. */
  readonly document: boolean;
  /** Serializing the current document back to DOCX bytes. */
  readonly save: boolean;
  /** Change notification through {@link AutomationHost.subscribe}. */
  readonly events: boolean;
  /** A reader's selection or caret exists and can be addressed. */
  readonly selection: boolean;
  /** The document is displayed in something that can be scrolled to a position. */
  readonly scrolling: boolean;
  /** Paginated layout exists, so pages and page geometry can be asked about. */
  readonly layout: boolean;
}

export type AutomationErrorCode =
  /** `expectedRevision` did not match the host's current revision; nothing was applied. */
  | 'stale-revision'
  /** A handle this host never minted, or one naming a different kind of object. */
  | 'invalid-handle'
  /** A UTF-16 offset that is not an integer inside the target's bounds. */
  | 'invalid-offset'
  /** The operation needs a capability this host reports false. */
  | 'unsupported-capability'
  /** The host has been disposed. Every subsequent call fails this way. */
  | 'disposed'
  /** The canonical mutation path refused the transaction; nothing was applied. */
  | 'transaction-refused'
  /** The operation is not one this protocol version defines. */
  | 'unknown-operation'
  /**
   * The host is live but has no document to act on right now — a browser host whose editor
   * is detached between mounts. Distinct from `disposed`: the host may answer again later.
   */
  | 'document-unavailable';

export interface AutomationError {
  readonly code: AutomationErrorCode;
  /** Human-readable, for a log or a thrown error in a layer above. Never parsed. */
  readonly message: string;
  /** Machine-ish specifics: the offending offset, the store's own rejection reason. */
  readonly detail?: string;
}

/** What an operation answered with. */
export type AutomationValue =
  | { readonly kind: 'handle'; readonly handle: AutomationHandle }
  | { readonly kind: 'handles'; readonly handles: readonly AutomationHandle[] }
  | { readonly kind: 'text'; readonly text: string }
  /** A command that committed. The observable effect is the response's revision/changed. */
  | { readonly kind: 'applied' };

/**
 * One operation's outcome.
 *
 * `skipped` is what makes an atomic batch honest. When a batch fails, every operation other
 * than the one that failed reports `skipped` — including the ones that came BEFORE it and
 * including reads. Reporting those as `ok` would describe a document state that was never
 * published, which is exactly the partial-application illusion the batch exists to prevent.
 */
export type AutomationOperationResult =
  | { readonly status: 'ok'; readonly value: AutomationValue }
  | { readonly status: 'error'; readonly error: AutomationError }
  | { readonly status: 'skipped' };

export interface AutomationBatchRequest {
  /** Queries and commands, in the order they are to be interpreted. */
  readonly operations: readonly AutomationOperation[];
  /**
   * Refuse the whole batch unless the host is at this revision.
   *
   * How an object model built on cached reads stays honest: it read the document at a
   * revision, decided what to write, and says so. Omitted means "apply against whatever the
   * current state is", which is what an unconditional command wants.
   */
  readonly expectedRevision?: number;
}

export interface AutomationBatchResponse {
  /** True only when every operation succeeded and any commands committed. */
  readonly ok: boolean;
  /** One entry per requested operation, in request order. */
  readonly results: readonly AutomationOperationResult[];
  /** The host's revision AFTER the batch. Unchanged when nothing committed. */
  readonly revision: number;
  /** Whether the batch moved the document. False for a read-only or refused batch. */
  readonly changed: boolean;
}

export type AutomationSaveResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly error: AutomationError };

/** The document moved. Coarse on purpose: a consumer re-reads what it cares about. */
export interface AutomationChangeEvent {
  readonly revision: number;
}

export type AutomationUnsubscribe = () => void;

export interface AutomationHost {
  readonly capabilities: AutomationCapabilities;
  /** Monotonic revision of the document this host acts on. */
  revision(): number;
  /**
   * Run one ordered batch.
   *
   * Queries answer against the state as of the START of the batch; every command in the
   * batch commits as ONE transaction at its end. So a batch is one revision, one undo unit
   * and one change event however many commands it carries — and if any operation is refused,
   * nothing is written at all.
   */
  execute(request: AutomationBatchRequest): AutomationBatchResponse;
  /** The current document as DOCX bytes, through the normalizing serializer. */
  save(): AutomationSaveResult;
  /** Change notification. Returns an unsubscribe that is safe to call more than once. */
  subscribe(listener: (event: AutomationChangeEvent) => void): AutomationUnsubscribe;
  /** Release everything this host holds. Idempotent; every later call fails `disposed`. */
  dispose(): void;
}
