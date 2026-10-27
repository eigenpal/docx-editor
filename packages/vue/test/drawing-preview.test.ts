import './dom-setup.ts';
import { expect, test } from 'bun:test';
import { createApp, h, nextTick } from 'vue';
import type { DrawingPreviewRequest } from '@docx-editor.dev/core/editor';

async function tick() {
  await new Promise((resolve) => setTimeout(resolve, 10));
  await nextTick();
}

async function waitFor(check: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (check()) return;
    await tick();
  }
  throw new Error(`Timed out waiting for ${label}`);
}

test('Vue DrawingPreview keeps the native drawing until the image is ready', async () => {
  const { previewDocument, previewShape } =
    await import('../../core/src/store/__tests__/drawing-support-fixtures.ts');
  const { DocxEditor } = await import('../src/index.ts');
  const bytes = previewDocument(previewShape('<a:effectLst><a:blur rad="127000"/></a:effectLst>'));
  const requests: DrawingPreviewRequest[] = [];
  let resolve: (value: string) => void = () => {};
  const render = (request: DrawingPreviewRequest) => {
    requests.push(request);
    return new Promise<string>((done) => {
      resolve = done;
    });
  };
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp({
    render: () =>
      h(
        DocxEditor,
        { document: bytes, chrome: false },
        { default: () => [h(DocxEditor.DrawingPreview, { render })] }
      ),
  });
  app.mount(container);
  try {
    await waitFor(() => requests.length === 1, 'the preview request');
    expect(requests[0]!.element.support).toBe('partial');
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('[data-docx-customized]')).toBeNull();
    resolve('https://previews.example/shape.png');
    await waitFor(() => container.querySelector('img[alt="Sample shape"]') !== null, 'the image');
    expect(container.querySelector('img')!.getAttribute('src')).toBe(
      'https://previews.example/shape.png'
    );
    expect(container.querySelector<HTMLElement>('.docx-drawing-native')!.hidden).toBe(true);
  } finally {
    app.unmount();
    container.remove();
  }
});

test('Vue DrawingPreview leaves native drawings alone by default', async () => {
  const { previewDocument, previewShape } =
    await import('../../core/src/store/__tests__/drawing-support-fixtures.ts');
  const { DocxEditor } = await import('../src/index.ts');
  let calls = 0;
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp({
    render: () =>
      h(
        DocxEditor,
        { document: previewDocument(previewShape()), chrome: false },
        {
          default: () => [
            h(DocxEditor.DrawingPreview, {
              render: async () => {
                calls++;
                return 'https://previews.example/unused.png';
              },
            }),
          ],
        }
      ),
  });
  app.mount(container);
  try {
    await waitFor(() => container.querySelector('svg') !== null, 'the native drawing');
    await tick();
    expect(calls).toBe(0);
  } finally {
    app.unmount();
    container.remove();
  }
});
