import '../../../packages/react/test/dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, expect, test } from 'bun:test';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { DocxEditor, useDocxEditor } from '@docx-editor.dev/react';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { exampleText as t } from '../../shared/example-text';
import { reviewModule } from '@docx-editor.dev/pro';
import {
  EXAMPLE_REVIEW_PANE,
  ReviewSettings,
  storedReviewPane,
  useStoredReviewPane,
} from './ReviewSettings';

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

test('storedReviewPane starts closed and keeps only valid saved settings', () => {
  expect(storedReviewPane()).toBe(EXAMPLE_REVIEW_PANE);
  expect(EXAMPLE_REVIEW_PANE.opening).toBe('manual');
  expect(EXAMPLE_REVIEW_PANE.commentMarkers).toBe('initials');
  expect(EXAMPLE_REVIEW_PANE.revisionsIn).toBe('balloons');
  localStorage.setItem(KEY, JSON.stringify({ commentMarkers: 'icon', stray: 'x' }));
  expect(storedReviewPane()).toMatchObject({ commentMarkers: 'icon', opening: 'manual' });
  localStorage.setItem(KEY, JSON.stringify({ commentMarkers: 'sticker' }));
  expect(storedReviewPane()).toBe(EXAMPLE_REVIEW_PANE);
  localStorage.setItem(KEY, '{not json');
  expect(storedReviewPane()).toBe(EXAMPLE_REVIEW_PANE);
});

function mount() {
  let editor: DocxEditorInstance | null = null;
  // The demo gives each editor the saved settings once, under the Root.
  function Capture() {
    editor = useDocxEditor();
    useStoredReviewPane();
    return null;
  }
  function Settings() {
    const [mode, setMode] = useState<'light' | 'dark'>('light');
    const [rulers, setRulers] = useState(false);
    return (
      <ReviewSettings
        colorMode={mode}
        onColorModeChange={setMode}
        rulers={rulers}
        onRulersChange={setRulers}
      />
    );
  }
  const container = document.createElement('div');
  document.body.append(container);
  const view = render(
    <DocxEditor.Root modules={MODULES}>
      <Capture />
      <Settings />
    </DocxEditor.Root>,
    { container }
  );
  return { view, controls: within(container), editor: () => editor };
}

test('a review setting applies to the editor and is saved', async () => {
  const { view, controls, editor } = mount();
  await act(async () => {
    fireEvent.click(controls.getByRole('radio', { name: t('reviewSettings.commentMarkers.icon') }));
  });
  expect(editor()?.snapshot().reviewPane.commentMarkers).toBe('icon');
  expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').commentMarkers).toBe('icon');
  view.unmount();
});

test('the theme choice reports the picked mode', async () => {
  const { view, controls } = mount();
  const dark = controls.getByRole('radio', { name: t('demoPanel.theme.dark') }) as HTMLInputElement;
  expect(dark.checked).toBe(false);
  await act(async () => {
    fireEvent.click(dark);
  });
  expect(dark.checked).toBe(true);
  view.unmount();
});

test('the rulers switch reports the choice', async () => {
  const { view, controls } = mount();
  const rulers = controls.getByRole('checkbox', {
    name: t('demoPanel.rulers'),
  }) as HTMLInputElement;
  expect(rulers.checked).toBe(false);
  await act(async () => {
    fireEvent.click(rulers);
  });
  expect(rulers.checked).toBe(true);
  view.unmount();
});

test('the example starts with the pane closed when nothing is saved', () => {
  const { view, editor } = mount();
  expect(editor()?.snapshot().reviewPane.opening).toBe('manual');
  view.unmount();
});

test('reset restores the example defaults and forgets the saved settings', async () => {
  localStorage.setItem(KEY, JSON.stringify({ overflow: 'scroll', opening: 'auto' }));
  const { view, controls, editor } = mount();
  expect(editor()?.snapshot().reviewPane.overflow).toBe('scroll');
  await act(async () => {
    fireEvent.click(controls.getByRole('button', { name: t('reviewSettings.reset') }));
  });
  expect(editor()?.snapshot().reviewPane).toMatchObject({ overflow: 'float', opening: 'manual' });
  expect(localStorage.getItem(KEY)).toBeNull();
  view.unmount();
});
