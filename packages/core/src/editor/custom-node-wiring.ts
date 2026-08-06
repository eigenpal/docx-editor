// What the facade owes a registered custom-node module: a diagnostic channel, and the sweep.

import type { PaginatedSurface } from './paginated-surface.ts';
import type { EditorModuleRegistry } from '../contracts/modules.ts';

/**
 * A reporter over one instance's diagnostic listeners.
 *
 * Per instance, never global: a second editor on the page must not hear about a document it did
 * not open. One listener throwing does not stop the others hearing it.
 */
export function customNodeDiagnosticReporter(
  modules: EditorModuleRegistry
): (diagnostic: unknown) => void {
  return (diagnostic) => {
    for (const report of modules.customNodeDiagnostics) {
      try {
        report(diagnostic);
      } catch {
        /* the rest still hear it */
      }
    }
  };
}

/**
 * Collect payloads whose control is gone. Call on OPEN and nowhere else.
 *
 * Word does not delete a payload when a user deletes the control bound to it, so a document can
 * arrive holding payloads for chips that no longer exist. Not on save: a chip cut to the
 * clipboard is unbound for as long as it sits there, and a save mid-cut would destroy the
 * payload the user is about to paste.
 */
export function sweepCustomNodePayloadsOnOpen(
  surface: PaginatedSurface,
  modules: EditorModuleRegistry
): void {
  if (modules.customNodePayloadNamespaces.length === 0) return;
  surface.session.sweepCustomNodePayloads(modules.customNodePayloadNamespaces);
}
