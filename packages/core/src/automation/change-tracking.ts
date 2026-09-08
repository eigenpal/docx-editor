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
    if (!supported) return refused('Office-shaped tracking mode is supported by server hosts only');
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
  if (state.mode === 'Off' || !isAutomationCommand(operation)) return null;
  if (operation.op === 'insertText') return null;
  if (operation.op === 'replaceSpan' && !('body' in operation.span)) return null;
  // Decisions and annotations do not author tracked document content.
  if (
    [
      'insertComment',
      'replyToComment',
      'deleteComment',
      'setCommentResolved',
      'acceptRevision',
      'rejectRevision',
      'acceptAllRevisions',
      'rejectAllRevisions',
      'selectSpan',
      'selectBookmark',
    ].includes(operation.op)
  )
    return null;
  return refused(`${operation.op} does not support TrackMineOnly; no permanent edit was applied`);
}
