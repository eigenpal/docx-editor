import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { createApp, h, type App } from 'vue';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { DocxEditorPageNumber } from '../src/editor/DocxEditorPageNumber';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { docx, flush } from './helpers/fixtures';

const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
const THREE_PAGES = docx(
  paragraph('one') + pageBreak + paragraph('two') + pageBreak + paragraph('three')
);

let mounted: { app: App; container: HTMLElement } | null = null;
afterEach(() => {
  mounted?.app.unmount();
  mounted?.container.remove();
  mounted = null;
});

async function mount(inside: boolean) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const app = createApp({
    render: () =>
      h(DocxEditorRoot, { document: THREE_PAGES }, () =>
        h('div', { class: 'host-workspace', style: { position: 'relative' } }, [
          h(DocxEditorViewport, null, () => [
            h(DocxEditorContent),
            ...(inside ? [h(DocxEditorPageNumber)] : []),
          ]),
          ...(inside ? [] : [h(DocxEditorPageNumber)]),
        ])
      ),
  });
  app.mount(container);
  mounted = { app, container };
  await flush();
  return container;
}

describe('DocxEditorPageNumber placement', () => {
  for (const inside of [false, true]) {
    test(`stays outside the scroll container when placed ${inside ? 'inside' : 'beside'} the viewport`, async () => {
      const container = await mount(inside);
      const viewport = container.querySelector<HTMLElement>('[data-testid="docx-editor-scroll"]')!;
      const workspace = container.querySelector<HTMLElement>('.host-workspace')!;
      const status = container.querySelector<HTMLElement>('[role="status"]')!;
      expect(status).not.toBeNull();
      // A direct child of the positioned wrapper, so scrolling the pages never moves it.
      expect(status.parentElement).toBe(workspace);
      expect(viewport.contains(status)).toBe(false);
      // The wrapper is not scoped, so the indicator scopes itself.
      expect(status.classList.contains('docx-editor')).toBe(true);

      Object.defineProperty(viewport, 'clientHeight', { value: 300, configurable: true });
      viewport.scrollTop = 400;
      viewport.dispatchEvent(new Event('scroll'));
      await flush();
      expect(status.getAttribute('data-visible')).toBe('true');
      expect(status.textContent).toContain('of 3');
    });
  }

  test('does not scope itself again under a scoped wrapper', async () => {
    const scoped = document.createElement('div');
    document.body.appendChild(scoped);
    const app = createApp({
      render: () =>
        h(DocxEditorRoot, { document: THREE_PAGES }, () =>
          h('div', { class: 'docx-editor host-workspace' }, [
            h(DocxEditorViewport, null, () => [h(DocxEditorContent), h(DocxEditorPageNumber)]),
          ])
        ),
    });
    app.mount(scoped);
    mounted = { app, container: scoped };
    await flush();
    const status = scoped.querySelector<HTMLElement>('[role="status"]')!;
    expect(status.parentElement?.classList.contains('host-workspace')).toBe(true);
    expect(status.classList.contains('docx-editor')).toBe(false);
  });
});
