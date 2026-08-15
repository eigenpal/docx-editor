// The one host implementation.
//
// INTERNAL composition factory. It is not exported from the lane's public surface, because a
// consumer that could build a host over its own port could build a second document model —
// which is the exact thing the lane exists to prevent. Both shipped hosts (`server-host.ts`
// here, and the browser adapter in the editor lane) call this with a port over the SAME
// canonical package and the SAME `TreeDocumentStore.transact` write path.
//
// THE BATCH RULE, stated once because everything else follows from it:
//
//   plan every operation in order, then commit every command in one transaction.
//
// Planning is pure. A query answers from the package as of the start of the batch; a command
// is validated and turned into a `TreeDocOp` without touching anything. If planning or the
// commit fails, no transaction is opened or it is refused whole, and the response reports the
// failing operation with a code and everything else as `skipped`. There is no path through
// this file that writes part of a batch.

import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';
import { createHandleTable } from './handles.ts';
import { createBatchPlanner, type PlannedOperation } from './plan.ts';
import { documentReads, type AutomationPackageReads } from './reads.ts';
import type { AutomationOperation } from './operations.ts';
import type {
  AutomationBatchRequest,
  AutomationBatchResponse,
  AutomationCapabilities,
  AutomationChangeEvent,
  AutomationError,
  AutomationErrorCode,
  AutomationHost,
  AutomationOperationResult,
  AutomationSaveResult,
  AutomationUnsubscribe,
} from './protocol.ts';
import type {
  AutomationCommentWrite,
  AutomationDocumentPort,
  InsertCustomNodeWrite,
} from './document-port.ts';
import type { StoryScope } from '../store/store/tree-package-store.ts';

export interface AutomationHostComposition {
  readonly port: AutomationDocumentPort;
  readonly capabilities: AutomationCapabilities;
}

const SKIPPED: AutomationOperationResult = Object.freeze({ status: 'skipped' as const });

function automationError(
  code: AutomationErrorCode,
  message: string,
  detail?: string
): AutomationError {
  return Object.freeze(detail === undefined ? { code, message } : { code, message, detail });
}

/** Map a store story-transaction refusal onto the protocol code a caller can handle. */
function storeTransactionError(reason: string): AutomationError {
  const unsupported =
    reason === 'unsupported-revision' || reason.startsWith('unsupported-revision:');
  return automationError(
    unsupported ? 'unsupported-revision' : 'transaction-refused',
    unsupported
      ? 'that story contains a tracked change this engine cannot resolve'
      : 'the document store refused the transaction',
    reason
  );
}

/**
 * A batch that answered nothing: the failure at its index, `skipped` everywhere else.
 *
 * Including for the operations BEFORE the failure, and including reads. See
 * `AutomationOperationResult` — reporting those as `ok` would describe a state that was never
 * published.
 */
function refuse(
  operations: readonly unknown[],
  index: number,
  error: AutomationError,
  revision: number
): AutomationBatchResponse {
  return {
    ok: false,
    results: operations.map((_, at) => (at === index ? { status: 'error', error } : SKIPPED)),
    revision,
    changed: false,
  };
}

export function createAutomationHost(composition: AutomationHostComposition): AutomationHost {
  const { port } = composition;
  const capabilities = Object.freeze({ ...composition.capabilities });
  const handles = createHandleTable();
  const listeners = new Set<(event: AutomationChangeEvent) => void>();
  let disposed = false;
  /** Reads keyed on package IDENTITY: packages are immutable, so an edit replaces the key. */
  let reads: { readonly pkg: OoxmlPackage; readonly value: AutomationPackageReads } | null = null;

  // Only wired when the host claims events. A capability that is false must not fire.
  const unsubscribePort = capabilities.events
    ? port.subscribe(() => {
        if (disposed) return;
        const event: AutomationChangeEvent = Object.freeze({ revision: port.revision() });
        for (const listener of [...listeners]) listener(event);
      })
    : () => {};

  const readsOf = (pkg: OoxmlPackage): AutomationPackageReads => {
    if (reads && reads.pkg === pkg) return reads.value;
    const value = documentReads(pkg);
    reads = { pkg, value };
    return value;
  };

  const execute = (request: AutomationBatchRequest): AutomationBatchResponse => {
    const operations: readonly AutomationOperation[] = Array.isArray(request?.operations)
      ? request.operations
      : [];
    const revision = port.revision();
    if (disposed) {
      return refuse(operations, 0, automationError('disposed', 'this host was disposed'), revision);
    }
    if (!capabilities.document) {
      return refuse(
        operations,
        0,
        automationError('unsupported-capability', 'this host has no document', 'document'),
        revision
      );
    }
    const pkg = port.currentPackage();
    if (!pkg) {
      return refuse(
        operations,
        0,
        automationError('document-unavailable', 'this host holds no document right now'),
        revision
      );
    }
    if (request.expectedRevision !== undefined && request.expectedRevision !== revision) {
      return refuse(
        operations,
        0,
        automationError(
          'stale-revision',
          'the document moved since that revision',
          `expected ${String(request.expectedRevision)}, at ${revision}`
        ),
        revision
      );
    }

    const planner = createBatchPlanner({
      handles,
      reads: readsOf(pkg),
      capabilities,
      ...(port.select ? { select: port.select.bind(port) } : {}),
    });

    // PLAN EVERYTHING FIRST. A query's answer is final here; a command's is a closure, because
    // a paragraph a command creates has no identity until the transaction lands.
    const planned: Extract<PlannedOperation, { readonly ok: true }>[] = [];
    /**
     * The batch's ops, in planned order, as thunks.
     *
     * Thunks because of the hyperlink: a command naming an external target has no ops until the
     * relationship exists, and the relationship must not exist until the owner's write gate has let
     * the batch through. Holding a thunk per command keeps the ops in the order they were planned —
     * appending the late ones at the end would reorder a batch against itself.
     */
    const stages: ((relate: (url: string) => string | null) => readonly TreeDocOp[] | null)[] = [];
    /** The one package-level op a batch may hold, which travels alone. See the planner. */
    let lifecycle: TreeDocOp | null = null;
    /** Comment deletes can batch; reply/resolve remain solitary by planner rule. */
    const commentWrites: AutomationCommentWrite[] = [];
    let commentWriteScope: StoryScope | null = null;
    /** The id the comment write minted, which only the port can say. */
    let mintedComment: string | undefined;
    /** The one custom-node write a batch may hold, solitary and its own commit for the same reason. */
    let customNodeWrite: { write: InsertCustomNodeWrite; scope: StoryScope } | null = null;
    let firstCommand = -1;
    for (let index = 0; index < operations.length; index += 1) {
      const step = planner.plan(operations[index]!);
      if (!step.ok) return refuse(operations, index, step.error, revision);
      planned.push(step);
      if (step.kind === 'command') {
        if (firstCommand < 0) firstCommand = index;
        if (step.lifecycle) lifecycle = step.ops[0] ?? null;
        else if (step.relate) {
          const pending = step.relate;
          stages.push((relate) => {
            const relationshipId = relate(pending.url);
            return relationshipId === null ? null : pending.ops(relationshipId);
          });
        } else {
          const { ops } = step;
          stages.push(() => ops);
        }
      } else if (step.kind === 'commentWrite') {
        if (firstCommand < 0) firstCommand = index;
        commentWrites.push(step.write);
        commentWriteScope = planner.writeScope ?? { kind: 'body' };
      } else if (step.kind === 'customNodeWrite') {
        if (firstCommand < 0) firstCommand = index;
        customNodeWrite = { write: step.write, scope: planner.writeScope ?? { kind: 'body' } };
      }
    }

    let changed = false;
    if (commentWrites.length > 0) {
      const applied = port.applyCommentWrites(commentWrites, commentWriteScope ?? { kind: 'body' });
      if (!applied.ok) {
        return refuse(
          operations,
          firstCommand < 0 ? 0 : firstCommand,
          automationError(
            'transaction-refused',
            'the document store refused the comment write',
            applied.reason
          ),
          revision
        );
      }
      changed = applied.changed;
      mintedComment = applied.commentId;
    }
    if (customNodeWrite) {
      const applied = port.applyCustomNodeWrite(customNodeWrite.write, customNodeWrite.scope);
      if (!applied.ok) {
        return refuse(
          operations,
          firstCommand < 0 ? 0 : firstCommand,
          automationError(
            'transaction-refused',
            'the document store refused the custom-node write',
            applied.reason
          ),
          revision
        );
      }
      changed = applied.changed;
    }
    if (lifecycle) {
      const applied = port.applyLifecycle(lifecycle);
      if (!applied.ok) {
        return refuse(
          operations,
          firstCommand < 0 ? 0 : firstCommand,
          automationError(
            'transaction-refused',
            'the document store refused the transaction',
            applied.reason
          ),
          revision
        );
      }
      changed = applied.changed;
    }
    if (stages.length > 0) {
      // THE STORY THE BATCH PINNED. One transaction against one story, named by the planner
      // rather than assumed to be the body — a header edit committed against the body scope
      // would refuse ids the body does not hold.
      //
      // The ops are built by the OWNER, once it has decided the batch may write: see
      // `AutomationStagedOps`. Everything the planner could decide is already decided; what is left
      // is the relationship a link needs, which cannot be minted before the gate.
      const applied = port.apply(
        (relate) => {
          const built: TreeDocOp[] = [];
          for (const stage of stages) {
            const ops = stage(relate);
            if (ops === null) return null;
            built.push(...ops);
          }
          return built;
        },
        planner.writeScope ?? { kind: 'body' }
      );
      if (!applied.ok) {
        return refuse(
          operations,
          firstCommand < 0 ? 0 : firstCommand,
          storeTransactionError(applied.reason),
          revision
        );
      }
      changed = applied.changed;
    }

    // The committed state, which is the previous one when nothing was written.
    const after = port.currentPackage();
    if (!after) {
      return refuse(
        operations,
        0,
        automationError('document-unavailable', 'this host holds no document right now'),
        revision
      );
    }
    const post = readsOf(after);
    const settled = planner.settle(post);
    if (!settled.ok) {
      return refuse(
        operations,
        firstCommand < 0 ? 0 : firstCommand,
        automationError(
          'transaction-refused',
          'the transaction did not produce the document the batch planned',
          settled.detail
        ),
        port.revision()
      );
    }

    const results: AutomationOperationResult[] = planned.map((step) => ({
      status: 'ok',
      value:
        step.kind === 'query'
          ? step.value
          : step.kind === 'customNodeWrite'
            ? step.answer(post)
            : step.answer(post, mintedComment),
    }));
    return { ok: true, results, revision: port.revision(), changed };
  };

  return {
    capabilities,
    revision: () => port.revision(),
    execute,
    save(): AutomationSaveResult {
      if (disposed) {
        return { ok: false, error: automationError('disposed', 'this host was disposed') };
      }
      if (!capabilities.save) {
        return {
          ok: false,
          error: automationError('unsupported-capability', 'this host cannot save', 'save'),
        };
      }
      const bytes = port.save();
      if (!bytes) {
        return {
          ok: false,
          error: automationError('document-unavailable', 'this host holds no document right now'),
        };
      }
      return { ok: true, bytes };
    },
    subscribe(listener): AutomationUnsubscribe {
      if (disposed || !capabilities.events) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      unsubscribePort();
      port.dispose();
      reads = null;
    },
  };
}
