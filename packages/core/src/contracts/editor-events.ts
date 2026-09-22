import type { EditorError, EditorSnapshot } from './editor.ts';
import type { HistoryDiagnostic } from './editor-scope.ts';

/**
 * What `editor.on(...)` can be subscribed to, and what each handler receives.
 *
 * These are PUSH notifications and are not interchangeable with reading `snapshot()`: a snapshot
 * read cannot observe an event that was never emitted, which is why adapter behaviour is asserted
 * against these rather than against the snapshot.
 */
export interface EditorEvents {
  /** A document mutation committed, with the ids it touched. */
  change: (change: DocumentChange) => void;
  /** The selection or its derived formatting moved. */
  selectionChange: (snapshot: EditorSnapshot) => void;
  error: (error: EditorError) => void;
  historyDiagnostic: (diagnostic: HistoryDiagnostic) => void;
}

/**
 * The payload of the `change` event / `onChange`. It carries revision + identity
 * deltas, NOT serialized bytes: serializing a whole DOCX on every keystroke would
 * be prohibitive for large documents. Call `save()` to get bytes on demand.
 */
export interface DocumentChange {
  /** Replacement events must not start another external processing request. Absent for edits. */
  readonly source?: 'load' | 'refresh' | 'recovery';
  /** Package revision after this change — `getDocumentHandle()`'s number, monotonic. */
  readonly revision: number;
  /** Block ids created/deleted/edited by this change, when the engine reports them. */
  readonly created?: readonly string[];
  readonly deleted?: readonly string[];
  readonly dirty?: readonly string[];
}
