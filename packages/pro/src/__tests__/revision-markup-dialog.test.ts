/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { fireEvent, getByLabelText, getByRole } from '@testing-library/react';
import {
  DEFAULT_REVISION_MARKUP,
  resolveRevisionMarkup,
  type ResolvedRevisionMarkup,
} from '@docx-editor.dev/core/editor';
import { createRevisionMarkupDialog } from '../review/revision-markup-dialog';

let cleanup = () => {};
afterEach(() => cleanup());
function setup() {
  const container = document.createElement('div');
  document.body.append(container);
  let state = DEFAULT_REVISION_MARKUP;
  const listeners = new Set<() => void>();
  const changes: ResolvedRevisionMarkup[] = [];
  const set = (value: Parameters<typeof resolveRevisionMarkup>[0]) => {
    state = resolveRevisionMarkup(value, state);
    changes.push(state);
    listeners.forEach((listener) => listener());
  };
  const dialog = createRevisionMarkupDialog({
    container,
    get: () => state,
    set,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  cleanup = () => {
    dialog.destroy();
    container.remove();
  };
  dialog.open();
  return { container, dialog, changes, set, get: () => state, listeners };
}

test('stages settings, applies once, and reflects API changes in an open dialog', () => {
  const host = setup();
  const insertions = getByLabelText(host.container, 'Insertions') as HTMLSelectElement;
  fireEvent.change(insertions, { target: { value: 'bold' } });
  expect(host.changes).toHaveLength(0);
  host.set({ insertions: { mark: 'italic' }, trackMoves: false });
  expect(insertions.value).toBe('italic');
  expect((getByLabelText(host.container, 'Moved from') as HTMLSelectElement).disabled).toBe(true);
  fireEvent.change(insertions, { target: { value: 'doubleUnderline' } });
  fireEvent.click(getByRole(host.container, 'button', { name: 'OK' }));
  expect(host.changes).toHaveLength(2);
  expect(host.get().insertions.mark).toBe('doubleUnderline');
  expect(host.container.querySelector('dialog')).toBeNull();
});

test('Cancel discards draft settings; Reset only changes the draft', () => {
  const host = setup();
  host.set({ insertions: { mark: 'bold' } });
  fireEvent.click(getByRole(host.container, 'button', { name: 'Reset to defaults' }));
  expect(host.get().insertions.mark).toBe('bold');
  expect((getByLabelText(host.container, 'Insertions') as HTMLSelectElement).value).toBe(
    'underline'
  );
  fireEvent.click(getByRole(host.container, 'button', { name: 'Cancel' }));
  expect(host.get().insertions.mark).toBe('bold');
  host.dialog.open();
  fireEvent.click(getByRole(host.container, 'button', { name: 'Reset to defaults' }));
  fireEvent.click(getByRole(host.container, 'button', { name: 'OK' }));
  expect(host.get()).toEqual(DEFAULT_REVISION_MARKUP);
});

test('labels controls, exposes the preview, closes with Escape, and removes its subscription', () => {
  const host = setup();
  const dialog = getByRole(host.container, 'dialog', { name: 'Change tracking options' });
  expect(getByRole(host.container, 'img').getAttribute('aria-label')).toContain('Outside border');
  for (const control of host.container.querySelectorAll('select,input'))
    expect(control.closest('label')).not.toBeNull();
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(host.container.querySelector('dialog')).toBeNull();
  expect(host.changes).toHaveLength(0);
  host.dialog.destroy();
  expect(host.listeners.size).toBe(0);
});

test('shows selected cell and line colors without sending editing keys to the page', () => {
  const host = setup();
  host.set({ cells: { inserted: 'green' }, changedLines: { color: 'red' } });
  const color = getByRole(host.container, 'button', { name: 'Inserted cells Green' });
  expect(
    (color.querySelector('.docx-revision-color-swatch') as HTMLElement).style.backgroundColor
  ).toBe('var(--doc-revision-color-green)');
  const preview = getByRole(host.container, 'img') as HTMLElement;
  expect(preview.style.getPropertyValue('--doc-revision-preview-color')).toBe(
    'var(--doc-revision-color-red)'
  );
  let keydown = false;
  host.container.addEventListener('keydown', () => {
    keydown = true;
  });
  fireEvent.keyDown(color, { key: 'b', ctrlKey: true });
  expect(keydown).toBe(false);
});

test('color lists show swatches and support radio selection', () => {
  const host = setup();
  const trigger = getByRole(host.container, 'button', { name: 'Insertions color By author' });
  fireEvent.click(trigger);
  const group = getByRole(host.container, 'radiogroup', { name: 'Insertions color' });
  const blue = getByRole(group, 'radio', { name: 'Blue' });
  fireEvent.click(blue, { detail: 1 });
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(trigger.textContent).toContain('Blue');
  expect(host.changes).toHaveLength(0);
  fireEvent.click(getByRole(host.container, 'button', { name: 'OK' }));
  expect(host.get().insertions.color).toBe('blue');
});

test('keyboard radio selection keeps the palette open until Enter', () => {
  const host = setup();
  const trigger = getByRole(host.container, 'button', { name: 'Insertions color By author' });
  fireEvent.click(trigger);
  const group = getByRole(host.container, 'radiogroup', { name: 'Insertions color' });
  const blue = getByRole(group, 'radio', { name: 'Blue' });
  blue.focus();
  fireEvent.click(blue, { detail: 0 });
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  expect(trigger.textContent).toContain('Blue');
  expect(document.activeElement).toBe(blue);
  fireEvent.keyDown(blue, { key: 'Enter' });
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(trigger);
});
