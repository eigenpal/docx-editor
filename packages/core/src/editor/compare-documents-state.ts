import type { CanResult, EditorCommand, ExecResult } from '../contracts/editor.ts';
import type {
  CompareDocumentsChromeHandlers,
  CompareDocumentsDialogSession,
  CompareDocumentsOutcome,
  CompareDocumentsRequest,
} from '../contracts/compare-documents.ts';
import type { CompareDocumentsDialog, ReviewModuleContribution } from '../contracts/modules.ts';
import { readDocumentProtection } from '../store/package/document-protection.ts';
import { settingsPartOf } from '../store/package/note-properties.ts';
import { commandProtectionRefusal } from './command-protection.ts';
import { PRO_REVIEW_REASON } from './opening-editing-mode.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import type { PopupChromeRegistrationOptions } from './popup-sessions.ts';
import { createSessionChrome } from './text-form-field-chrome.ts';

/** Stable refusal while a collaboration session is attached. */
export const COMPARE_COLLABORATION_REASON = 'collaboration-compare-unsupported';
export const COMPARE_FORMS_PROTECTION_REASON =
  'this document is protected; only form fields can be filled';
const COMPARE_PROTECTION_REASON = 'this document is protected against edits';

export interface CompareDocumentsStateHost {
  container(): HTMLElement | null;
  destroyed(): boolean;
  contribution(): ReviewModuleContribution | null;
  translate(): ((key: string) => string) | undefined;
  surface(): PaginatedSurface | null;
  /** Whether the document is open for viewing only (view-only host or viewing mode). */
  viewing(): boolean;
}

const isBytes = (value: unknown): value is Uint8Array =>
  Object.prototype.toString.call(value) === '[object Uint8Array]';

/**
 * Compare documents: the command that records a revised DOCX's differences in the open
 * document as tracked changes, and the dialog session that collects its input.
 *
 * The open document is the original. The engine runs on the live package, so nothing is saved
 * first, and the result installs as ONE package undo unit: undo restores the original in one
 * step, redo reapplies the compare.
 */
export function createCompareDocumentsState(host: CompareDocumentsStateHost) {
  let dialog: CompareDocumentsDialog | null = null;
  let active: CompareDocumentsDialogSession | null = null;
  const chrome = createSessionChrome<CompareDocumentsDialogSession>();

  const canCompare = (): CanResult => {
    if (host.destroyed())
      return { ok: false, code: 'notFound', reason: 'the editor was destroyed' };
    if (!host.contribution()?.compareDocuments)
      return { ok: false, code: 'unsupported', reason: PRO_REVIEW_REASON };
    const surface = host.surface();
    if (!surface) return { ok: false, code: 'notFound', reason: 'no document is open' };
    if (surface.collaborationSession())
      return { ok: false, code: 'unsupported', reason: COMPARE_COLLABORATION_REASON };
    if (host.viewing())
      return { ok: false, code: 'locked', reason: 'the document is open for viewing' };
    const protectedWrite = commandProtectionRefusal(
      { type: 'compareDocuments', revised: new Uint8Array() },
      surface
    );
    if (protectedWrite) return protectedWrite;
    const protection = readDocumentProtection(
      settingsPartOf(surface.session.currentPackage())?.root
    );
    if (protection.enforced && protection.edit === 'forms')
      return { ok: false, code: 'locked', reason: COMPARE_FORMS_PROTECTION_REASON };
    // Tracked-changes and comments protection guard the existing revisions and their authors,
    // which a compare rewrites.
    if (protection.enforced)
      return { ok: false, code: 'locked', reason: COMPARE_PROTECTION_REASON };
    return { ok: true };
  };

  const canOpen = (): CanResult => {
    const result = canCompare();
    if (!result.ok) return result;
    if (!host.contribution()?.createCompareDocumentsDialog)
      return { ok: false, code: 'unsupported', reason: PRO_REVIEW_REASON };
    if (!host.container())
      return { ok: false, code: 'notFound', reason: 'the editor is not attached' };
    return { ok: true };
  };

  const compare = (request: CompareDocumentsRequest): ExecResult & { revisionCount?: number } => {
    const allowed = canCompare();
    if (!allowed.ok) return allowed;
    if (!isBytes(request.revised) || request.revised.byteLength === 0)
      return { ok: false, code: 'invalidArgs', reason: 'the revised document is empty' };
    const surface = host.surface()!;
    surface.flushPendingInput();
    const authorName = request.authorName?.trim() || surface.author();
    const result = host.contribution()!.compareDocuments!(
      surface.session.currentPackage(),
      request.revised,
      {
        ...(authorName ? { authorName } : {}),
        detectFormatChanges: request.detectFormatChanges !== false,
      }
    );
    if (!result.ok) return { ok: false, code: 'invalidArgs', reason: result.message };
    const replaced = surface.session.replacePackage(result.package);
    if (!replaced.ok)
      return {
        ok: false,
        code: 'unsupported',
        reason: `the compare result was refused: ${replaced.reason}`,
      };
    return { ok: true, changed: replaced.change !== null, revisionCount: result.revisionCount };
  };

  const destroyDialog = (): void => {
    if (active) {
      active.cancel();
      return;
    }
    const previous = dialog;
    dialog = null;
    previous?.destroy();
  };

  const createSession = (): CompareDocumentsDialogSession => {
    const controller = new AbortController();
    let running = false;
    const session: CompareDocumentsDialogSession = {
      signal: controller.signal,
      defaultAuthor: host.surface()?.author() ?? '',
      canApply: () =>
        active === session && !controller.signal.aborted && !running && canCompare().ok,
      async apply(request): Promise<CompareDocumentsOutcome> {
        if (!session.canApply()) {
          const refusal = canCompare();
          return { ok: false, message: refusal.ok ? 'the dialog is closed' : refusal.reason };
        }
        running = true;
        // One task so the dialog can paint its busy state before the synchronous compare.
        await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
        try {
          if (controller.signal.aborted) return { ok: false, message: 'the dialog is closed' };
          const result = compare(request);
          if (!result.ok) return { ok: false, message: result.reason };
          session.cancel();
          return { ok: true, revisionCount: result.revisionCount ?? 0 };
        } catch (error) {
          return { ok: false, message: error instanceof Error ? error.message : String(error) };
        } finally {
          running = false;
        }
      },
      cancel() {
        if (controller.signal.aborted) return;
        if (active === session) active = null;
        const previous = dialog;
        dialog = null;
        controller.abort();
        previous?.destroy();
      },
    };
    return session;
  };

  const showNative = (session: CompareDocumentsDialogSession): void => {
    dialog = host.contribution()!.createCompareDocumentsDialog!({
      signal: session.signal,
      defaultAuthor: session.defaultAuthor,
      canApply: session.canApply,
      apply: session.apply,
      cancel: session.cancel,
      container: host.container()!,
      translate: (key) => host.translate()?.(key),
    });
    if (session.signal.aborted) destroyDialog();
    else dialog.open();
  };

  const open = (): ExecResult => {
    const result = canOpen();
    if (!result.ok) return result;
    destroyDialog();
    const session = createSession();
    active = session;
    try {
      if (!chrome.request(session)) showNative(session);
    } catch (error) {
      session.cancel();
      throw error;
    }
    return { ok: true, changed: false };
  };

  return {
    canOpen,
    canCompare,
    open,
    compare,
    destroyDialog,
    register(
      handlers: CompareDocumentsChromeHandlers | null,
      options?: PopupChromeRegistrationOptions
    ) {
      return chrome.register(handlers ?? { onRequest: showNative }, options);
    },
    /** `exec` for the two compare commands; null for every other command. */
    exec(command: EditorCommand): ExecResult | null {
      if (command.type === 'openCompareDocumentsDialog') return open();
      if (command.type !== 'compareDocuments') return null;
      const result = compare(command);
      return result.ok ? { ok: true, changed: result.changed } : result;
    },
    /** `can` for the two compare commands; null for every other command. */
    can(command: EditorCommand): CanResult | null {
      if (command.type === 'openCompareDocumentsDialog') return canOpen();
      return command.type === 'compareDocuments' ? canCompare() : null;
    },
  };
}
