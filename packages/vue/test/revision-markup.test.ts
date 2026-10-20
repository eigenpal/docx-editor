import './dom-setup.ts';
import { expect, test } from 'bun:test';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import type {
  DocxEditorInstance,
  ResolvedRevisionMarkup,
  RevisionMarkupOptions,
} from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorRevisionMarkup } from '../src/editor/DocxEditorRevisionMarkup';

test('Vue markup props and declarations update the same instance and event', async () => {
  let editor: DocxEditorInstance | null = null;
  const changes: ResolvedRevisionMarkup[] = [];
  const settings = ref<RevisionMarkupOptions>({ insertions: { mark: 'bold' } });
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp(
    defineComponent({
      setup: () => () =>
        h(
          DocxEditorRoot,
          {
            document: 'blank',
            revisionMarkup: settings.value,
            onReady: (value: unknown) => {
              editor = value as DocxEditorInstance;
            },
            onRevisionMarkupChange: (value: ResolvedRevisionMarkup) => changes.push(value),
          }
        ),
    })
  );
  try {
    app.mount(container);
    await nextTick();
    await nextTick();
    const instance = editor!;
    expect(instance.snapshot().revisionMarkup.insertions.mark).toBe('bold');

    instance.setRevisionMarkup({ deletions: { color: 'blue' } });
    expect(changes.at(-1)?.deletions.color).toBe('blue');
    await nextTick();
    expect(instance.snapshot().revisionMarkup.deletions.color).toBe('byAuthor');
    expect(changes).toHaveLength(1);
    settings.value = { insertions: { mark: 'italic' } };
    await nextTick();
    expect(editor as DocxEditorInstance | null).toBe(instance);
    expect(instance.snapshot().revisionMarkup.insertions.mark).toBe('italic');
  } finally {
    app.unmount();
    container.remove();
  }
});


test('Vue controlled markup accepts host updates without duplicate callbacks', async () => {
  let editor: DocxEditorInstance | null = null;
  const changes: ResolvedRevisionMarkup[] = [];
  const settings = ref<RevisionMarkupOptions>({});
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp(defineComponent({
    setup: () => () => h(DocxEditorRoot, {
      document: 'blank', revisionMarkup: settings.value,
      onReady: (value: unknown) => { editor = value as DocxEditorInstance; },
      onRevisionMarkupChange: (value: ResolvedRevisionMarkup) => {
        changes.push(value); settings.value = value;
      },
    }),
  }));
  try {
    app.mount(container);
    await nextTick();
    await nextTick();
    editor!.setRevisionMarkup({ insertions: { mark: 'bold' } });
    await nextTick();
    expect(editor!.snapshot().revisionMarkup.insertions.mark).toBe('bold');
    expect(changes).toHaveLength(1);
  } finally { app.unmount(); container.remove(); }
});


test('Vue markup declarations leave other settings uncontrolled', async () => {
  let editor: DocxEditorInstance | null = null;
  const changes: ResolvedRevisionMarkup[] = [];
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp(defineComponent({
    setup: () => () => h(DocxEditorRoot, {
      document: 'blank',
      onReady: (value: unknown) => { editor = value as DocxEditorInstance; },
    }, { default: () => h(DocxEditorRevisionMarkup, {
      movedTo: { mark: 'bold' },
      onRevisionMarkupChange: (value: ResolvedRevisionMarkup) => changes.push(value),
    }) }),
  }));
  try {
    app.mount(container);
    await nextTick();
    await nextTick();
    expect(editor!.snapshot().revisionMarkup.movedTo.mark).toBe('bold');
    editor!.setRevisionMarkup({ deletions: { color: 'blue' } });
    await nextTick();
    expect(editor!.snapshot().revisionMarkup.deletions.color).toBe('blue');
    expect(changes.at(-1)).toBe(editor!.snapshot().revisionMarkup);
  } finally { app.unmount(); container.remove(); }
});
