/** @spike-features engine-neutral-editor-driver-contract, bold-mark, italic-mark */
import { describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { EditorView } from 'prosemirror-view';
import { createPocDocxFixture } from '../src/poc/docx';
import { createPocEditorDriver, type PocEditorDriverHost } from '../browser/driver';
import { nonEmptyString, type EditorDriver } from '../src/driver/editor-driver';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

function createDriverHosts(): {
  host: HTMLDivElement;
  driver: ReturnType<typeof createPocEditorDriver>;
} {
  const host = document.createElement('div');
  host.setAttribute('data-poc-root', 'true');
  host.innerHTML =
    '<div id="editable-host"></div><div id="replica-host"></div><div id="poc-status" aria-live="polite"></div>';
  document.body.appendChild(host);
  const driver = createPocEditorDriver({
    editableHost: host.querySelector('#editable-host')!,
    replicaHost: host.querySelector('#replica-host')!,
    statusHost: host.querySelector('#poc-status')!,
  });
  return { host, driver };
}

function assertDriverShape(driver: EditorDriver): void {
  expect(typeof driver.loadDocx).toBe('function');
  expect(typeof driver.selectText).toBe('function');
  expect(typeof driver.type).toBe('function');
  expect(typeof driver.execute).toBe('function');
  expect(typeof driver.query).toBe('function');
  expect(typeof driver.undo).toBe('function');
  expect(typeof driver.save).toBe('function');
  expect('getView' in driver).toBe(false);
  expect('getEditorView' in driver).toBe(false);
}

describe('poc EditorDriver boundary', () => {
  test('driver exposes engine-neutral methods without EditorView', () => {
    const { host, driver } = createDriverHosts();
    assertDriverShape(driver);
    host.remove();
  });

  test('load, edit, bold, inspect, and undo through the public driver', async () => {
    const { host, driver } = createDriverHosts();

    await driver.loadDocx(await createPocDocxFixture());
    await driver.selectText('bold');
    expect(await driver.query({ type: 'selectedText' })).toEqual({
      type: 'selectedText',
      text: 'bold',
    });
    expect(await driver.execute({ type: 'toggleMark', mark: 'bold' })).toEqual({
      status: 'applied',
      changed: true,
    });
    expect(await driver.query({ type: 'selectionFormatting' })).toEqual({
      type: 'selectionFormatting',
      formatting: { bold: false, italic: false },
    });
    await driver.type('!');
    expect((host as PocEditorDriverHost & HTMLElement).dataset.syncStatus).toBe('converged');
    expect(await driver.undo()).toEqual({ status: 'applied', changed: true });
    expect(await driver.save()).toMatchObject({ status: 'failed', code: 'not-implemented' });
    host.remove();
  });

  test('italic command is schema-valid and toggles through execute', async () => {
    const { host, driver } = createDriverHosts();
    await driver.loadDocx(await createPocDocxFixture());
    await driver.selectText('italic');
    expect(await driver.execute({ type: 'toggleMark', mark: 'italic' })).toEqual({
      status: 'applied',
      changed: true,
    });
    host.remove();
  });

  test('repeated load replaces the session and tears down the previous views', async () => {
    const { host, driver } = createDriverHosts();
    const bytes = await createPocDocxFixture();

    await driver.loadDocx(bytes);
    await driver.type('first');
    await driver.loadDocx(bytes);

    expect(await driver.query({ type: 'findText', text: nonEmptyString('first') })).toEqual({
      type: 'findText',
      ranges: [],
    });
    expect(host.querySelectorAll('#editable-host .ProseMirror')).toHaveLength(1);
    expect(host.querySelectorAll('#replica-host .ProseMirror')).toHaveLength(1);
    expect(host.querySelector('#editable-host')?.textContent).toBe('Hello bold italic');
    expect(host.querySelector('#replica-host')?.textContent).toBe('Hello bold italic');
    host.remove();
  });

  test('driver replacement synchronizes the cursor before a real ProseMirror edit', async () => {
    const { host, driver } = createDriverHosts();
    const originalUpdateState = EditorView.prototype.updateState;
    let editableView: EditorView | null = null;
    EditorView.prototype.updateState = function (state) {
      if (this.dom.getAttribute('aria-label') === 'Editable POC paragraph') {
        editableView = this;
      }
      originalUpdateState.call(this, state);
    };

    try {
      await driver.loadDocx(await createPocDocxFixture());
      await driver.selectText('bold');
      await driver.type('X');
    } finally {
      EditorView.prototype.updateState = originalUpdateState;
    }

    expect(editableView).not.toBeNull();
    const view = editableView as unknown as EditorView;
    expect(view.state.selection.from).toBe(8);
    expect(view.state.selection.to).toBe(8);

    view.dispatch(view.state.tr.insertText('!'));

    const expected = 'Hello X! italic';
    expect(await driver.query({ type: 'findText', text: nonEmptyString(expected) })).toEqual({
      type: 'findText',
      ranges: [
        expect.objectContaining({
          start: 0,
          end: expected.length,
        }),
      ],
    });
    expect(host.querySelector('#editable-host')?.textContent).toBe(expected);
    expect(host.querySelector('#replica-host')?.textContent).toBe(expected);
    host.remove();
  });
});
