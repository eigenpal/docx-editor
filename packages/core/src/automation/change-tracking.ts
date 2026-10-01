// Host-local tracking state is staged with each batch and published only after success.
import { isAutomationCommand, type AutomationOperation } from './operations.ts';
import type { PlannedOperation } from './plan.ts';
import { isValidXmlText } from '../store/package/sinks.ts';

export interface LocalTrackingState {
  readonly mode: 'Off' | 'TrackMineOnly';
  readonly author?: string;
}
export function trackingStep(
  operation: AutomationOperation,
  supported: boolean,
  state: LocalTrackingState
): { readonly step: PlannedOperation; readonly state: LocalTrackingState } | null {
  const refused = (message: string) => ({
    state,
    step: {
      ok: false as const,
      error: { code: 'unsupported-capability' as const, message, detail: 'changeTrackingMode' },
    },
  });
  if (operation.op === 'getChangeTrackingMode' || operation.op === 'setChangeTrackingMode') {
    if (!supported) return refused('this host does not support runtime-local change tracking');
    if (operation.op === 'getChangeTrackingMode')
      return {
        state,
        step: { ok: true, kind: 'query', value: { kind: 'text', text: state.mode } },
      };
    if (operation.mode !== 'Off' && operation.mode !== 'TrackMineOnly')
      return refused(
        'TrackAll requires shared tracking enforcement for every peer and is not supported'
      );
    if (
      operation.mode === 'TrackMineOnly' &&
      (typeof operation.author !== 'string' ||
        !operation.author.trim() ||
        !isValidXmlText(operation.author))
    )
      return refused('TrackMineOnly requires a non-empty XML-safe runtime author');
    return {
      state: {
        mode: operation.mode,
        ...(operation.mode === 'TrackMineOnly' ? { author: operation.author!.trim() } : {}),
      },
      step: { ok: true, kind: 'query', value: { kind: 'applied' } },
    };
  }
  if (state.mode === 'Off' || supportsTrackedAutomationOperation(operation)) return null;
  return refused(`${operation.op} does not support TrackMineOnly; no permanent edit was applied`);
}

/** The editing profile authors tracked text and property changes; annotations and decisions remain available. */
export function supportsTrackedAutomationOperation(operation: AutomationOperation): boolean {
  if (!isAutomationCommand(operation) || operation.op === 'setChangeTrackingMode') return true;
  if (operation.op === 'insertText') return true;
  if (operation.op === 'insertTable' || operation.op === 'insertTableRows') return true;
  if (operation.op === 'updateTable' || operation.op === 'updateTableCell') return true;
  if (operation.op === 'replaceSpan' && !('body' in operation.span)) return true;
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
    'acceptAllRevisions',
    'rejectAllRevisions',
    'selectSpan',
    'selectBookmark',
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
  const revision = { author, date: new Date().toISOString() };
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
