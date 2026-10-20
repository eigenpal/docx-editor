import './dom-setup.ts';
import { afterEach, describe, expect, test } from 'bun:test';
import { h } from 'vue';
import { en } from '@docx-editor.dev/i18n';
import type { EditorModule } from '@docx-editor.dev/core/editor';
import { DocxEditorToolbar } from '../src/editor/toolbar';
import { mountEditorTree, flush, SOURCE, type MountedEditor } from './helpers/mount';

const review: EditorModule = {
  id: 'review',
  review: {
    displayModes: ['all-markup', 'proposed', 'original'],
    collectReviewItems: () => [],
    revisionItemsOfParagraph: () => [],
  },
};
const mounted: MountedEditor[] = [];
afterEach(() => { for (const view of mounted.splice(0)) view.unmount(); });

async function mount() {
  const view = mountEditorTree(() => h(DocxEditorToolbar), SOURCE, () => [], [review]);
  mounted.push(view);
  await flush();
  return view;
}
function button(view: MountedEditor, name: string): HTMLButtonElement {
  return view.container.querySelector<HTMLButtonElement>(`[data-testid="editing-mode-${name}"]`)!;
}

describe('Vue suggesting author gate', () => {
  test('the open menu tracks author arrival and removal without changing the mode', async () => {
    const view = await mount();
    expect(button(view, 'trigger').disabled).toBe(false);
    button(view, 'trigger').click();
    await flush();
    expect(button(view, 'suggesting').disabled).toBe(true);
    expect(button(view, 'suggesting').title).toBe(en.disabledReason.suggestingNeedsAuthor);
    view.editor().setAuthor('Ada');
    await flush();
    expect(button(view, 'suggesting').disabled).toBe(false);
    expect(button(view, 'suggesting').title).toBe('');
    view.editor().setAuthor(undefined);
    await flush();
    expect(button(view, 'suggesting').disabled).toBe(true);
    expect(button(view, 'viewing').disabled).toBe(false);
    button(view, 'viewing').click();
    await flush();
    expect(view.editor().getEditingMode()).toBe('viewing');
  });

  test('keyboard travel skips Suggesting when no author exists', async () => {
    const view = await mount();
    button(view, 'trigger').click();
    await flush();
    expect(document.activeElement).toBe(button(view, 'editing'));
    button(view, 'editing').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(button(view, 'viewing'));
  });
});
