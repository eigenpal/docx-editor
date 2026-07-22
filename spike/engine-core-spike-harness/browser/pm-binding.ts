import { Schema, type Node as ProseMirrorNode } from 'prosemirror-model';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { PocSnapshot } from '../src/poc/store';
import {
  BINDING_RECONCILIATION_ORIGIN,
  type PocEditorSession,
  type TextSelection as SessionSelection,
} from '../src/poc/session';

export const BINDING_RECONCILIATION_META = 'poc-binding-reconciliation';

const pocSchema = new Schema({
  nodes: {
    doc: { content: 'paragraph' },
    paragraph: {
      content: 'text*',
      toDOM: () => ['p', 0],
      parseDOM: [{ tag: 'p' }],
    },
    text: { group: 'inline' },
  },
  marks: {
    bold: {
      toDOM: () => ['strong', 0],
      parseDOM: [{ tag: 'strong' }, { tag: 'b' }],
    },
    italic: {
      toDOM: () => ['em', 0],
      parseDOM: [{ tag: 'em' }, { tag: 'i' }],
    },
  },
});

function snapshotToDoc(snapshot: PocSnapshot): ProseMirrorNode {
  const children: ProseMirrorNode[] = [];
  for (const run of snapshot.runs) {
    if (run.text.length === 0) continue;
    const marks = [];
    if (run.bold) marks.push(pocSchema.marks.bold.create());
    if (run.italic) marks.push(pocSchema.marks.italic.create());
    children.push(pocSchema.text(run.text, marks));
  }
  const paragraph = pocSchema.nodes.paragraph.create(null, children);
  return pocSchema.nodes.doc.create(null, [paragraph]);
}

function offsetToPos(snapshot: PocSnapshot, offset: number): number {
  return Math.max(1, Math.min(offset + 1, snapshot.text.length + 1));
}

function posToOffset(pos: number): number {
  return Math.max(0, pos - 1);
}

function createStateFromSnapshot(
  snapshot: PocSnapshot,
  selection: SessionSelection
): EditorState {
  const doc = snapshotToDoc(snapshot);
  const from = offsetToPos(snapshot, selection.start);
  const to = offsetToPos(snapshot, selection.end);
  return EditorState.create({
    doc,
    schema: pocSchema,
    selection: TextSelection.create(doc, from, to),
  });
}

function mapTransactionToSession(session: PocEditorSession, transaction: Transaction): boolean {
  if (transaction.getMeta(BINDING_RECONCILIATION_META)) return false;
  let mapped = false;
  for (const step of transaction.steps) {
    const json = step.toJSON() as {
      stepType?: string;
      from?: number;
      to?: number;
      slice?: { content?: Array<{ text?: string }> };
    };
    if (json.stepType !== 'replace') continue;
    const from = posToOffset(json.from ?? 0);
    const to = posToOffset(json.to ?? 0);
    const inserted = json.slice?.content?.map((node) => node.text ?? '').join('') ?? '';
    session.setSelection({ start: from, end: to });
    if (from !== to) {
      session.typeText('');
      mapped = true;
    }
    if (inserted.length > 0) {
      session.setSelection({ start: from, end: from });
      session.typeText(inserted);
      mapped = true;
    }
  }
  return mapped;
}

export interface MountPocEditorBindingOptions {
  readonly session: PocEditorSession;
  readonly editableHost: HTMLElement;
  readonly replicaHost: HTMLElement;
  readonly onStatusChange?: (status: 'connected' | 'converged' | 'save-pending') => void;
}

export interface PocEditorBinding {
  readonly editableView: EditorView;
  readonly replicaView: EditorView;
  destroy(): void;
}

export function mountPocEditorBinding(options: MountPocEditorBindingOptions): PocEditorBinding {
  let reconciling = false;
  const { session, editableHost, replicaHost, onStatusChange } = options;

  const updateStatus = (): void => {
    onStatusChange?.(session.snapshotsConverged() ? 'converged' : 'connected');
  };

  let editableView!: EditorView;
  let replicaView!: EditorView;

  const reconcileEditable = (): void => {
    reconciling = true;
    try {
      editableView.updateState(
        createStateFromSnapshot(session.editable.snapshot(), session.getSelection())
      );
    } finally {
      reconciling = false;
    }
  };

  const reconcileReplica = (): void => {
    replicaView.updateState(
      createStateFromSnapshot(session.replica.snapshot(), { start: 0, end: 0 })
    );
  };

  editableView = new EditorView(editableHost, {
    editable: () => true,
    state: createStateFromSnapshot(session.editable.snapshot(), session.getSelection()),
    dispatchTransaction(transaction) {
      if (reconciling || transaction.getMeta(BINDING_RECONCILIATION_META)) {
        editableView.updateState(editableView.state.apply(transaction));
        return;
      }
      const before = JSON.stringify(session.editable.snapshot());
      if (!mapTransactionToSession(session, transaction)) {
        return;
      }
      if (JSON.stringify(session.editable.snapshot()) === before) {
        return;
      }
      reconcileEditable();
      reconcileReplica();
      updateStatus();
    },
    attributes: {
      'aria-label': 'Editable POC paragraph',
      role: 'textbox',
      'aria-multiline': 'true',
    },
  });

  replicaView = new EditorView(replicaHost, {
    editable: () => false,
    state: createStateFromSnapshot(session.replica.snapshot(), { start: 0, end: 0 }),
    attributes: {
      'aria-label': 'Read-only synchronized replica',
      role: 'document',
    },
  });

  const unsubscribeEditable = session.subscribeEditable(() => {
    if (reconciling) return;
    reconcileEditable();
    updateStatus();
  });
  const unsubscribeReplica = session.subscribeReplica(() => {
    reconcileReplica();
    updateStatus();
  });

  updateStatus();

  return {
    editableView,
    replicaView,
    destroy() {
      unsubscribeEditable();
      unsubscribeReplica();
      editableView.destroy();
      replicaView.destroy();
    },
  };
}

export function syncPmSelectionFromSession(session: PocEditorSession, view: EditorView): void {
  view.updateState(createStateFromSnapshot(session.editable.snapshot(), session.getSelection()));
}

export { pocSchema, snapshotToDoc, BINDING_RECONCILIATION_ORIGIN };
