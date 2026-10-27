import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { unzipSync, strFromU8 } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import {
  drawingNeedsPreview,
  drawingPreviewController,
  observeUnsupportedElements,
  type DrawingPreviewRequest,
  type UnsupportedElement,
} from '../index.ts';
import { previewDocument, previewShape } from '../../store/__tests__/drawing-support-fixtures.ts';

const paragraphs = Array.from(
  { length: 4 },
  (_, i) => `<w:p><w:r><w:t>Paragraph ${i}</w:t></w:r></w:p>`
).join('');

function mount(effect = '') {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: previewDocument(`${previewShape(effect)}</w:r></w:p>${paragraphs}<w:p><w:r>`),
    unsupportedElementRules: [{ includeRenderedDrawings: true }],
  });
  let elements: UnsupportedElement[] = [];
  const stop = observeUnsupportedElements(container, (hosts) => {
    elements = hosts.map((host) => host.unsupported);
  });
  return {
    editor,
    element: () => elements[0]!,
    destroy() {
      stop();
      editor.destroy();
      container.remove();
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('occurrences report support, and the default match keeps native drawings', () => {
  const native = mount();
  const partial = mount('<a:effectLst><a:blur rad="127000"/></a:effectLst>');
  try {
    expect(native.element().support).toBe('native');
    expect(drawingNeedsPreview(native.element())).toBe(false);
    expect(partial.element().support).toBe('partial');
    expect(drawingNeedsPreview(partial.element())).toBe(true);
  } finally {
    native.destroy();
    partial.destroy();
  }
});

test('a preview is requested once with a drawing-only DOCX and reused after unrelated edits', async () => {
  const view = mount();
  const requests: DrawingPreviewRequest[] = [];
  const render = async (request: DrawingPreviewRequest) => {
    requests.push(request);
    return 'https://previews.example/one.png';
  };
  try {
    const controller = drawingPreviewController(view.editor);
    expect(drawingPreviewController(view.editor)).toBe(controller);
    const stop = controller.subscribe(() => {});
    expect(controller.state(view.element()).status).toBe('idle');
    controller.request(view.element(), render);
    controller.request(view.element(), render);
    expect(controller.state(view.element()).status).toBe('loading');
    await settle();
    expect(requests).toHaveLength(1);
    const xml = strFromU8(unzipSync(requests[0]!.docx)['word/document.xml']!);
    expect(xml).toContain('wps:wsp');
    expect(xml).not.toContain('Paragraph 0');
    expect(controller.state(view.element())).toEqual({
      status: 'ready',
      url: 'https://previews.example/one.png',
      error: null,
    });

    const ids = view.editor.surface!.session.paragraphIds();
    const last = ids[ids.length - 2]!;
    view.editor.surface!.setSelection({
      anchor: { paragraphId: last, offset: 1 },
      head: { paragraphId: last, offset: 1 },
    });
    expect(view.editor.exec({ type: 'insertText', text: 'X' }).ok).toBe(true);
    controller.request(view.element(), render);
    await settle();
    expect(requests).toHaveLength(1);
    expect(controller.state(view.element()).status).toBe('ready');
    stop();
  } finally {
    view.destroy();
  }
});

test('a changed drawing keeps its previous image while loading, and failures can retry', async () => {
  const view = mount();
  const other = mount('<a:effectLst><a:blur rad="127000"/></a:effectLst>');
  let fail = true;
  const calls: AbortSignal[] = [];
  const render = async ({ signal }: DrawingPreviewRequest) => {
    calls.push(signal);
    if (calls.length === 1) return 'https://previews.example/first.png';
    if (fail) throw new Error('service down');
    return new Blob(['png'], { type: 'image/png' });
  };
  try {
    const controller = drawingPreviewController(view.editor);
    const stop = controller.subscribe(() => {});
    controller.request(view.element(), render);
    await settle();
    // The same occurrence with a different source: an edited drawing.
    const edited = { ...view.element(), source: other.element().source };
    controller.request(edited, render);
    expect(controller.state(edited)).toEqual({
      status: 'loading',
      url: 'https://previews.example/first.png',
      error: null,
    });
    await settle();
    const failed = controller.state(edited);
    expect(failed.status).toBe('error');
    expect(failed.url).toBe('https://previews.example/first.png');
    expect(failed.error?.kind === 'render' && (failed.error.cause as Error).message).toBe(
      'service down'
    );
    fail = false;
    controller.retry(edited, render);
    await settle();
    const ready = controller.state(edited);
    expect(ready.status).toBe('ready');
    expect(ready.url).not.toBe('https://previews.example/first.png');
    stop();
  } finally {
    view.destroy();
    other.destroy();
  }
});

test('a null result leaves the drawing unavailable for preview', async () => {
  const view = mount();
  try {
    const controller = drawingPreviewController(view.editor);
    controller.request(view.element(), async () => null);
    await settle();
    expect(controller.state(view.element()).status).toBe('unavailable');
  } finally {
    view.destroy();
  }
});

test('at most four requests run at once; the rest wait their turn', async () => {
  const shapes = Array.from({ length: 6 }, (_, i) =>
    previewShape(`<a:effectLst><a:blur rad="${1000 + i}"/></a:effectLst>`)
  ).join('');
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: previewDocument(shapes),
    unsupportedElementRules: [{ includeRenderedDrawings: true }],
  });
  let elements: UnsupportedElement[] = [];
  const stop = observeUnsupportedElements(container, (hosts) => {
    elements = hosts.map((host) => host.unsupported);
  });
  const pending: (() => void)[] = [];
  const render = () =>
    new Promise<string>((resolve) => pending.push(() => resolve('https://previews.example/x.png')));
  try {
    expect(elements).toHaveLength(6);
    const controller = drawingPreviewController(editor);
    for (const element of elements) controller.request(element, render);
    await settle();
    expect(pending).toHaveLength(4);
    expect(elements.every((element) => controller.state(element).status === 'loading')).toBe(true);
    pending[0]!();
    await settle();
    expect(pending).toHaveLength(5);
  } finally {
    stop();
    editor.destroy();
    container.remove();
  }
});
