/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { fireEvent, getByLabelText, getByRole } from '@testing-library/react';
import {
  createT,
  deepMerge,
  en,
  locales,
  type LocaleStrings,
  type TranslationKey,
} from '@docx-editor.dev/i18n';
import {
  DEFAULT_REVISION_MARKUP,
  createDocxEditor,
  type RevisionMarkupOptions,
  type ResolvedRevisionMarkup,
} from '@docx-editor.dev/core/editor';
import { reviewModule } from '../review/review-module';

let cleanup = () => {};
afterEach(() => cleanup());
function setup(translate?: Parameters<typeof createDocxEditor>[0]['translate']) {
  const container = document.createElement('div');
  document.body.append(container);
  const changes: ResolvedRevisionMarkup[] = [];
  const editor = createDocxEditor({
    container,
    document: 'blank',
    translate,
    modules: [reviewModule({})],
  });
  editor.on('revisionMarkupChange', (value) => changes.push(value));
  const set = (value: RevisionMarkupOptions) => editor.setRevisionMarkup(value);
  const dialog = {
    open: () => editor.exec({ type: 'openRevisionMarkupDialog' }),
    destroy: () => editor.destroy(),
  };
  cleanup = () => {
    editor.destroy();
    container.remove();
  };
  dialog.open();
  return { container, dialog, changes, set, get: () => editor.snapshot().revisionMarkup };
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

test('review layout choices stage and apply like every other preference', () => {
  const host = setup();
  const revisionsIn = getByLabelText(
    host.container,
    'Show tracked changes in'
  ) as HTMLSelectElement;
  const markers = getByLabelText(host.container, 'Comment markers') as HTMLSelectElement;
  expect(revisionsIn.value).toBe('pane');
  expect(markers.value).toBe('avatar');
  fireEvent.change(revisionsIn, { target: { value: 'balloons' } });
  fireEvent.change(markers, { target: { value: 'icon' } });
  expect(host.get().revisionsIn).toBe('pane');
  fireEvent.click(getByRole(host.container, 'button', { name: 'OK' }));
  expect(host.get().revisionsIn).toBe('balloons');
  expect(host.get().commentMarkers).toBe('icon');
  expect(() => host.set({ revisionsIn: 'margin' as never })).toThrow(TypeError);
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

test('labels controls, omits the preview, closes with Escape, and removes its subscription', () => {
  const host = setup();
  const dialog = getByRole(host.container, 'dialog', { name: 'Track changes options' });
  expect(host.container.querySelector('.docx-revision-markup-preview')).toBeNull();
  for (const control of host.container.querySelectorAll('select,input'))
    expect(control.closest('label')).not.toBeNull();
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(host.container.querySelector('dialog')).toBeNull();
  expect(host.changes).toHaveLength(0);
  host.dialog.destroy();
  expect(host.container.querySelector('dialog')).toBeNull();
});

test('shows selected cell and line colors without sending editing keys to the page', () => {
  const host = setup();
  host.set({ cells: { inserted: 'green' }, changedLines: { color: 'red' } });
  const color = getByRole(host.container, 'button', { name: 'Inserted cells Green' });
  expect(
    (color.querySelector('.docx-revision-color-swatch') as HTMLElement).style.backgroundColor
  ).toBe('var(--doc-revision-color-green)');
  const lineColor = getByRole(host.container, 'button', { name: 'Changed lines color Red' });
  expect(
    (lineColor.querySelector('.docx-revision-color-swatch') as HTMLElement).style.backgroundColor
  ).toBe('var(--doc-revision-color-red)');
  let keydown = false;
  host.container.addEventListener('keydown', () => {
    keydown = true;
  });
  fireEvent.keyDown(color, { key: 'b', ctrlKey: true });
  expect(keydown).toBe(false);
});

test('color palettes use compact toolbar swatches', () => {
  const host = setup();
  const trigger = getByRole(host.container, 'button', { name: 'Insertions color By author' });
  fireEvent.click(trigger);
  const group = getByRole(host.container, 'group', { name: 'Insertions color' });
  const blue = getByRole(group, 'button', { name: 'Blue' });
  expect(blue.classList.contains('docx-toolbar__swatch')).toBe(true);
  expect(blue.getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(blue, { detail: 1 });
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(trigger.textContent).toContain('Blue');
  expect(host.changes).toHaveLength(0);
  fireEvent.click(getByRole(host.container, 'button', { name: 'OK' }));
  expect(host.get().insertions.color).toBe('blue');
});

test('keyboard navigation focuses colors without changing the draft', () => {
  const host = setup();
  const trigger = getByRole(host.container, 'button', { name: 'Insertions color By author' });
  fireEvent.click(trigger);
  const group = getByRole(host.container, 'group', { name: 'Insertions color' });
  const author = getByRole(group, 'button', { name: 'By author' });
  expect(document.activeElement).toBe(author);
  fireEvent.keyDown(author, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(getByRole(group, 'button', { name: 'Auto' }));
  expect(trigger.textContent).toContain('By author');
  fireEvent.keyDown(document.activeElement!, { key: 'End' });
  expect(document.activeElement).toBe(Array.from(group.querySelectorAll('button')).at(-1)!);
  fireEvent.keyDown(document.activeElement!, { key: 'Home' });
  expect(document.activeElement).toBe(author);
  fireEvent.keyDown(author, { key: 'Escape' });
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(trigger);
  expect(host.container.querySelector('dialog')).not.toBeNull();
  fireEvent.click(trigger);
  const blue = getByRole(group, 'button', { name: 'Blue' });
  blue.focus();
  fireEvent.click(blue, { detail: 0 });
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(trigger.textContent).toContain('Blue');
  expect(document.activeElement).toBe(trigger);
});

test.each([
  ['byAuthor', 'By author'],
  ['lightPurple', 'Light purple'],
  ['lightGreen', 'Light green'],
  ['gray', 'Gray'],
] as const)('native cell palette applies %s', (value, label) => {
  const host = setup();
  fireEvent.click(getByRole(host.container, 'button', { name: 'Inserted cells Light blue' }));
  const group = getByRole(host.container, 'group', { name: 'Inserted cells' });
  fireEvent.click(getByRole(group, 'button', { name: label }), { detail: 1 });
  expect(host.changes).toHaveLength(0);
  fireEvent.click(getByRole(host.container, 'button', { name: 'OK' }));
  expect(host.get().cells.inserted).toBe(value);
});

test('text backgrounds default to None, stage separately, and reset without changing document colors', () => {
  const host = setup();
  for (const name of ['Insertions', 'Deletions', 'Moved from', 'Moved to', 'Formatting']) {
    fireEvent.click(getByRole(host.container, 'button', { name: `${name} background None` }));
    const group = getByRole(host.container, 'group', { name: `${name} background` });
    fireEvent.click(getByRole(group, 'button', { name: 'Light yellow' }), { detail: 1 });
  }
  expect(host.changes).toHaveLength(0);
  fireEvent.click(getByRole(host.container, 'button', { name: 'OK' }));
  for (const key of ['insertions', 'deletions', 'movedFrom', 'movedTo', 'formatting'] as const) {
    expect(host.get()[key].background).toBe('lightYellow');
    expect(host.get()[key].color).toBe(DEFAULT_REVISION_MARKUP[key].color);
  }
  host.dialog.open();
  fireEvent.click(getByRole(host.container, 'button', { name: 'Reset to defaults' }));
  expect(getByRole(host.container, 'button', { name: 'Insertions background None' })).toBeTruthy();
  fireEvent.click(getByRole(host.container, 'button', { name: 'Cancel' }));
  expect(host.get().insertions.background).toBe('lightYellow');
  host.dialog.open();
  host.set({ insertions: { background: 'byAuthor' }, trackMoves: false });
  expect(
    getByRole(host.container, 'button', { name: 'Insertions background By author' })
  ).toBeTruthy();
  expect(
    (
      getByRole(host.container, 'button', {
        name: 'Moved from background Light yellow',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
});

for (const [code, strings] of Object.entries(locales)) {
  test(`the ${code} dialog translates labels, options, help, and color controls`, () => {
    const translations = strings.revisionMarkup!;
    for (const [key, value] of Object.entries(translations)) {
      for (const text of typeof value === 'object' && value !== null
        ? Object.values(value)
        : [value]) {
        expect(typeof text, `${code}.revisionMarkup.${key}`).toBe('string');
        expect(text?.trim().length).toBeGreaterThan(0);
      }
    }
    const title = strings.revisionMarkup?.title;
    expect(typeof title).toBe('string');
    const t = createT(deepMerge(en, strings) as LocaleStrings, code);
    const host = setup((key) => t(key as TranslationKey));
    expect(getByRole(host.container, 'dialog', { name: title! })).not.toBeNull();
    const insertions = getByLabelText(host.container, translations.insertions!);
    expect(getByRole(insertions, 'option', { name: translations.values!.bold! })).toBeTruthy();
    const tracking = getByRole(host.container, 'checkbox', { name: translations.trackMoves! });
    expect(
      host.container.querySelector(`[id="${tracking.getAttribute('aria-describedby')}"]`)
        ?.textContent
    ).toBe(translations.trackMovesNote!);
    const color = getByRole(host.container, 'button', {
      name: `${translations.insertionsColor} ${translations.values!.byAuthor}`,
    });
    fireEvent.click(color);
    const palette = getByRole(host.container, 'group', { name: translations.insertionsColor! });
    fireEvent.click(getByRole(palette, 'button', { name: translations.values!.blue! }), {
      detail: 1,
    });
    expect(color.textContent).toContain(translations.values!.blue!);
    expect(
      getByRole(host.container, 'button', {
        name: `${translations.insertionsBackground} ${translations.values!.none}`,
      })
    ).toBeTruthy();
    fireEvent.click(getByRole(host.container, 'button', { name: translations.ok! }));
    expect(host.get().insertions.color).toBe('blue');
  });
}
