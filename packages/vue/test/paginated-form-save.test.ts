import './dom-setup.ts';
import { expect, test } from 'bun:test';
import { createApp, h, ref } from 'vue';
import {
  PaginatedDocxEditor,
  type PaginatedDocxEditorHandle,
} from '../src/components/PaginatedDocxEditor';
import { formFieldDocx } from '../../core/src/editor/__tests__/form-field-docx.fixture';
import { openTreeSession } from '@docx-editor.dev/core/binding';
import { flush } from './helpers/mount';

test('the paginated Vue ref validates pending form input before saving', async () => {
  const handleRef = ref<PaginatedDocxEditorHandle>();
  const source = formFieldDocx(true);
  const app = createApp({ render: () => h(PaginatedDocxEditor, { source, ref: handleRef }) });
  const container = document.createElement('div');
  document.body.append(container);
  app.mount(container);
  try {
    await flush();
    const handle = handleRef.value!;
    handle.navigate('documentStart');
    for (let i = 0; i < 10; i++) handle.navigate('right', true);
    handle.type('invalid');
    expect(() => handle.save()).toThrow(expect.objectContaining({ code: 'invalidArgs' }));
    handle.undo();
    const saved = openTreeSession(handle.save()!);
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(saved.session.bodyText()).toBe('01/02/2030 tail');
  } finally {
    app.unmount();
    container.remove();
  }
});
