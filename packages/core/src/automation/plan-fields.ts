import type { TreeDocOp } from '../store/store/tree-ops.ts';
import { effectiveContentLockAt, isBoundAt } from '../store/store/tree-op-nodes.ts';
import type { AutomationHandleTable } from './handles.ts';
import type { AutomationOperation } from './operations.ts';
import type { PlannedOperation } from './plan.ts';
import type { AutomationPackageReads, AutomationStoryReads } from './reads.ts';
import type { AutomationStoryId } from './stories.ts';
import { resolveSpanRef, spanOffsets, storyOfSpanRef } from './spans.ts';
import {
  fieldsInParagraph,
  fieldInsertionParagraph,
  supportedPageFieldCode,
  type AutomationFieldPageContext,
} from './fields.ts';

type FieldOperation = Extract<
  AutomationOperation,
  {
    op:
      | 'getFields'
      | 'getField'
      | 'setFieldCode'
      | 'deleteField'
      | 'updateFieldResult'
      | 'insertField';
  }
>;
const refuse = (
  message: string,
  code: 'unsupported-content' | 'invalid-handle' | 'unsupported-capability' = 'unsupported-content'
): PlannedOperation => ({ ok: false, error: { code, message } });

export function planFields(
  operation: FieldOperation,
  handles: AutomationHandleTable,
  reads: AutomationPackageReads,
  claim: (
    story: AutomationStoryReads,
    paragraphId: string,
    resultOnly?: boolean
  ) => PlannedOperation | null,
  fieldPageContext?: (
    story: AutomationStoryId,
    paragraphId: string,
    fieldNodeId: string
  ) => AutomationFieldPageContext | null
): PlannedOperation {
  if (operation.op === 'getFields' || operation.op === 'insertField') {
    const range = resolveSpanRef(operation.span, handles, reads);
    const storyResult = storyOfSpanRef(operation.span, handles, reads);
    if (!range.ok || !storyResult.ok)
      return refuse('that field range no longer exists', 'invalid-handle');
    const story = storyResult.value;
    if (operation.op === 'getFields') {
      const fields = spanOffsets(range.value, story).flatMap((span) =>
        fieldsInParagraph(story.part, span.paragraphId).filter(
          (field) => field.start >= span.start && field.end <= span.end
        )
      );
      return {
        ok: true,
        kind: 'query',
        value: {
          kind: 'handles',
          handles: fields.map((field) =>
            handles.field(field.paragraphId, field.fieldNodeId, story.story)
          ),
        },
      };
    }
    if (!range.value) return refuse('insert a paragraph before inserting a field');
    if (operation.removeFormatting !== undefined && operation.removeFormatting !== false)
      return refuse('removeFormatting is not supported');
    if (operation.text !== undefined && typeof operation.text !== 'string')
      return refuse('field text must be a string');
    if (operation.fieldType !== undefined && typeof operation.fieldType !== 'string')
      return refuse('field type must be a string');
    const type = operation.fieldType ?? 'Empty';
    let field: 'PAGE' | 'NUMPAGES' | null = null;
    if (type === 'Page' || type === 'NumPages') {
      if (operation.text !== undefined && operation.text.trim() !== '')
        return refuse('field switches are not supported');
      field = type === 'Page' ? 'PAGE' : 'NUMPAGES';
    } else if (type === 'Empty') field = supportedPageFieldCode(operation.text ?? '');
    if (!field) return refuse('only PAGE and NUMPAGES fields are supported');
    const { start, end } = range.value;
    if (!['Before', 'After', 'Start', 'End', 'Replace'].includes(operation.location))
      return refuse('unsupported field insert location');
    if (operation.location === 'Replace' && start.paragraphId !== end.paragraphId)
      return refuse('field replacement requires one paragraph');
    const point = operation.location === 'After' || operation.location === 'End' ? end : start;
    const conflict = claim(story, point.paragraphId);
    if (conflict) return conflict;
    const ops: TreeDocOp[] = [];
    if (operation.location === 'Replace' && end.offset > start.offset)
      ops.push({
        op: 'deleteText',
        paragraphId: start.paragraphId,
        start: start.offset,
        end: end.offset,
      });
    ops.push({
      op: 'insertFragment',
      paragraphId: point.paragraphId,
      offset: point.offset,
      blocks: [fieldInsertionParagraph(field)],
      lastMarkCovered: false,
    });
    return {
      ok: true,
      kind: 'command',
      story: story.story,
      ops,
      answer: (post) => {
        const part = post.story(story.story)?.part;
        const inserted =
          part &&
          fieldsInParagraph(part, point.paragraphId).find((field) => field.start === point.offset);
        if (!inserted) throw new Error('inserted field was not committed');
        return {
          kind: 'handle',
          handle: handles.field(point.paragraphId, inserted.fieldNodeId, story.story),
        };
      },
    };
  }
  const target = handles.resolve(operation.field, 'field');
  if (!target || target.kind !== 'field')
    return refuse('that is not a field handle', 'invalid-handle');
  const story = reads.story(target.story);
  const field =
    story &&
    fieldsInParagraph(story.part, target.paragraphId).find(
      (field) => field.fieldNodeId === target.fieldNodeId
    );
  if (!story || !story.has(target.paragraphId) || !field)
    return refuse('that field no longer exists', 'invalid-handle');
  if (operation.op === 'getField')
    return { ok: true, kind: 'query', value: { kind: 'field', field: { code: field.code } } };
  if (
    field.locked ||
    effectiveContentLockAt(story.part, target.fieldNodeId).content ||
    isBoundAt(story.part, target.fieldNodeId)
  )
    return refuse('field is protected');
  const conflict = claim(story, target.paragraphId, operation.op === 'updateFieldResult');
  if (conflict) return conflict;
  const ops: TreeDocOp[] = [];
  if (operation.op === 'deleteField')
    ops.push({
      op: 'deleteText',
      paragraphId: target.paragraphId,
      start: field.start,
      end: field.end,
    });
  else if (operation.op === 'setFieldCode') {
    if (!supportedPageFieldCode(field.code) || !supportedPageFieldCode(operation.code))
      return refuse('only PAGE and NUMPAGES code writes are supported');
    ops.push({
      op: 'setFieldCode',
      paragraphId: target.paragraphId,
      fieldNodeId: target.fieldNodeId,
      code: operation.code,
    });
  } else {
    const kind = supportedPageFieldCode(field.code);
    if (!kind || !field.rewritable)
      return refuse('this field result cannot be evaluated', 'unsupported-capability');
    const context = fieldPageContext?.(story.story, target.paragraphId, target.fieldNodeId);
    if (
      !context ||
      !Number.isInteger(context.pageNumber) ||
      context.pageNumber < 1 ||
      !Number.isInteger(context.pageCount) ||
      context.pageCount < 1
    )
      return refuse('field update requires actual semantic pagination', 'unsupported-capability');
    const text =
      kind === 'PAGE'
        ? (context.pageNumberText ?? String(context.pageNumber))
        : String(context.pageCount);
    ops.push({
      op: 'refreshFieldResults',
      updates: [{ paragraphId: target.paragraphId, fieldNodeId: target.fieldNodeId, text }],
    });
  }
  return {
    ok: true,
    kind: 'command',
    story: story.story,
    ops,
    answer: () => ({ kind: 'applied' }),
  };
}
