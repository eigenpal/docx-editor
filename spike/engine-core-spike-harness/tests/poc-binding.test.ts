/** @spike-features engine-neutral-editor-driver-contract, bold-mark, italic-mark */
import { describe, expect, test } from 'bun:test';
import { createPocDocxFixture, loadPocDocx } from '../src/poc/docx';
import {
  BINDING_RECONCILIATION_ORIGIN,
  createPocEditorSession,
  isBindingReconciliationOrigin,
  type PocEditorSession,
} from '../src/poc/session';
import { POC_STORY_ID } from '../src/poc/constants';
import { docRange } from '../src/driver/editor-driver';

let nextSessionClientId = 910;

async function createSession(): Promise<PocEditorSession> {
  const bytes = await createPocDocxFixture();
  const loaded = await loadPocDocx(bytes);
  const editableClientId = nextSessionClientId++;
  const replicaClientId = nextSessionClientId++;
  return createPocEditorSession(loaded, {
    editable: {
      actorId: 'actor-editable',
      sessionId: `session-editable-${editableClientId}`,
      clientId: editableClientId,
    },
    replica: {
      actorId: 'actor-replica',
      sessionId: `session-replica-${replicaClientId}`,
      clientId: replicaClientId,
    },
  });
}

describe('poc editor session — store-first editing', () => {
  test('typing commits to the editable store before replica convergence', async () => {
    const session = await createSession();
    session.setSelection({ start: session.editable.snapshot().text.length, end: session.editable.snapshot().text.length });
    session.typeText('!');
    expect(session.editable.snapshot().text).toBe('Hello bold italic!');
    expect(session.replica.snapshot().text).toBe('Hello bold italic!');
  });

  test('selectText and toggleMark update bold coverage in the store', async () => {
    const session = await createSession();
    expect(session.selectText('bold')).toBe(true);
    const result = session.toggleMark('bold');
    expect(result).toEqual({ status: 'applied', changed: true });
    expect(session.editable.snapshot().runs.some((run) => run.text === 'bold' && run.bold)).toBe(false);
    expect(session.replica.snapshot()).toEqual(session.editable.snapshot());
  });

  test('toggleMark on italic selection updates italic coverage', async () => {
    const session = await createSession();
    expect(session.selectText('italic')).toBe(true);
    const result = session.toggleMark('italic');
    expect(result).toEqual({ status: 'applied', changed: true });
    expect(session.editable.snapshot().runs.some((run) => run.text === 'italic' && run.italic)).toBe(
      false
    );
  });

  test('empty selection toggleMark is a schema-visible no-op', async () => {
    const session = await createSession();
    session.setSelection({ start: 2, end: 2 });
    expect(session.toggleMark('bold')).toEqual({
      status: 'noOp',
      changed: false,
      reason: 'empty selection',
    });
  });
});

describe('poc editor session — replica synchronization', () => {
  test('replica converges after editable edits and remote replica edits propagate', async () => {
    const session = await createSession();
    session.setSelection({ start: 5, end: 5 });
    session.typeText('X');
    expect(session.replica.snapshot().text).toBe('HelloX bold italic');

    session.applyRemoteReplicaEdit((store) => {
      store.insert(store.snapshot().text.length, '?');
    });
    expect(session.editable.snapshot().text).toBe('HelloX bold italic?');
    expect(session.replica.snapshot().text).toBe('HelloX bold italic?');
  });

  test('local undo preserves remote work applied after local edits', async () => {
    const session = await createSession();
    session.setSelection({ start: 0, end: 0 });
    session.typeText('LOCAL');
    session.applyRemoteReplicaEdit((store) => {
      store.insert(store.snapshot().text.length, 'REMOTE');
    });
    expect(session.undo()).toEqual({ status: 'applied', changed: true });
    expect(session.editable.snapshot().text).toBe('Hello bold italicREMOTE');
    expect(session.replica.snapshot().text).toBe('Hello bold italicREMOTE');
  });
});

describe('poc binding reconciliation origin', () => {
  test('binding reconciliation origin is distinct and ignored by forward mapping gate', () => {
    expect(BINDING_RECONCILIATION_ORIGIN).toBe('poc-binding-reconciliation');
    expect(isBindingReconciliationOrigin(BINDING_RECONCILIATION_ORIGIN)).toBe(true);
    expect(isBindingReconciliationOrigin('human')).toBe(false);
  });

  test('reconcile notification does not enqueue another store mutation', async () => {
    const session = await createSession();
    let editableMutations = 0;
    const before = session.editable.snapshot();
    session.subscribeEditable(() => {
      editableMutations += 1;
    });
    session.reconcileEditableProjection();
    expect(session.editable.snapshot()).toEqual(before);
    expect(editableMutations).toBe(0);
  });
});

describe('poc editor session — inspection queries', () => {
  test('findText and selection queries use stable story and paragraph ids', async () => {
    const session = await createSession();
    expect(session.selectText('bold')).toBe(true);
    expect(session.findText('bold')).toEqual([
      docRange({
        storyId: POC_STORY_ID,
        blockId: session.loaded.paragraphId,
        start: 6,
        end: 10,
      }),
    ]);
    expect(session.selectedText()).toBe('bold');
    expect(session.selectionFormatting()).toEqual({ bold: true, italic: false });
    expect(session.selectionRange()).toEqual(
      docRange({
        storyId: POC_STORY_ID,
        blockId: session.loaded.paragraphId,
        start: 6,
        end: 10,
      })
    );
  });
});
