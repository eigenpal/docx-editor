/** @spike-features engine-neutral-editor-driver-contract, bold-mark, italic-mark */
import { describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

function appendElement<K extends keyof HTMLElementTagNameMap>(
  parent: HTMLElement,
  tagName: K,
  id: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  element.id = id;
  parent.appendChild(element);
  return element;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('timed out waiting for POC browser initialization');
}

describe('POC toolbar selection preservation', () => {
  test('mouse formatting preserves selection and keyboard click remains functional', async () => {
    document.body.replaceChildren();
    const root = appendElement(document.body, 'main', 'app');
    root.setAttribute('data-poc-root', '');
    const loadButton = appendElement(root, 'button', 'load-fixture');
    const boldButton = appendElement(root, 'button', 'toggle-bold');
    const italicButton = appendElement(root, 'button', 'toggle-italic');
    appendElement(root, 'button', 'undo-edit');
    appendElement(root, 'button', 'save-docx');
    appendElement(root, 'div', 'poc-status');
    const editableHost = appendElement(root, 'div', 'editable-host');
    const replicaHost = appendElement(root, 'div', 'replica-host');
    void loadButton;

    const originalUpdateState = EditorView.prototype.updateState;
    let editableView: EditorView | null = null;
    EditorView.prototype.updateState = function (state) {
      if (this.dom.getAttribute('aria-label') === 'Editable POC paragraph') {
        editableView = this;
      }
      originalUpdateState.call(this, state);
    };

    try {
      await import('../browser/main');
      await waitFor(() => editableHost.textContent === 'Hello bold italic');
      await window.pocEditorDriver!.selectText('Hello');
    } finally {
      EditorView.prototype.updateState = originalUpdateState;
    }

    const driver = window.pocEditorDriver!;
    const view = editableView as unknown as EditorView;

    root.addEventListener('mousedown', () => {
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.selection.to))
      );
    });

    const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    italicButton.dispatchEvent(mouseDown);
    italicButton.click();

    expect(mouseDown.defaultPrevented).toBe(true);
    await driver.selectText('Hello');
    expect(await driver.query({ type: 'selectionFormatting' })).toEqual({
      type: 'selectionFormatting',
      formatting: { bold: false, italic: true },
    });
    expect(editableHost.querySelector('em')?.textContent).toBe('Hello');
    expect(replicaHost.querySelector('em')?.textContent).toBe('Hello');

    boldButton.click();

    expect(await driver.query({ type: 'selectionFormatting' })).toEqual({
      type: 'selectionFormatting',
      formatting: { bold: true, italic: true },
    });
    expect(editableHost.querySelector('strong')?.textContent).toBe('Hello');
    expect(replicaHost.querySelector('strong')?.textContent).toBe('Hello');
  });
});
