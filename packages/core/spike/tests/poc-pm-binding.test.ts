/** @spike-features engine-neutral-editor-driver-contract, bold-mark, italic-mark */
import { describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { TextSelection } from 'prosemirror-state';
import { mountPocEditorBinding, BINDING_RECONCILIATION_META } from '../browser/pm-binding';
import { createPocDocxFixture, loadPocDocx } from '../src/poc/docx';
import {
  allocatePocEditorSessionOptions,
  createPocEditorSession,
  type PocEditorSession,
} from '../src/poc/session';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

async function createMountedBinding(): Promise<{
  readonly session: PocEditorSession;
  readonly editableHost: HTMLDivElement;
  readonly replicaHost: HTMLDivElement;
  readonly binding: ReturnType<typeof mountPocEditorBinding>;
}> {
  const loaded = await loadPocDocx(await createPocDocxFixture());
  const session = createPocEditorSession(loaded, allocatePocEditorSessionOptions('browser'));
  const editableHost = document.createElement('div');
  const replicaHost = document.createElement('div');
  document.body.append(editableHost, replicaHost);
  const binding = mountPocEditorBinding({ session, editableHost, replicaHost });
  return { session, editableHost, replicaHost, binding };
}

describe('POC ProseMirror binding behavior', () => {
  test('selection-only transaction updates canonical selection used by formatting', async () => {
    const { session, editableHost, replicaHost, binding } = await createMountedBinding();
    binding.editableView.dispatch(
      binding.editableView.state.tr.setSelection(
        TextSelection.create(binding.editableView.state.doc, 7, 11)
      )
    );

    expect(session.getSelection()).toEqual({ start: 6, end: 10 });
    expect(session.toggleMark('bold')).toEqual({ status: 'applied', changed: true });
    expect(editableHost.querySelector('strong')).toBeNull();
    expect(replicaHost.querySelector('strong')).toBeNull();
    expect(editableHost.textContent).toBe('Hello bold italic');
    expect(replicaHost.textContent).toBe('Hello bold italic');
    binding.destroy();
  });

  test('deletion commits to the store before both projections reconcile', async () => {
    const { session, editableHost, replicaHost, binding } = await createMountedBinding();
    const observed: Array<{ store: string; editableDom: string }> = [];
    const originalUpdateState = binding.editableView.updateState.bind(binding.editableView);
    binding.editableView.updateState = (state) => {
      observed.push({
        store: session.editable.snapshot().text,
        editableDom: editableHost.textContent ?? '',
      });
      originalUpdateState(state);
    };

    binding.editableView.dispatch(binding.editableView.state.tr.delete(1, 6));

    expect(observed[0]).toEqual({
      store: ' bold italic',
      editableDom: 'Hello bold italic',
    });
    expect(session.editable.snapshot().text).toBe(' bold italic');
    expect(session.replica.snapshot().text).toBe(' bold italic');
    expect(editableHost.textContent).toBe(' bold italic');
    expect(replicaHost.textContent).toBe(' bold italic');
    binding.destroy();
  });

  test('replacement maps deletion and insertion including empty replacement text', async () => {
    const { session, editableHost, replicaHost, binding } = await createMountedBinding();

    binding.editableView.dispatch(binding.editableView.state.tr.insertText('Hi', 1, 6));

    expect(session.editable.snapshot().text).toBe('Hi bold italic');
    expect(session.replica.snapshot().text).toBe('Hi bold italic');
    expect(editableHost.textContent).toBe('Hi bold italic');
    expect(replicaHost.textContent).toBe('Hi bold italic');
    binding.destroy();
  });

  test('remote reconciliation dispatches one guarded projection transaction', async () => {
    const { session, editableHost, replicaHost, binding } = await createMountedBinding();
    const originalDispatch = binding.editableView.dispatch.bind(binding.editableView);
    let reconciliationTransactions = 0;
    binding.editableView.dispatch = (transaction) => {
      if (transaction.getMeta(BINDING_RECONCILIATION_META)) {
        reconciliationTransactions += 1;
      }
      originalDispatch(transaction);
    };

    session.applyRemoteReplicaEdit((store) => {
      store.insert(store.snapshot().text.length, '?');
    });

    expect(reconciliationTransactions).toBe(1);
    expect(session.editable.snapshot().text).toBe('Hello bold italic?');
    expect(session.replica.snapshot().text).toBe('Hello bold italic?');
    expect(editableHost.textContent).toBe('Hello bold italic?');
    expect(replicaHost.textContent).toBe('Hello bold italic?');
    binding.destroy();
  });

  test('undo clamps selection and the next ProseMirror edit succeeds', async () => {
    const { session, editableHost, replicaHost, binding } = await createMountedBinding();
    const end = binding.editableView.state.doc.content.size - 1;
    binding.editableView.dispatch(
      binding.editableView.state.tr.setSelection(
        TextSelection.create(binding.editableView.state.doc, end)
      )
    );
    binding.editableView.dispatch(binding.editableView.state.tr.insertText('LOCAL'));
    expect(session.getSelection()).toEqual({ start: 22, end: 22 });

    expect(session.undo()).toEqual({ status: 'applied', changed: true });
    expect(session.getSelection()).toEqual({ start: 17, end: 17 });

    const reconciledEnd = binding.editableView.state.doc.content.size - 1;
    binding.editableView.dispatch(
      binding.editableView.state.tr.setSelection(
        TextSelection.create(binding.editableView.state.doc, reconciledEnd)
      )
    );
    binding.editableView.dispatch(binding.editableView.state.tr.insertText('!'));
    expect(session.editable.snapshot().text).toBe('Hello bold italic!');
    expect(session.replica.snapshot().text).toBe('Hello bold italic!');
    expect(editableHost.textContent).toBe('Hello bold italic!');
    expect(replicaHost.textContent).toBe('Hello bold italic!');
    binding.destroy();
  });

  test('destroy tears down both views and subscriptions', async () => {
    const { session, editableHost, replicaHost, binding } = await createMountedBinding();
    binding.destroy();

    expect(editableHost.querySelector('.ProseMirror')).toBeNull();
    expect(replicaHost.querySelector('.ProseMirror')).toBeNull();
    session.applyRemoteReplicaEdit((store) => {
      store.insert(store.snapshot().text.length, '?');
    });
    expect(editableHost.textContent).toBe('');
    expect(replicaHost.textContent).toBe('');
  });
});
