import type {
  DocumentChange,
  EditorError,
  EditorEvents,
  EditorHostChange,
  EditorSnapshot,
  ReviewItemRevealEvent,
  Unsubscribe,
} from '../contracts/editor.ts';
import type { HistoryDiagnostic } from '../contracts/editor-scope.ts';
import type { EditorDiagnostic } from '../contracts/diagnostics.ts';
import type { ResolvedRevisionMarkup } from '../contracts/revision-markup.ts';

/** Per-instance notifications. Snapshot derivation stays lazy without subscribers. */
export function createEditorEvents(
  snapshot: () => EditorSnapshot,
  hostDocument: () => Document | null = () => null
) {
  /** The host document `hostChange` last reported; `undefined` before the first report. */
  let reportedHost: Document | null | undefined = undefined;
  const handlers: { [E in keyof EditorEvents]: Set<EditorEvents[E]> } = {
    change: new Set(),
    selectionChange: new Set(),
    error: new Set(),
    historyDiagnostic: new Set(),
    diagnostic: new Set(),
    revisionMarkupChange: new Set(),
    reviewItemReveal: new Set(),
    hostChange: new Set(),
  };
  /**
   * Report a new host document. Every attach, move, heal and detach also re-publishes the
   * selection, so the check rides on that emission instead of each of those paths.
   */
  const syncHost = (): void => {
    const current = hostDocument();
    if (current === reportedHost) return;
    // Nothing to report before the first mount: a detached editor that never mounted.
    if (reportedHost === undefined && current === null) return;
    reportedHost = current;
    const value: EditorHostChange = Object.freeze({ document: current });
    for (const handler of [...handlers.hostChange]) handler(value);
  };
  return {
    emitError(error: EditorError, isCurrent?: () => boolean) {
      for (const handler of [...handlers.error]) {
        // A listener can load another document or destroy the editor before the next listener.
        if (isCurrent && !isCurrent()) return;
        handler(error);
      }
    },
    emitDocumentChange(change: DocumentChange) {
      for (const handler of [...handlers.change]) handler(change);
    },
    emitSelectionChange() {
      // `hostChange` rides on this: every mount, move, heal and detach reports the selection,
      // so do not drop a "redundant" selection report from those paths.
      syncHost();
      if (!handlers.selectionChange.size) return;
      const value = snapshot();
      for (const handler of [...handlers.selectionChange]) handler(value);
    },
    emitHistoryDiagnostic(diagnostic: HistoryDiagnostic) {
      for (const handler of [...handlers.historyDiagnostic]) handler(diagnostic);
    },
    emitDiagnostic(event: EditorDiagnostic) {
      for (const handler of [...handlers.diagnostic]) handler(event);
    },
    emitRevisionMarkupChange(value: ResolvedRevisionMarkup) {
      for (const handler of [...handlers.revisionMarkupChange]) handler(value);
    },
    emitReviewItemReveal(event: ReviewItemRevealEvent) {
      const value = Object.freeze({ ...event });
      for (const handler of [...handlers.reviewItemReveal]) handler(value);
    },
    hasErrorHandlers: () => handlers.error.size > 0,
    hasDiagnosticHandlers: () => handlers.diagnostic.size > 0,
    clear() {
      for (const set of Object.values(handlers)) set.clear();
    },
    on<E extends keyof EditorEvents>(event: E, handler: EditorEvents[E]): Unsubscribe {
      handlers[event].add(handler);
      return () => {
        handlers[event].delete(handler);
      };
    },
  };
}
