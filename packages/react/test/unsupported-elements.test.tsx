import './dom-setup.ts';
import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { markUnsupportedElement } from '../../core/src/output/unsupported-elements.ts';
import { UnsupportedElements } from '../src/editor/UnsupportedElements.tsx';
import type { EquationSpanRecord } from '@docx-editor.dev/core/layout';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(cleanup);
const Context = createContext('missing');

function placeholder(container: HTMLElement, label: string) {
  const element = document.createElement('span');
  const fallback = document.createElement('span');
  fallback.textContent = label;
  element.append(fallback);
  markUnsupportedElement(element, fallback, {
    ownerPartName: 'word/document.xml',
    namespaceUri: 'urn:test',
    localName: 'equation',
    placement: 'inline',
    source: {
      id: label,
      kind: 'generic',
      namespaceUri: 'urn:test',
      localName: 'equation',
      namespaceBindings: [],
      attributes: [],
      children: [],
    },
    nodeId: label,
    label,
    equation: {} as EquationSpanRecord,
  });
  container.append(element);
  return { element, fallback };
}
async function tick() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

test('custom components preserve context, respond to clicks, and clean up across repaint', async () => {
  const container = document.createElement('div');
  const first = placeholder(container, 'first');
  let clicks = 0;
  let unmounts = 0;
  function Custom() {
    const value = useContext(Context);
    useEffect(
      () => () => {
        unmounts++;
      },
      []
    );
    return <button onClick={() => clicks++}>{value}</button>;
  }
  const view = render(
    <Context.Provider value="from host">
      <UnsupportedElements container={container} render={() => <Custom />} />
    </Context.Provider>
  );
  expect(container.querySelector('button')!.textContent).toBe('from host');
  expect(first.fallback.hidden).toBe(true);
  fireEvent.click(container.querySelector('button')!);
  expect(clicks).toBe(1);
  first.element.remove();
  const second = placeholder(container, 'second');
  await tick();
  expect(unmounts).toBe(1);
  expect(second.fallback.hidden).toBe(true);
  expect(first.element.querySelector('button')).toBeNull();
  view.unmount();
  expect(unmounts).toBe(2);
  expect(second.fallback.hidden).toBe(false);
  expect(container.querySelector('button')).toBeNull();
});

test('null keeps the default, and changes apply without repainting', () => {
  const container = document.createElement('div');
  const { fallback } = placeholder(container, 'default');
  const view = render(<UnsupportedElements container={container} render={() => null} />);
  expect(fallback.hidden).toBe(false);
  view.rerender(<UnsupportedElements container={container} render={() => <b>custom</b>} />);
  expect(fallback.hidden).toBe(true);
  view.rerender(<UnsupportedElements container={container} render={() => null} />);
  expect(fallback.hidden).toBe(false);
  expect(container.querySelector('b')).toBeNull();
});

test('the sample canvas uses the public editor override and saves its original content', async () => {
  const { readFileSync } = await import('node:fs');
  const { unzipSync, strFromU8 } = await import('fflate');
  const { DocxEditor } = await import('../src/index.ts');
  const source = new Uint8Array(
    readFileSync(
      new URL('../../core/src/output/__tests__/fixtures/unsupported-canvas.docx', import.meta.url)
    )
  );
  let editor: import('@docx-editor.dev/core/editor').DocxEditorInstance | undefined;
  const view = render(
    <DocxEditor
      document={source}
      chrome={false}
      onReady={(value) => {
        editor = value as typeof editor;
      }}
    >
      <DocxEditor.UnsupportedElement>
        {({ element }) =>
          element.drawing ? (
            <button data-testid="canvas-custom">{element.drawing?.placeholderGraphicKind}</button>
          ) : null
        }
      </DocxEditor.UnsupportedElement>
    </DocxEditor>
  );
  await waitFor(() => {
    expect(view.container.querySelector('[data-testid="canvas-custom"]')).not.toBeNull();
    expect(
      view.container.querySelector<HTMLElement>('.docx-drawing-placeholder-label')!.hidden
    ).toBe(true);
  });
  expect(view.getByTestId('canvas-custom').textContent).toBe('graphic');
  const label = view.container.querySelector<HTMLElement>('.docx-drawing-placeholder-label')!;
  expect(label.hidden).toBe(true);
  const drawing = view.container.querySelector<HTMLElement>('.docx-drawing-placeholder')!;
  const bounds = drawing.style.cssText;
  expect(drawing.getAttribute('role')).toBe('group');
  expect(drawing.hasAttribute('aria-hidden')).toBe(false);
  const saved = await editor!.save();
  expect(saved).not.toBeNull();
  const xml = strFromU8(unzipSync(new Uint8Array(saved!))['word/document.xml']!);
  expect(xml).toContain('wpc');
  expect(xml).toContain('Start');
  expect(xml).toContain('Process');
  expect(xml).toContain('End');
  expect(xml).not.toContain('canvas-custom');
  view.rerender(<DocxEditor document={source} chrome={false} />);
  await tick();
  const restoredLabel = view.container.querySelector<HTMLElement>(
    '.docx-drawing-placeholder-label'
  )!;
  const restoredDrawing = view.container.querySelector<HTMLElement>('.docx-drawing-placeholder')!;
  expect(restoredLabel.hidden).toBe(false);
  expect(restoredDrawing.getAttribute('role')).toBe('img');
  expect(restoredDrawing.style.cssText).toBe(bounds);
  view.unmount();
});

test('public custom components retain local state across edits and restore the fallback on removal', async () => {
  const { readFileSync } = await import('node:fs');
  const { DocxEditor } = await import('../src/index.ts');
  const source = new Uint8Array(
    readFileSync(
      new URL('../../core/src/output/__tests__/fixtures/unsupported-canvas.docx', import.meta.url)
    )
  );
  let editor: import('@docx-editor.dev/core/editor').DocxEditorInstance | undefined;
  let mounts = 0;
  let unmounts = 0;
  function Custom() {
    const [count, setCount] = useState(0);
    useEffect(() => {
      mounts++;
      return () => {
        unmounts++;
      };
    }, []);
    return <button onClick={() => setCount((value) => value + 1)}>Preview {count}</button>;
  }
  const props = {
    document: source,
    chrome: false,
    onReady: (value: import('@docx-editor.dev/core/contracts/editor').Editor) => {
      editor = value as typeof editor;
    },
  };
  const view = render(
    <DocxEditor {...props}>
      <DocxEditor.UnsupportedElement>{() => <Custom />}</DocxEditor.UnsupportedElement>
    </DocxEditor>
  );
  await waitFor(() => expect(view.queryByRole('button', { name: 'Preview 0' })).not.toBeNull());
  const button = view.getByRole('button', { name: 'Preview 0' });
  fireEvent.click(button);
  expect(button.textContent).toBe('Preview 1');
  await act(async () => {
    expect(editor!.exec({ type: 'insertText', text: 'Z' }).ok).toBe(true);
  });
  await tick();
  await waitFor(() => expect(view.getByRole('button', { name: 'Preview 1' })).toBe(button));
  expect(mounts).toBe(1);
  expect(unmounts).toBe(0);

  view.rerender(
    <DocxEditor {...props}>
      <DocxEditor.UnsupportedElement>
        {() => <strong>Replacement</strong>}
      </DocxEditor.UnsupportedElement>
    </DocxEditor>
  );
  expect(view.getByText('Replacement')).toBeTruthy();
  expect(unmounts).toBe(1);
  const label = view.container.querySelector<HTMLElement>('.docx-drawing-placeholder-label')!;
  expect(label.hidden).toBe(true);
  view.rerender(
    <DocxEditor {...props}>
      <DocxEditor.UnsupportedElement>{() => null}</DocxEditor.UnsupportedElement>
    </DocxEditor>
  );
  expect(label.hidden).toBe(false);
  expect(view.queryByText('Replacement')).toBeNull();
  view.rerender(
    <DocxEditor {...props}>
      <DocxEditor.UnsupportedElement>{() => <Custom />}</DocxEditor.UnsupportedElement>
    </DocxEditor>
  );
  expect(label.hidden).toBe(true);
  view.rerender(<DocxEditor {...props} />);
  expect(label.hidden).toBe(false);
  expect(view.queryByRole('button', { name: 'Preview 0' })).toBeNull();
  expect(mounts).toBe(2);
  expect(unmounts).toBe(2);
});

test('custom inputs keep native menus and own keyboard, input, and drop events', async () => {
  const { readFileSync } = await import('node:fs');
  const { DocxEditor } = await import('../src/index.ts');
  const source = new Uint8Array(
    readFileSync(
      new URL('../../core/src/output/__tests__/fixtures/unsupported-canvas.docx', import.meta.url)
    )
  );
  let editor: import('@docx-editor.dev/core/editor').DocxEditorInstance | undefined;
  let keydowns = 0;
  let drops = 0;
  const view = render(
    <DocxEditor
      document={source}
      chrome={false}
      onReady={(value) => {
        editor = value as typeof editor;
      }}
    >
      <DocxEditor.UnsupportedElement>
        {() => (
          <input
            aria-label="Preview name"
            defaultValue="Custom text"
            onKeyDown={() => keydowns++}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              drops++;
            }}
          />
        )}
      </DocxEditor.UnsupportedElement>
    </DocxEditor>
  );
  await waitFor(() =>
    expect(view.container.querySelector('.docx-unsupported-slot input')).not.toBeNull()
  );
  await tick();
  const input = view.getByRole('textbox', { name: 'Preview name' });
  const revision = editor!.getDocumentHandle()!.revision;
  const before = editor!.surface!.session.bodyText();
  fireEvent.focus(input);
  const contextmenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  act(() => {
    input.dispatchEvent(contextmenu);
  });
  expect(contextmenu.defaultPrevented).toBe(false);
  expect(view.container.querySelector('.docx-contextmenu')).toBeNull();
  fireEvent.keyDown(input, { key: 'Backspace' });
  fireEvent.keyDown(input, { key: 'b', ctrlKey: true });
  expect(keydowns).toBe(2);
  const beforeinput = new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertText',
    data: 'Custom input',
  });
  input.dispatchEvent(beforeinput);
  expect(beforeinput.defaultPrevented).toBe(false);
  const dataTransfer = {
    items: [{ kind: 'file', type: 'image/png' }],
    files: [new File(['custom upload'], 'preview.png', { type: 'image/png' })],
    types: ['Files'],
    getData: () => '',
  };
  fireEvent.dragOver(input, { dataTransfer });
  fireEvent.drop(input, { dataTransfer });
  await tick();
  expect(drops).toBe(1);
  expect(editor!.getDocumentHandle()!.revision).toBe(revision);
  expect(editor!.surface!.session.bodyText()).toBe(before);
  expect(view.container.querySelector('[data-docx-equation-popup]')).toBeNull();
});

test('compound declarations select the first match, retain priority on updates, and preserve local context', async () => {
  const { DocxEditorUnsupportedElement } =
    await import('../src/editor/DocxEditorUnsupportedElement');
  const { createUnsupportedElementRegistry, UnsupportedElementRegistryContext } =
    await import('../src/editor/unsupported-element-registry');
  const registry = createUnsupportedElementRegistry();
  const container = document.createElement('div');
  const { fallback } = placeholder(container, 'target');
  registry.setContainer(container);
  const rejects = () => false;
  const accepts = () => true;
  function Custom() {
    return <button>{useContext(Context)}</button>;
  }
  const declarations = (match: () => boolean, first = true, empty = false) => (
    <UnsupportedElementRegistryContext.Provider value={registry}>
      <Context.Provider value="local declaration context">
        {first ? (
          <DocxEditorUnsupportedElement match={match}>
            {() => (empty ? null : <Custom />)}
          </DocxEditorUnsupportedElement>
        ) : null}
      </Context.Provider>
      <DocxEditorUnsupportedElement>{() => <b>catch-all</b>}</DocxEditorUnsupportedElement>
    </UnsupportedElementRegistryContext.Provider>
  );
  const view = render(declarations(rejects));
  expect(container.querySelector('b')?.textContent).toBe('catch-all');
  view.rerender(declarations(accepts));
  expect(container.querySelector('button')?.textContent).toBe('local declaration context');
  expect(container.querySelector('b')).toBeNull();
  expect(fallback.hidden).toBe(true);
  view.rerender(declarations(accepts, true, true));
  expect(fallback.hidden).toBe(false);
  expect(container.querySelector('b')).toBeNull();
  view.rerender(declarations(accepts, false));
  expect(container.querySelector('b')?.textContent).toBe('catch-all');
  view.unmount();
  expect(fallback.hidden).toBe(false);
  registry.setContainer(null);
});

test('empty fragments, arrays, and whitespace keep the default placeholder visible', () => {
  const container = document.createElement('div');
  const { fallback } = placeholder(container, 'default');
  const emptyResults: ReactNode[] = [<></>, [], [null, false], ' ', <>{[null, <></>]}</>];
  const view = render(<UnsupportedElements container={container} render={() => <b>custom</b>} />);
  for (const result of emptyResults) {
    view.rerender(<UnsupportedElements container={container} render={() => result} />);
    expect(fallback.hidden).toBe(false);
    expect(container.querySelector('b')).toBeNull();
  }
  view.rerender(<UnsupportedElements container={container} render={() => <>{0}</>} />);
  expect(fallback.hidden).toBe(true);
  expect(container.querySelector('.docx-unsupported-slot')?.textContent).toBe('0');
});
