import '../../../packages/react/test/dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { DocxEditor, useDocxEditor } from '@docx-editor.dev/react';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { exampleText as t } from '../../shared/example-text';
import { reviewModule } from '@docx-editor.dev/pro';
import { ReviewSettings, storedReviewPane } from './ReviewSettings';

// The review pane settings belong to the review module.
const MODULES = [reviewModule()];

const KEY = 'docx-editor-demo.review-pane';
let previous: string | null;

beforeEach(() => {
  previous = localStorage.getItem(KEY);
  localStorage.removeItem(KEY);
});

afterEach(() => {
  cleanup();
  if (previous === null) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, previous);
});

test('storedReviewPane keeps valid saved settings and drops invalid ones', () => {
  expect(storedReviewPane()).toBeUndefined();
  localStorage.setItem(KEY, JSON.stringify({ commentMarkers: 'icon', stray: 'x' }));
  expect(storedReviewPane()?.commentMarkers).toBe('icon');
  localStorage.setItem(KEY, JSON.stringify({ commentMarkers: 'sticker' }));
  expect(storedReviewPane()).toBeUndefined();
  localStorage.setItem(KEY, '{not json');
  expect(storedReviewPane()).toBeUndefined();
});

function mount() {
  let editor: DocxEditorInstance | null = null;
  function Capture() {
    editor = useDocxEditor();
    return null;
  }
  const container = document.createElement('div');
  document.body.append(container);
  const view = render(
    <DocxEditor.Root modules={MODULES}>
      <Capture />
      <ReviewSettings />
    </DocxEditor.Root>,
    { container }
  );
  return { view, controls: within(container), editor: () => editor };
}

test('the panel applies a setting, saves it, and Escape returns focus to the gear', async () => {
  const { view, controls, editor } = mount();
  const gear = controls.getByRole('button', { name: t('reviewSettings.open') });

  await act(async () => {
    fireEvent.click(gear);
  });
  const dialog = controls.getByRole('dialog', { name: t('reviewSettings.title') });
  expect(gear.getAttribute('aria-expanded')).toBe('true');
  // Focus moves to the selected option of the first group.
  expect(document.activeElement?.getAttribute('value')).toBe('pane');

  await act(async () => {
    fireEvent.click(
      within(dialog).getByRole('radio', { name: t('reviewSettings.commentMarkers.icon') })
    );
  });
  expect(editor()?.snapshot().reviewPane.commentMarkers).toBe('icon');
  expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').commentMarkers).toBe('icon');

  await act(async () => {
    fireEvent.keyDown(document, { key: 'Escape' });
  });
  expect(controls.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(gear);
  view.unmount();
});

test('reset restores the defaults and forgets the saved settings', async () => {
  localStorage.setItem(KEY, JSON.stringify({ overflow: 'scroll' }));
  const { view, controls, editor } = mount();
  expect(editor()?.snapshot().reviewPane.overflow).toBe('scroll');

  await act(async () => {
    fireEvent.click(controls.getByRole('button', { name: t('reviewSettings.open') }));
  });
  await act(async () => {
    fireEvent.click(controls.getByRole('button', { name: t('reviewSettings.reset') }));
  });
  expect(editor()?.snapshot().reviewPane.overflow).toBe('float');
  expect(localStorage.getItem(KEY)).toBeNull();
  view.unmount();
});
