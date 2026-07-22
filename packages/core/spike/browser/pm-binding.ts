import { Schema, type Node as ProseMirrorNode } from 'prosemirror-model';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { PocSnapshot } from '../src/poc/store';
import {
  BINDING_RECONCILIATION_ORIGIN,
  isBindingReconciliationOrigin,
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

function createStateFromSnapshot(snapshot: PocSnapshot, selection: SessionSelection): EditorState {
  const doc = snapshotToDoc(snapshot);
  const from = offsetToPos(snapshot, selection.start);
  const to = offsetToPos(snapshot, selection.end);
  return EditorState.create({
    doc,
    schema: pocSchema,
    selection: TextSelection.create(doc, from, to),
  });
}

function transactionSelection(transaction: Transaction): SessionSelection {
  return {
    start: posToOffset(transaction.selection.from),
    end: posToOffset(transaction.selection.to),
  };
}

function mapTextChangeToSession(
  session: PocEditorSession,
  previousText: string,
  transaction: Transaction
): boolean {
  const nextText = transaction.doc.textContent;
  if (previousText === nextText) return false;

  let prefixLength = 0;
  while (
    prefixLength < previousText.length &&
    prefixLength < nextText.length &&
    previousText[prefixLength] === nextText[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < previousText.length - prefixLength &&
    suffixLength < nextText.length - prefixLength &&
    previousText[previousText.length - suffixLength - 1] ===
      nextText[nextText.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }

  session.setSelection({
    start: prefixLength,
    end: previousText.length - suffixLength,
  });
  session.replaceSelection(nextText.slice(prefixLength, nextText.length - suffixLength));
  return true;
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
  const { session, editableHost, replicaHost, onStatusChange } = options;

  const updateStatus = (): void => {
    onStatusChange?.(session.snapshotsConverged() ? 'converged' : 'connected');
  };

  const reconcileEditable = (): void => {
    const snapshot = session.editable.snapshot();
    const nextDoc = snapshotToDoc(snapshot);
    const selection = session.getSelection();
    const transaction = editableView.state.tr.replaceWith(
      0,
      editableView.state.doc.content.size,
      nextDoc.content
    );
    transaction.setSelection(
      TextSelection.create(
        transaction.doc,
        offsetToPos(snapshot, selection.start),
        offsetToPos(snapshot, selection.end)
      )
    );
    transaction.setMeta(BINDING_RECONCILIATION_META, BINDING_RECONCILIATION_ORIGIN);
    editableView.dispatch(transaction);
  };

  const reconcileReplica = (): void => {
    replicaView.updateState(
      createStateFromSnapshot(session.replica.snapshot(), { start: 0, end: 0 })
    );
  };

  const editableView = new EditorView(editableHost, {
    editable: () => true,
    state: createStateFromSnapshot(session.editable.snapshot(), session.getSelection()),
    dispatchTransaction(transaction) {
      if (isBindingReconciliationOrigin(transaction.getMeta(BINDING_RECONCILIATION_META))) {
        editableView.updateState(editableView.state.apply(transaction));
        return;
      }

      if (!transaction.docChanged) {
        session.setSelection(transactionSelection(transaction));
        editableView.updateState(editableView.state.apply(transaction));
        return;
      }

      const before = JSON.stringify(session.editable.snapshot());
      const previousText = editableView.state.doc.textContent;
      if (!mapTextChangeToSession(session, previousText, transaction)) {
        reconcileEditable();
        return;
      }
      session.setSelection(transactionSelection(transaction));
      if (JSON.stringify(session.editable.snapshot()) === before) {
        reconcileEditable();
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

  const replicaView = new EditorView(replicaHost, {
    editable: () => false,
    state: createStateFromSnapshot(session.replica.snapshot(), { start: 0, end: 0 }),
    attributes: {
      'aria-label': 'Read-only synchronized replica',
      role: 'document',
    },
  });

  const unsubscribeEditable = session.subscribeEditable(() => {
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
