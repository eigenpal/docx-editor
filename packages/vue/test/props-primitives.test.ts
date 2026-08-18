import './dom-setup.ts';

import { describe, expect, test } from 'bun:test';
import { createApp, h, nextTick } from 'vue';
import { HorizontalRuler } from '../src/components/ui/HorizontalRuler';
import { VerticalRuler, RULER_WIDTH } from '../src/components/ui/VerticalRuler';
import { DocumentOutline } from '../src/components/DocumentOutline';
import { PageIndicator } from '../src/components/DocxEditor/PageIndicator';
import { PaginatedDocxEditor } from '../src/components/PaginatedDocxEditor';
import { LocaleProvider } from '../src/i18n';

const PAGE_SETUP = {
  pageWidthTwips: 12240,
  pageHeightTwips: 15840,
  orientation: 'portrait' as const,
  marginsTwips: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
};

describe('props-driven primitives', () => {
  test('HorizontalRuler renders ticks from props alone', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp({
      render: () => h(HorizontalRuler, { pageSetup: PAGE_SETUP, zoom: 1 }),
    });
    app.mount(container);
    await nextTick();
    expect(container.querySelector('.docx-horizontal-ruler')).not.toBeNull();
    app.unmount();
  });

  test('VerticalRuler exports RULER_WIDTH and renders from props', async () => {
    expect(RULER_WIDTH).toBeGreaterThan(0);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp({
      render: () =>
        h(VerticalRuler, {
          pageSetup: PAGE_SETUP,
          zoom: 1,
          contentHeightPx: 800,
        }),
    });
    app.mount(container);
    await nextTick();
    expect(container.querySelector('.docx-vertical-ruler')).not.toBeNull();
    app.unmount();
  });

  test('DocumentOutline renders headings from props', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp({
      render: () =>
        h(LocaleProvider, null, {
          default: () =>
            h(DocumentOutline, {
              headings: [{ blockId: 'p1', level: 1, text: 'Intro' }],
              onHeadingClick: () => {},
              onClose: () => {},
            }),
        }),
    });
    app.mount(container);
    await nextTick();
    expect(container.textContent).toContain('Intro');
    app.unmount();
  });

  test('PageIndicator resolves copy through LocaleProvider', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp({
      render: () =>
        h(LocaleProvider, null, {
          default: () => h(PageIndicator, { currentPage: 2, totalPages: 5, visible: true }),
        }),
    });
    app.mount(container);
    await nextTick();
    expect(container.textContent).toMatch(/2.*5/);
    app.unmount();
  });

  test('PaginatedDocxEditor mounts without injected editor', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp({
      render: () => h(PaginatedDocxEditor, { source: bytes }),
    });
    app.mount(container);
    await nextTick();
    expect(container.querySelector('.docx-paginated-surface')).not.toBeNull();
    app.unmount();
  });
});
