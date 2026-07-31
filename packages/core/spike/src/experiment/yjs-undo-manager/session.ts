/** @spike-features origin-metadata, yjs-backend */
import * as Y from 'yjs';
import { createStableTrackedOrigin } from './origin-tokens';
import { collectAuthoredModelScope } from './scope';
import {
  UNDO_EXPERIMENT_MAX_REDO_STACK_ITEMS,
  UNDO_EXPERIMENT_MAX_UNDO_STACK_ITEMS,
} from './quotas';
import type { StackItemMeta } from './types';

type PublicStackItem = Y.UndoManager['undoStack'][number];

export interface ActorUndoSession {
  readonly actorId: string;
  readonly sessionId: string;
  readonly trackedOrigin: string;
  readonly undoManager: Y.UndoManager;
  queueNextStackItemMeta(meta: StackItemMeta): void;
  stopCapturing(): void;
  inspectStackMeta(stack?: 'undo' | 'redo'): readonly StackItemMeta[];
}

export function createActorUndoSession(
  doc: Y.Doc,
  actorId: string,
  sessionId: string
): ActorUndoSession {
  const trackedOrigin = createStableTrackedOrigin(actorId, sessionId);
  const scope = [...collectAuthoredModelScope(doc)];
  const undoManager = new Y.UndoManager(scope, {
    trackedOrigins: new Set([trackedOrigin]),
    captureTimeout: Number.MAX_SAFE_INTEGER,
    deleteFilter: () => true,
    ignoreRemoteMapChanges: true,
  });
  const pendingMeta: StackItemMeta[] = [];

  undoManager.on('stack-item-added', ({ stackItem, type }) => {
    if (type !== 'undo') return;
    const meta = pendingMeta.shift();
    if (!meta) return;
    writeStackItemMeta(stackItem, meta);
  });

  undoManager.on('stack-item-updated', ({ stackItem, type }) => {
    if (type !== 'undo') return;
    const next = pendingMeta.shift();
    if (!next) return;
    const current = readStackItemMeta(stackItem);
    if (!current) {
      writeStackItemMeta(stackItem, next);
      return;
    }
    if (
      current.actorId !== next.actorId ||
      current.sessionId !== next.sessionId ||
      current.groupId !== next.groupId
    ) {
      throw new TypeError('captured stack item group metadata mismatch');
    }
    writeStackItemMeta(stackItem, {
      ...current,
      constituentIds: Object.freeze([...current.constituentIds, ...next.constituentIds]),
    });
  });

  return Object.freeze({
    actorId,
    sessionId,
    trackedOrigin,
    undoManager,
    queueNextStackItemMeta(meta: StackItemMeta) {
      pendingMeta.push(Object.freeze({ ...meta }));
    },
    stopCapturing() {
      undoManager.stopCapturing();
    },
    inspectStackMeta(stack = 'undo') {
      return Object.freeze(
        (stack === 'undo' ? undoManager.undoStack : undoManager.redoStack).map((stackItem) => {
          const meta = readStackItemMeta(stackItem);
          if (!meta) throw new TypeError(`${stack} stack item is missing metadata`);
          return meta;
        })
      );
    },
  });
}

function writeStackItemMeta(stackItem: PublicStackItem, meta: StackItemMeta): void {
  stackItem.meta.set('actorId', meta.actorId);
  stackItem.meta.set('sessionId', meta.sessionId);
  stackItem.meta.set('groupId', meta.groupId);
  stackItem.meta.set('constituentIds', Object.freeze([...meta.constituentIds]));
  stackItem.meta.set('originKind', meta.originKind);
}

function readStackItemMeta(stackItem: PublicStackItem): StackItemMeta | null {
  const actorId = stackItem.meta.get('actorId');
  const sessionId = stackItem.meta.get('sessionId');
  const groupId = stackItem.meta.get('groupId');
  const constituentIds = stackItem.meta.get('constituentIds');
  const originKind = stackItem.meta.get('originKind');
  if (
    typeof actorId !== 'string' ||
    typeof sessionId !== 'string' ||
    typeof groupId !== 'string' ||
    !Array.isArray(constituentIds) ||
    !constituentIds.every((value) => typeof value === 'string') ||
    (originKind !== 'human' && originKind !== 'agent')
  ) {
    return null;
  }
  return Object.freeze({
    actorId,
    sessionId,
    groupId,
    constituentIds: Object.freeze([...constituentIds]),
    originKind,
  });
}

export function undoWithControlOrigin(session: ActorUndoSession): boolean {
  const undoItem = session.undoManager.undoStack.at(-1);
  const meta = undoItem ? readStackItemMeta(undoItem) : null;
  const result = session.undoManager.undo();
  if (result && meta) {
    writeStackItemMeta(result, meta);
    const redoItem = session.undoManager.redoStack.at(-1);
    if (redoItem) writeStackItemMeta(redoItem, meta);
  }
  return result !== null;
}

export function redoWithControlOrigin(session: ActorUndoSession): boolean {
  const redoItem = session.undoManager.redoStack.at(-1);
  const meta = redoItem ? readStackItemMeta(redoItem) : null;
  const result = session.undoManager.redo();
  if (result && meta) {
    writeStackItemMeta(result, meta);
    const undoItem = session.undoManager.undoStack.at(-1);
    if (undoItem) writeStackItemMeta(undoItem, meta);
  }
  return result !== null;
}

export function inspectUndoSession(session: ActorUndoSession): {
  undoEntries: number;
  redoEntries: number;
  redoEligible: boolean;
  stackItemMeta: readonly StackItemMeta[];
  undoStackMeta: readonly StackItemMeta[];
  redoStackMeta: readonly StackItemMeta[];
} {
  const undoEntries = session.undoManager.undoStack.length;
  const redoEntries = session.undoManager.redoStack.length;
  if (undoEntries > UNDO_EXPERIMENT_MAX_UNDO_STACK_ITEMS) {
    throw new TypeError('undo stack exceeds experiment quota');
  }
  if (redoEntries > UNDO_EXPERIMENT_MAX_REDO_STACK_ITEMS) {
    throw new TypeError('redo stack exceeds experiment quota');
  }
  return Object.freeze({
    undoEntries,
    redoEntries,
    redoEligible: redoEntries > 0,
    stackItemMeta: session.inspectStackMeta('undo'),
    undoStackMeta: session.inspectStackMeta('undo'),
    redoStackMeta: session.inspectStackMeta('redo'),
  });
}
