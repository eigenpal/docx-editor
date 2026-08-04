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
import { documentReads, type AutomationDocumentReads } from './reads.ts';
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
  AutomationValue,
} from './protocol.ts';
import type { AutomationDocumentPort } from './document-port.ts';

export interface AutomationHostComposition {
  readonly port: AutomationDocumentPort;
  readonly capabilities: AutomationCapabilities;
}

const SKIPPED: AutomationOperationResult = Object.freeze({ status: 'skipped' as const });
const APPLIED: AutomationValue = Object.freeze({ kind: 'applied' as const });

function automationError(
  code: AutomationErrorCode,
  message: string,
  detail?: string
): AutomationError {
  return Object.freeze(detail === undefined ? { code, message } : { code, message, detail });
}

/**
 * A planned operation, with the query/command split in the TYPE.
 *
 * A command carries the `TreeDocOp` it will commit, so a command that plans successfully
 * without producing an edit is not expressible — it would otherwise report `applied` while
 * writing nothing, and no runtime check catches that as reliably as not allowing it.
 */
type PlannedOperation =
  | { readonly ok: true; readonly kind: 'query'; readonly value: AutomationValue }
  | {
      readonly ok: true;
      readonly kind: 'command';
      readonly value: AutomationValue;
      readonly op: TreeDocOp;
    }
  | { readonly ok: false; readonly error: AutomationError };

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
  let reads: { readonly pkg: OoxmlPackage; readonly value: AutomationDocumentReads } | null = null;

  // Only wired when the host claims events. A capability that is false must not fire.
  const unsubscribePort = capabilities.events
    ? port.subscribe(() => {
        if (disposed) return;
        const event: AutomationChangeEvent = Object.freeze({ revision: port.revision() });
        for (const listener of [...listeners]) listener(event);
      })
    : () => {};

  const readsOf = (pkg: OoxmlPackage): AutomationDocumentReads => {
    if (reads && reads.pkg === pkg) return reads.value;
    const value = documentReads(pkg);
    reads = { pkg, value };
    return value;
  };

  const plan = (
    operation: AutomationOperation,
    content: AutomationDocumentReads
  ): PlannedOperation => {
    switch (operation.op) {
      case 'getDocument':
        return { ok: true, kind: 'query', value: { kind: 'handle', handle: handles.document() } };

      case 'getBody': {
        if (!handles.resolve(operation.document, 'document')) return invalidHandle('document');
        return { ok: true, kind: 'query', value: { kind: 'handle', handle: handles.body() } };
      }

      case 'getParagraphs': {
        if (!handles.resolve(operation.body, 'body')) return invalidHandle('body');
        const list = content.bodyParagraphIds.map((id) => handles.paragraph(id));
        return { ok: true, kind: 'query', value: { kind: 'handles', handles: list } };
      }

      case 'getText': {
        if (handles.resolve(operation.target, 'body')) {
          return { ok: true, kind: 'query', value: { kind: 'text', text: content.bodyText() } };
        }
        const paragraph = handles.resolve(operation.target, 'paragraph');
        if (!paragraph || paragraph.kind !== 'paragraph') return invalidHandle('body|paragraph');
        const text = content.paragraphText(paragraph.paragraphId);
        // A handle this host minted whose paragraph is no longer in the body: the ref is
        // real, the object is gone. `invalid-handle` rather than empty text, so a consumer
        // holding a stale reference is told rather than shown a plausible answer.
        if (text === null) return invalidHandle('paragraph-not-in-body');
        return { ok: true, kind: 'query', value: { kind: 'text', text } };
      }

      case 'insertText': {
        const paragraph = handles.resolve(operation.paragraph, 'paragraph');
        if (!paragraph || paragraph.kind !== 'paragraph') return invalidHandle('paragraph');
        const text = content.paragraphText(paragraph.paragraphId);
        if (text === null) return invalidHandle('paragraph-not-in-body');
        if (typeof operation.text !== 'string') {
          return {
            ok: false,
            error: automationError('unknown-operation', 'insertText needs text', 'text'),
          };
        }
        const { offset } = operation;
        if (!Number.isInteger(offset) || offset < 0 || offset > text.length) {
          return {
            ok: false,
            error: automationError(
              'invalid-offset',
              'offset is outside the paragraph',
              `${String(offset)} not in 0..${text.length}`
            ),
          };
        }
        return {
          ok: true,
          kind: 'command',
          value: APPLIED,
          op: {
            op: 'insertText',
            paragraphId: paragraph.paragraphId,
            offset,
            text: operation.text,
          },
        };
      }

      default: {
        const unknown = operation as { readonly op?: unknown };
        return {
          ok: false,
          error: automationError(
            'unknown-operation',
            'this host does not implement that operation',
            String(unknown.op)
          ),
        };
      }
    }
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

    const content = readsOf(pkg);
    const results: AutomationOperationResult[] = [];
    const ops: TreeDocOp[] = [];
    let firstCommand = -1;
    for (let index = 0; index < operations.length; index += 1) {
      const operation = operations[index]!;
      const planned = plan(operation, content);
      if (!planned.ok) return refuse(operations, index, planned.error, revision);
      results.push({ status: 'ok', value: planned.value });
      if (planned.kind === 'command') {
        if (firstCommand < 0) firstCommand = index;
        ops.push(planned.op);
      }
    }

    if (ops.length === 0) return { ok: true, results, revision, changed: false };

    const applied = port.apply(ops);
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
    return { ok: true, results, revision: port.revision(), changed: applied.changed };
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

function invalidHandle(detail: string): PlannedOperation {
  return {
    ok: false,
    error: automationError('invalid-handle', 'that handle does not name what it claims', detail),
  };
}
