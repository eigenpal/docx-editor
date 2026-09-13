// A missing header/footer is a virtual empty body until its first content write.
import { applyHeaderFooterLifecycleOp } from '../store/package/hf-lifecycle.ts';
import { withPart, type OoxmlPackage } from '../store/package/ooxml-package.ts';
import { applyTreeOp } from '../store/store/tree-ops.ts';
import type { AutomationOperation } from './operations.ts';
import type { BatchPlanner, BatchPlannerHost, PlannedOperation } from './plan.ts';
import { documentReads, type AutomationPackageReads } from './reads.ts';
import type { AutomationHandle } from './protocol.ts';

const refuse = (message: string): PlannedOperation => ({
  ok: false,
  error: { code: 'unsupported-content', message },
});

function bodyHandle(operation: AutomationOperation): AutomationHandle | undefined {
  if (operation.op === 'getText') return operation.target;
  if ('body' in operation) return operation.body as AutomationHandle;
  if (operation.op === 'insertText' && 'body' in operation.at) return operation.at.body;
  if (operation.op === 'replaceSpan' && 'body' in operation.span) return operation.span.body;
  if (operation.op === 'insertParagraph' && 'body' in operation.anchor)
    return operation.anchor.body;
  return undefined;
}

/** Intercept only bodies whose section exists but whose resolved furniture story is absent. */
export function planVirtualFurniture(
  operation: AutomationOperation,
  host: BatchPlannerHost,
  createPlanner: (reads: AutomationPackageReads) => BatchPlanner
): PlannedOperation | null {
  const handle = bodyHandle(operation);
  if (!handle) return null;
  const target = host.handles.resolve(handle, 'body');
  if (
    !target ||
    target.kind !== 'body' ||
    (target.story.kind !== 'header' && target.story.kind !== 'footer')
  )
    return null;
  const story = target.story;
  const pkg = host.reads.package;
  if (!pkg || host.reads.story(story)) return null;
  if (!host.reads.sections()[story.sectionIndex]) return refuse('that section no longer exists');
  if (operation.op === 'getText')
    return { ok: true, kind: 'query', value: { kind: 'text', text: '' } };
  if (operation.op === 'getParagraphs' || operation.op === 'getLists')
    return { ok: true, kind: 'query', value: { kind: 'handles', handles: [] } };
  if (
    operation.op !== 'insertText' &&
    operation.op !== 'replaceSpan' &&
    operation.op !== 'insertParagraph'
  )
    return null;

  type Prepared = {
    readonly pkg: OoxmlPackage;
    readonly planner: BatchPlanner;
    readonly step: Extract<PlannedOperation, { kind: 'command' }>;
  };
  const prepare = (current: OoxmlPackage): Prepared | null => {
    const created = applyHeaderFooterLifecycleOp(current, {
      op: 'createHeaderFooter',
      sectionIndex: story.sectionIndex,
      kind: story.kind,
      variant: story.variant,
      ...(story.variant === 'first' ? { titlePage: true } : {}),
      ...(story.variant === 'even' ? { evenAndOddHeaders: true } : {}),
    });
    if (!created.ok || !created.createdPartName) return null;
    const projected = documentReads(created.package);
    const planner = createPlanner(projected);
    const step = planner.plan(operation);
    if (
      !step.ok ||
      step.kind !== 'command' ||
      step.relate ||
      step.lifecycle ||
      step.packageEdits?.length
    )
      return null;
    let part = created.package.parts.get(created.createdPartName);
    if (!part) return null;
    for (const op of step.ops) {
      const result = applyTreeOp(part, op);
      if (!result.ok) return null;
      part = result.part;
    }
    const next = withPart(created.package, part);
    // Check proxy settlement against the prepared result before entering the write gate.
    if (!planner.settle(documentReads(next)).ok) return null;
    return { pkg: next, planner, step };
  };
  let prepared = prepare(pkg);
  if (!prepared) return refuse('cannot create this header or footer with that content');
  return {
    ok: true,
    kind: 'command',
    story: { kind: 'body' },
    ops: [],
    solitary: true,
    packageEdits: [
      (current) => {
        const applied = prepare(current);
        if (!applied) throw new Error('header/footer creation changed during transaction');
        prepared = applied;
        return applied.pkg;
      },
    ],
    answer: (post) => prepared!.step.answer(post),
  };
}
