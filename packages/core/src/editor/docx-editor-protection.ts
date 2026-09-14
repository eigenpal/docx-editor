// Word's Protect Document, as an editor command.
//
// Review → Protect Document is one toggle over one setting: enforce filling-in-forms
// protection, or lift whatever protection the document enforces. It is a DOCUMENT edit —
// it writes `settings.xml` and joins the undo history — not a view flag, which is what
// separates it from the paragraph-marks toggle it sits beside in the menu. The state it
// reports is the file's own `w:documentProtection`, read through one reader, so the pressed
// state of the menu row and the store's refusals cannot disagree.
//
// Kept out of `docx-editor.ts` so the composition root stays under its line cap; the facade
// hands in the closures it owns and forwards `can`, `exec`, `isActive` and the snapshot field.

import type {
  CanResult,
  DocumentEditingMode,
  EditorCommand,
  ExecResult,
} from '../contracts/editor.ts';
import {
  NO_DOCUMENT_PROTECTION,
  readDocumentProtection,
  type DocumentProtectionState,
} from '../store/package/document-protection.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';

/** The published reason when enforcing protection ends a suggesting session. */
export const PROTECTION_ENDS_SUGGESTING_REASON =
  'this document is protected for filling in forms; suggestions cannot be tracked here';

export interface DocumentProtectionCommands {
  /** The document's protection, reference-stable while the settings part is unchanged. */
  state(): DocumentProtectionState | null;
  /** Whether the toggle renders pressed: protection is enforced. */
  isActive(): boolean;
  /** `null` for any other command. */
  can(command: EditorCommand): CanResult | null;
  /** `null` for any other command. */
  exec(command: EditorCommand): ExecResult | null;
}

export function createDocumentProtectionCommands(deps: {
  readonly surface: () => PaginatedSurface | null;
  readonly destroyed: () => boolean;
  readonly editingMode: () => DocumentEditingMode;
  /** True when the facade was constructed `mode: 'view'`: read-only for the session. */
  readonly hostViewOnly: () => boolean;
  /** Leave suggesting for editing and publish why; called when protection goes on. */
  readonly leaveSuggesting: (reason: string) => void;
  readonly publish: () => void;
}): DocumentProtectionCommands {
  let seenRoot: unknown = undefined;
  let seenState: DocumentProtectionState | null = null;

  const state = (): DocumentProtectionState | null => {
    const surface = deps.surface();
    if (!surface) return null;
    const root = surface.session.settingsRoot();
    if (root !== seenRoot || seenState === null) {
      seenRoot = root;
      seenState = root ? readDocumentProtection(root) : NO_DOCUMENT_PROTECTION;
    }
    return seenState;
  };

  const refusal = (): CanResult | null => {
    if (deps.destroyed()) {
      return { ok: false, code: 'notFound', reason: 'the editor was destroyed' };
    }
    const current = state();
    if (current === null) return { ok: false, code: 'notFound', reason: 'no document is loaded' };
    if (deps.hostViewOnly()) {
      return { ok: false, code: 'locked', reason: 'this document was opened for viewing' };
    }
    if (deps.editingMode() === 'viewing') {
      return { ok: false, code: 'locked', reason: 'the document is open for viewing' };
    }
    // Word asks for the password before it stops the protection. This editor never verifies
    // one, so it never lifts a protection that was set with one.
    if (current.enforced && current.password) {
      return {
        ok: false,
        code: 'locked',
        reason: 'this document is protected with a password; open it in Word to change that',
      };
    }
    return null;
  };

  return {
    state,
    isActive: () => state()?.enforced === true,
    can(command) {
      if (command.type !== 'toggleDocumentProtection') return null;
      return refusal() ?? { ok: true };
    },
    exec(command) {
      if (command.type !== 'toggleDocumentProtection') return null;
      const refused = refusal();
      if (refused && !refused.ok) return refused;
      const surface = deps.surface()!;
      const enforce = !state()!.enforced;
      const applied = surface.applyHeaderFooterLifecycle?.({
        op: 'setDocumentProtection',
        enforce,
      });
      if (!applied) {
        return { ok: false, code: 'unsupported', reason: 'document protection is not available' };
      }
      if (!applied.ok) return { ok: false, code: 'locked', reason: applied.reason };
      // Word greys Track Changes out under forms protection; a session that was suggesting
      // cannot go on suggesting into a document that now refuses to track. Editing mode is the
      // one mode still permitted, and the pill says why it moved.
      if (enforce && deps.editingMode() === 'suggesting') {
        deps.leaveSuggesting(PROTECTION_ENDS_SUGGESTING_REASON);
      }
      deps.publish();
      return { ok: true, changed: true };
    },
  };
}
