import type { AutomationOperation } from './operations.ts';
import type { AutomationHandleTable } from './handles.ts';
import type { AutomationPackageReads, AutomationStoryReads } from './reads.ts';
import type { PlannedOperation } from './plan.ts';
import { resolveSpanRef } from './spans.ts';
import { isTableNested } from '../store/store/tree-op-section-address.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';

/** Page/section breaks are structural mutations, with one atomic store transaction. */
export function planBreakOperation(
  operation: Extract<AutomationOperation, { op: 'insertBreak' }>,
  handles: AutomationHandleTable,
  reads: AutomationPackageReads,
  admit: (
    story: AutomationStoryReads,
    paragraphId: string,
    createdCount: number
  ) => PlannedOperation | null
): PlannedOperation {
  const refuse = (message: string): PlannedOperation => ({
    ok: false,
    error: { code: 'unsupported-content', message },
  });
  if (operation.breakType !== 'Page' && operation.breakType !== 'SectionNext')
    return refuse('only Page and SectionNext breaks are supported');
  if (!['Before', 'After', 'Start', 'End', 'Replace'].includes(operation.location))
    return refuse('invalid break insertion location');
  const resolved = resolveSpanRef(operation.span, handles, reads);
  if (!resolved.ok) return { ok: false, error: { code: resolved.code, message: resolved.detail } };
  const range = resolved.value;
  if (!range) return refuse('empty story has no break position');
  const point =
    operation.location === 'After' || operation.location === 'End' ? range.end : range.start;
  const story = reads.story(point.story);
  if (!story) return refuse('missing story');
  if (operation.location === 'Replace' && range.start.paragraphId !== range.end.paragraphId)
    return refuse('break replacement must remain in one paragraph');
  const section = operation.breakType === 'SectionNext';
  if (section && (story.story.kind !== 'body' || isTableNested(story.part, point.paragraphId)))
    return refuse('section breaks require a body paragraph outside a table');
  const conflict = admit(story, point.paragraphId, section ? 1 : 0);
  if (conflict) return conflict;
  const ops: TreeDocOp[] = [];
  if (operation.location === 'Replace' && range.end.offset > range.start.offset)
    ops.push({
      op: 'deleteText',
      paragraphId: point.paragraphId,
      start: range.start.offset,
      end: range.end.offset,
    });
  if (section)
    ops.push(
      { op: 'splitParagraph', paragraphId: point.paragraphId, offset: point.offset },
      { op: 'setSectionMark', paragraphId: point.paragraphId, breakType: 'nextPage' }
    );
  else ops.push({ op: 'insertPageBreak', paragraphId: point.paragraphId, offset: point.offset });
  return {
    ok: true,
    kind: 'command',
    story: story.story,
    ops,
    answer: () => ({ kind: 'applied' }),
  };
}
