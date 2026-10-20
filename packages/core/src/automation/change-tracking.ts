// Host-local tracking state is staged with each batch and published only after success.
import { isAutomationCommand, type AutomationOperation } from './operations.ts';
import type { PlannedOperation } from './plan.ts';
import { revisionDateNow } from './revision-date.ts';
import { isValidXmlText } from '../store/package/sinks.ts';

/** Which change-tracking rule refused an operation, carried as the error `detail`. */
export type ChangeTrackingRefusal =
  | 'change-tracking-unsupported-host'
  | 'change-tracking-mode-unsupported'
  | 'change-tracking-author-required'
  | 'change-tracking-operation-unsupported';

export interface LocalTrackingState {
  readonly mode: 'Off' | 'TrackMineOnly';
  readonly author?: string;
}
export function trackingStep(
  operation: AutomationOperation,
  supported: boolean,
  state: LocalTrackingState
): { readonly step: PlannedOperation; readonly state: LocalTrackingState } | null {
  // `detail` names which tracking rule refused, so the runtime can give the public hint for it.
  const refused = (message: string, detail: ChangeTrackingRefusal) => ({
    state,
    step: {
      ok: false as const,
      error: { code: 'unsupported-capability' as const, message, detail },
    },
  });
  if (operation.op === 'getChangeTrackingMode' || operation.op === 'setChangeTrackingMode') {
    if (!supported)
      return refused(
        'this host does not support runtime-local change tracking',
        'change-tracking-unsupported-host'
      );
    if (operation.op === 'getChangeTrackingMode')
      return {
        state,
        step: { ok: true, kind: 'query', value: { kind: 'text', text: state.mode } },
      };
    if (operation.mode !== 'Off' && operation.mode !== 'TrackMineOnly')
      return refused(
        'TrackAll requires shared tracking enforcement for every peer and is not supported',
        'change-tracking-mode-unsupported'
      );
    if (
      operation.mode === 'TrackMineOnly' &&
      (typeof operation.author !== 'string' ||
        !operation.author.trim() ||
        !isValidXmlText(operation.author))
    )
      return refused(
        'TrackMineOnly requires a non-empty XML-safe runtime author',
        'change-tracking-author-required'
      );
    return {
      state: {
        mode: operation.mode,
        ...(operation.mode === 'TrackMineOnly' ? { author: operation.author!.trim() } : {}),
      },
      step: { ok: true, kind: 'query', value: { kind: 'applied' } },
    };
  }
  if (state.mode === 'Off' || supportsTrackedAutomationOperation(operation)) return null;
  return refused(
    `${operation.op} does not support TrackMineOnly; no permanent edit was applied`,
    'change-tracking-operation-unsupported'
  );
}

/** The editing profile authors tracked text and property changes; annotations and decisions remain available. */
export function supportsTrackedAutomationOperation(operation: AutomationOperation): boolean {
  if (!isAutomationCommand(operation) || operation.op === 'setChangeTrackingMode') return true;
  if (operation.op === 'insertText') return true;
  // A line break is a text write; a tracked whole-story replacement is not supported.
  if (operation.op === 'insertBreak')
    return (
      operation.breakType === 'Line' &&
      !(operation.location === 'Replace' && 'body' in operation.span)
    );
  if (operation.op === 'insertTable' || operation.op === 'insertTableRows') return true;
  // A complex field, or one equation, in one `w:ins`; a field result joins its own pending
  // insertion, and a field deletion takes back the author's own pending field. Each planner
  // refuses the forms it has no tracked shape for.
  if (['insertField', 'insertOoxml', 'setFieldResult', 'deleteField'].includes(operation.op))
    return true;
  if (operation.op === 'updateTable' || operation.op === 'updateTableCell') return true;
  if (operation.op === 'replaceSpan' && !('body' in operation.span)) return true;
  // Strikes the paragraph's text and mark; the planner refuses a paragraph with no next one.
  if (operation.op === 'deleteParagraph') return true;
  return [
    'insertContentControl',
    'setContentControlProperties',
    'startNewList',
    'setListLevelFormat',
    'attachToList',
    'detachFromList',
    'setListLevel',
    'insertParagraph',
    'setFont',
    'setStyle',
    'setParagraphFormat',
    'proposeInsertion',
    'proposeDeletion',
    'proposeReplacement',
    'insertComment',
    'replyToComment',
    'deleteComment',
    'setCommentResolved',
    'acceptRevision',
    'rejectRevision',
    'resolveRevisionBatch',
    'setRevisionAuthorBatch',
    'acceptAllRevisions',
    'rejectAllRevisions',
    'selectSpan',
    'selectBookmark',
    // Bookmarks are not revisions: their markers carry no author, so they write directly.
    'insertBookmark',
    'deleteBookmark',
  ].includes(operation.op);
}

/** Reuse canonical revisions so review decisions restore text, paragraph breaks, and properties. */
export function trackPlannedChanges(
  operation: AutomationOperation,
  plan: PlannedOperation,
  author: string | undefined
): PlannedOperation {
  if (
    !author ||
    ![
      'setFont',
      'setStyle',
      'setParagraphFormat',
      'insertParagraph',
      'attachToList',
      'detachFromList',
      'setListLevel',
    ].includes(operation.op) ||
    !plan.ok ||
    plan.kind !== 'command'
  )
    return plan;
  const revision = { author, date: revisionDateNow() };
  return {
    ...plan,
    ops: plan.ops.map((op) => {
      if (op.op === 'insertText') return { ...op, revision };
      if (op.op === 'splitParagraph')
        return {
          op: 'splitParagraphMany' as const,
          paragraphId: op.paragraphId,
          offsets: [op.offset],
          revision,
        };
      if (
        op.op === 'setRunProperties' ||
        op.op === 'setParagraphProperties' ||
        op.op === 'setParagraphMarkProperties' ||
        op.op === 'setListNumbering' ||
        op.op === 'setListLevel'
      )
        return { ...op, revision };
      throw new Error('Formatting plan contains an operation without property revision support');
    }),
  };
}
