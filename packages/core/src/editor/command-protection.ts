import { paragraphsInCells } from '../layout/semantic-cell-selection.ts';
import { paragraphTextOf } from '../store/store/tree-op-apply.ts';
import { isTableEditorCommand } from './table-command-plan.ts';
import type { EditorCommand, ExecResult } from '../contracts/editor.ts';
import { readDocumentProtection } from '../store/package/document-protection.ts';
import { settingsPartOf } from '../store/package/note-properties.ts';
import {
  formsProtectionCommandRefusal,
  type FormsProtectionCommand,
} from '../store/store/forms-protection-command.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { COMMENTS_PROTECTION_REASON, READ_ONLY_PROTECTION_REASON } from './opening-editing-mode.ts';

const formFieldIdentities = new WeakMap<PaginatedSurface, () => string | null>();

/** Share active field affinity with admission without adding it to the public surface API. */
export function registerFormFieldIdentity(
  surface: PaginatedSurface,
  read: () => string | null
): void {
  formFieldIdentities.set(surface, read);
}

export const FORMS_WRITE_REASON = 'this document is protected; only form fields can be filled';

/** Called only for mutating commands. History restores complete, already admitted transactions. */
export function commandProtectionRefusal(
  command: EditorCommand,
  surface: PaginatedSurface
): Exclude<ExecResult, { ok: true }> | null {
  if (
    command.type === 'undo' ||
    command.type === 'redo' ||
    command.type === 'toggleDocumentProtection'
  )
    return null;
  const settings = settingsPartOf(surface.session.currentPackage());
  const protection = readDocumentProtection(settings?.root);
  if (!protection.enforced) return null;
  if (protection.edit === 'readOnly' || protection.edit === 'comments') {
    return {
      ok: false,
      code: 'locked',
      reason:
        protection.edit === 'comments' ? COMMENTS_PROTECTION_REASON : READ_ONLY_PROTECTION_REASON,
    };
  }
  if (protection.edit !== 'forms') return null;
  // Table commands check their complete planned ops, including explicit off-caret targets.
  if (isTableEditorCommand(command)) return null;
  let intent: FormsProtectionCommand['intent'] = 'structure';
  let text: string | undefined;
  let paste = false;
  switch (command.type) {
    case 'insertText':
      intent = 'text';
      text = command.text;
      break;
    case 'paste':
    case 'pasteWithoutFormatting':
      intent = 'text';
      text = command.text;
      paste = true;
      break;
    case 'deleteText':
    case 'cut':
      intent = 'text';
      break;
    case 'toggleMark':
    case 'setMarkAttr':
    case 'pasteFormatting':
      intent = 'runFormat';
      break;
    case 'clearFormatting':
    case 'setAlignment':
    case 'setLineSpacing':
    case 'setParagraphSpacing':
    case 'setIndent':
    case 'adjustIndent':
    case 'toggleList':
    case 'setParagraphStyle':
    case 'setParagraphFormat':
    case 'removeTabMark':
      intent = 'paragraph';
      break;
    case 'setPageSetup':
    case 'setHeaderFooterOptions':
    case 'convertAllNotes':
    case 'insertToc':
    case 'refreshToc':
    case 'replaceAllMatches':
    case 'resolveAllReviewChanges':
    case 'acceptRevision':
    case 'rejectRevision':
    case 'acceptAllRevisions':
    case 'rejectAllRevisions':
      intent = 'document';
      break;
  }
  const selection = surface.state().selection;
  const part = surface.session
    .storyParts()
    .find((part) => selection.head.paragraphId.startsWith(`${part.name}#`));
  if (!part) return { ok: false, code: 'locked', reason: FORMS_WRITE_REASON };
  const cells = surface.state().cellSelection;
  const selections =
    cells && (intent === 'runFormat' || intent === 'paragraph')
      ? [...paragraphsInCells(surface.layout(), cells.cellIds)].map((paragraphId) => ({
          anchor: { paragraphId, offset: 0 },
          head: { paragraphId, offset: (paragraphTextOf(part, paragraphId) ?? '').length },
        }))
      : [selection];
  const refused = selections.some((selected) =>
    formsProtectionCommandRefusal(part, settings, {
      selection: selected,
      intent,
      text,
      paste,
      fieldId: formFieldIdentities.get(surface)?.() ?? undefined,
    })
  );
  return refused ? { ok: false, code: 'locked', reason: FORMS_WRITE_REASON } : null;
}

/** Store codes are never suitable text for the status UI. */
export function writeRejectionReason(
  reason: string,
  root: Parameters<typeof readDocumentProtection>[0]
): string {
  if (reason !== 'locked') return reason;
  const protection = readDocumentProtection(root);
  if (!protection.enforced) return 'this content is locked';
  if (protection.edit === 'comments') return COMMENTS_PROTECTION_REASON;
  return protection.edit === 'forms' ? FORMS_WRITE_REASON : READ_ONLY_PROTECTION_REASON;
}

/** Revision cards and their commands use the same document-wide permission. */
export function reviewChangesLocked(surface: PaginatedSurface | null): boolean {
  return (
    surface !== null &&
    commandProtectionRefusal({ type: 'resolveAllReviewChanges', action: 'accept' }, surface) !==
      null
  );
}

/** Control widgets address a control, so their host gate must not judge the caret's TOC. */
export function createControlWriteRefusal(
  writeRefusal: () => string | null,
  editable: () => boolean
): () => string | null {
  return () => writeRefusal() ?? (editable() ? null : 'the document is read-only');
}
