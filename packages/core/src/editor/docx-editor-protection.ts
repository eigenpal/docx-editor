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

/**
 * The published reason when enforcing protection ends a suggesting session.
 *
 * Distinct from the gate's own refusal: that one answers "why can I not enter this mode", this
 * one answers "why did the mode I was in just change under me".
 */
export const PROTECTION_ENDS_SUGGESTING_REASON =
  'this document is protected for filling in forms; suggestions cannot be tracked here';

/** A store rejection code turned into a sentence a reader can act on. */
function refusalFor(reason: string): ExecResult {
  if (reason === 'password') {
    return { ok: false, code: 'locked', reason: PASSWORD_PROTECTION_REASON };
  }
  if (reason === 'other-restriction') {
    return {
      ok: false,
      code: 'locked',
      reason:
        'this document declares a different editing restriction; open it in Word to change that',
    };
  }
  if (reason === 'no-change') {
    return { ok: false, code: 'invalidArgs', reason: 'the document protection is already set' };
  }
  return { ok: false, code: 'unsupported', reason: 'document protection could not be written' };
}

/** Word asks for the password before it stops the protection; this editor verifies none. */
const PASSWORD_PROTECTION_REASON =
  'this document is protected with a password; open it in Word to change that';

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
  /**
   * Publish the outcome: enter `mode` when one is named, publish `reason` or clear the
   * standing one, then notify. One port, because the two outcomes are one moment — enforcing
   * protection ENDS a suggesting session, and lifting it clears the reason that said so.
   */
  readonly settle: (mode: DocumentEditingMode | null, reason: string | null) => void;
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
    // `mode: 'view'` is the HOST declaring the session read-only, and it outranks everything.
    if (deps.hostViewOnly()) {
      return { ok: false, code: 'locked', reason: 'this document was opened for viewing' };
    }
    // Viewing MODE is deliberately not a refusal. A read-only document opens viewing BECAUSE
    // it is protected, so refusing here would leave the reader looking at a lock with no way
    // to open it — and Word keeps Restrict Editing reachable whatever the view.
    // Word asks for the password before it stops the protection. This editor never verifies
    // one, so it never lifts a protection that was set with one.
    if (current.enforced && current.password) {
      return { ok: false, code: 'locked', reason: PASSWORD_PROTECTION_REASON };
    }
    // A document that declares a different restriction is not this row's to rewrite: enforcing
    // `forms` over `readOnly` would WEAKEN it, and the pressed state would make off-then-on
    // look like a round trip.
    if (!current.enforced && current.edit !== 'none' && current.edit !== 'forms') {
      return {
        ok: false,
        code: 'locked',
        reason:
          'this document declares a different editing restriction; open it in Word to change that',
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
      if (!applied.ok) return refusalFor(applied.reason);
      // Word greys Track Changes out under forms protection; a session that was suggesting
      // cannot go on suggesting into a document that now refuses to track. Editing mode is the
      // one mode still permitted, and the pill says why it moved.
      // Enforcing protection ends a suggesting session, because Word does not track changes
      // in a document protected for forms. Lifting clears the reason that said so: left
      // standing, the snapshot told the host the document was protected after it was not.
      const ends = enforce && deps.editingMode() === 'suggesting';
      deps.settle(ends ? 'editing' : null, ends ? PROTECTION_ENDS_SUGGESTING_REASON : null);
      return { ok: true, changed: true };
    },
  };
}
