import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { h, nextTick } from 'vue';
import { DocxEditorEquation } from '../src/editor/DocxEditorEquation';
import {
  DocxEditor as PublicDocxEditor,
  DocxEditorEquation as PublicDocxEditorEquation,
} from '../src/index';
import { docx } from './helpers/fixtures';
import { flush, mountEditorTree, mountSugarAsync, type MountedEditor } from './helpers/mount';

const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const SOURCE = docx(
  `<w:p><m:oMath xmlns:m="${M}"><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e>` +
    '<m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath></w:p>'
);
const REPLACEMENT_SOURCE = docx(
  `<w:p><m:oMath xmlns:m="${M}"><m:r><m:t>y</m:t></m:r></m:oMath></w:p>`
);

function mount(mode: 'edit' | 'view' = 'edit'): MountedEditor {
  return mountEditorTree(
    () => [],
    SOURCE,
    () => h(DocxEditorEquation),
    undefined,
    { mode }
  );
}

async function open(view: MountedEditor): Promise<void> {
  const equation = view.container.querySelector('[data-docx-equation]');
  if (!equation) throw new Error('no painted equation');
  equation.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await nextTick();
}

function input(view: MountedEditor, value: string): void {
  const element = view.container.querySelector(
    '[data-testid="equation-popup-input"]'
  ) as HTMLInputElement;
  element.value = value;
  element.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
}

function click(view: MountedEditor, testId: string): void {
  view.container
    .querySelector(`[data-testid="${testId}"]`)!
    .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('default Vue equation popover', () => {
  test('is available from the public primitive and namespace', () => {
    expect(PublicDocxEditorEquation).toBe(DocxEditorEquation);
    expect(PublicDocxEditor.Equation).toBe(DocxEditorEquation);
  });

  test('mounts from the packaged sugar editor', async () => {
    const view = await mountSugarAsync({ document: SOURCE });
    await flush();
    await open(view);
    expect(view.container.querySelector('[data-testid="equation-popup"]')).not.toBeNull();
    view.unmount();
  });

  test('seeds the linear form and applies to the retained equation id', async () => {
    const view = mount();
    await flush();
    await open(view);

    const field = view.container.querySelector(
      '[data-testid="equation-popup-input"]'
    ) as HTMLInputElement;
    expect(field.value).toBe('x^{2}');
    expect(view.editor().surface!.retainedSelection()).not.toBeNull();
    const equationId = view.editor().surface!.equations.equationAtCaret()!.id;

    input(view, '{a+b}/{2}');
    await nextTick();
    expect(
      (view.container.querySelector('[data-testid="equation-popup-input"]') as HTMLInputElement)
        .value
    ).toBe('{a+b}/{2}');
    const button = view.container.querySelector('[data-testid="equation-popup-apply"]')!;
    const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    expect(button.dispatchEvent(mousedown)).toBe(false);
    click(view, 'equation-popup-apply');
    await flush();

    expect(view.container.querySelector('[data-testid="equation-popup"]')).toBeNull();
    expect(view.editor().surface!.retainedSelection()).toBeNull();
    expect(view.editor().surface!.equations.equationById(equationId)?.linear).toBe('{a+b}/{2}');
    expect(document.activeElement).toBe(view.container.querySelector('.docx-pages'));
    view.unmount();
  });

  test('describes syntax help and restores focus on Escape', async () => {
    const view = mount();
    await flush();
    await open(view);

    const field = view.container.querySelector(
      '[data-testid="equation-popup-input"]'
    ) as HTMLInputElement;
    const helpId = field.getAttribute('aria-describedby')!.split(' ')[0]!;
    expect(view.container.querySelector(`[id="${helpId}"]`)?.textContent).toContain('Use x^2');
    input(view, 'x^');
    await nextTick();
    click(view, 'equation-popup-apply');
    await nextTick();
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain(
      'could not be applied'
    );

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();
    expect(view.container.querySelector('[data-testid="equation-popup"]')).toBeNull();
    expect(document.activeElement).toBe(view.container.querySelector('.docx-pages'));
    view.unmount();
  });

  test('closes outside without restoring focus and deletes with focus restoration', async () => {
    const view = mount();
    await flush();
    await open(view);
    const outside = document.createElement('button');
    view.container.append(outside);
    outside.focus();
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await nextTick();
    expect(view.container.querySelector('[data-testid="equation-popup"]')).toBeNull();
    expect(document.activeElement).toBe(outside);

    await open(view);
    click(view, 'equation-popup-delete');
    await flush();
    expect(view.container.querySelector('[data-docx-equation]')).toBeNull();
    expect(view.container.querySelector('[data-testid="equation-popup"]')).toBeNull();
    expect(document.activeElement).toBe(view.container.querySelector('.docx-pages'));
    view.unmount();
  });

  test('closes when the same editor loads a replacement document', async () => {
    const view = mount();
    await flush();
    await open(view);
    input(view, 'stale');

    view.editor().load(REPLACEMENT_SOURCE);
    await flush();

    expect(view.container.querySelector('[data-testid="equation-popup"]')).toBeNull();
    expect(view.editor().surface!.equations.equationAtCaret()?.linear).toBe('y');
    view.unmount();
  });

  test('closes when an external edit removes the active equation', async () => {
    const view = mount();
    await flush();
    await open(view);
    const equationId = view.editor().surface!.equations.equationAtCaret()!.id;

    expect(view.editor().surface!.equations.removeEquation(equationId)).toBe(true);
    await flush();

    expect(view.container.querySelector('[data-testid="equation-popup"]')).toBeNull();
    view.unmount();
  });

  test('disables mutations with the localized viewing reason', async () => {
    const view = mount('view');
    await flush();
    await open(view);
    const apply = view.container.querySelector(
      '[data-testid="equation-popup-apply"]'
    ) as HTMLButtonElement;
    const remove = view.container.querySelector(
      '[data-testid="equation-popup-delete"]'
    ) as HTMLButtonElement;

    expect(apply.disabled).toBe(true);
    expect(remove.disabled).toBe(true);
    expect(
      view.container.querySelector('[data-testid="equation-popup-disabled-reason"]')?.textContent
    ).toContain('open for viewing');
    view.unmount();
  });

  test('does not apply Enter while an input method is composing', async () => {
    const view = mount();
    await flush();
    await open(view);
    const equationId = view.editor().surface!.equations.equationAtCaret()!.id;
    input(view, 'y');
    const field = view.container.querySelector(
      '[data-testid="equation-popup-input"]'
    ) as HTMLInputElement;

    field.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true })
    );
    await nextTick();

    expect(view.container.querySelector('[data-testid="equation-popup"]')).not.toBeNull();
    expect(view.editor().surface!.equations.equationById(equationId)?.linear).toBe('x^{2}');
    view.unmount();
  });

  test('removes document listeners when the popover unmounts', async () => {
    const view = mount();
    await flush();
    const ownerDocument = view.container.ownerDocument;
    const originalAdd = ownerDocument.addEventListener.bind(ownerDocument);
    const originalRemove = ownerDocument.removeEventListener.bind(ownerDocument);
    let added = 0;
    let removed = 0;
    ownerDocument.addEventListener = ((type: string, ...args: unknown[]) => {
      if (type === 'keydown' || type === 'mousedown') added++;
      return originalAdd(type, ...(args as [EventListenerOrEventListenerObject, boolean?]));
    }) as typeof ownerDocument.addEventListener;
    ownerDocument.removeEventListener = ((type: string, ...args: unknown[]) => {
      if (type === 'keydown' || type === 'mousedown') removed++;
      return originalRemove(type, ...(args as [EventListenerOrEventListenerObject, boolean?]));
    }) as typeof ownerDocument.removeEventListener;
    try {
      await open(view);
      view.unmount();
      expect(added).toBe(2);
      expect(removed).toBe(2);
    } finally {
      ownerDocument.addEventListener = originalAdd as typeof ownerDocument.addEventListener;
      ownerDocument.removeEventListener =
        originalRemove as typeof ownerDocument.removeEventListener;
    }
  });
});
