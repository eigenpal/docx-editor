/* eslint-disable react-hooks/rules-of-hooks -- Vue composables in defineComponent setup */
import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { toolbarCommandState } from '@docx-editor.dev/core/editor';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { useEditorCommand } from '../src/editor/useEditorCommand';
import { SEARCH_MATCH_LIMIT as VUE_SEARCH_LIMIT } from '../src/editor/navigation/useDocumentSearch';
import { stepZoomLevel as vueStepZoomLevel } from '../src/editor/zoom-levels';
import {
  DIFFERENTIAL_SLOTS,
  DIFFERENTIAL_SOURCE,
  OFF_LADDER_ZOOM,
  offLadderZoomIn,
} from '../../react/test/cross-adapter-shared';

const { SEARCH_MATCH_LIMIT: REACT_SEARCH_LIMIT } =
  await import('../../react/src/editor/navigation/useDocumentSearch.ts');
const { stepZoomLevel } = await import('../../react/src/editor/zoom-levels.ts');

async function flush(): Promise<void> {
  await nextTick();
  for (let i = 0; i < 10; i++) await new Promise((r) => queueMicrotask(r));
  await new Promise((r) => setTimeout(r, 150));
}

async function mountVue(onReady: (editor: Editor) => void) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const app = createApp({
    render: () =>
      h(
        DocxEditorRoot,
        { document: DIFFERENTIAL_SOURCE, onReady },
        {
          default: () =>
            h(DocxEditorViewport, null, {
              default: () => h(DocxEditorContent),
            }),
        }
      ),
  });
  app.mount(container);
  await flush();
  return { app, container };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('cross-adapter differential (Vue harness)', () => {
  for (const slot of DIFFERENTIAL_SLOTS) {
    test(`toolbar slot ${slot} matches engine command state`, async () => {
      let editor: DocxEditorInstance | null = null;
      const { app } = await mountVue((instance) => {
        editor = instance as DocxEditorInstance;
      });
      try {
        const engine = toolbarCommandState(editor!, slot);
        let binding: ReturnType<typeof useEditorCommand> | null = null;
        const Probe = defineComponent({
          setup() {
            binding = useEditorCommand(slot);
            return () => null;
          },
        });
        const probeApp = createApp({
          render: () =>
            h(
              DocxEditorRoot,
              { document: DIFFERENTIAL_SOURCE },
              {
                default: () =>
                  h(DocxEditorViewport, null, {
                    default: () => [h(DocxEditorContent), h(Probe)],
                  }),
              }
            ),
        });
        const probeContainer = document.createElement('div');
        document.body.appendChild(probeContainer);
        probeApp.mount(probeContainer);
        await flush();
        expect(binding!.isEnabled.value).toBe(engine.enabled);
        expect(binding!.isActive.value).toBe(engine.active);
        expect(binding!.disabledReason.value ?? null).toBe(engine.disabledReason ?? null);
        probeApp.unmount();
        probeContainer.remove();
      } finally {
        app.unmount();
      }
    });
  }

  test('off-ladder zoom step matches React ladder', () => {
    expect(stepZoomLevel(OFF_LADDER_ZOOM, 'in')).toBe(vueStepZoomLevel(OFF_LADDER_ZOOM, 'in'));
    expect(stepZoomLevel(OFF_LADDER_ZOOM, 'out')).toBe(vueStepZoomLevel(OFF_LADDER_ZOOM, 'out'));
  });

  test('search cap constant matches React export', () => {
    expect(REACT_SEARCH_LIMIT).toBe(VUE_SEARCH_LIMIT);
    expect(VUE_SEARCH_LIMIT).toBeGreaterThan(0);
  });

  test('page-setup write is one undo step', async () => {
    let editor: DocxEditorInstance | null = null;
    const { app } = await mountVue((instance) => {
      editor = instance as DocxEditorInstance;
    });
    try {
      const beforeWidth = editor!.getPageSetup()!.pageWidthTwips;
      editor!.exec({ type: 'setPageSetup', pageWidth: beforeWidth + 144 });
      expect(editor!.getPageSetup()!.pageWidthTwips).toBe(beforeWidth + 144);
      editor!.exec({ type: 'undo' });
      expect(editor!.getPageSetup()!.pageWidthTwips).toBe(beforeWidth);
    } finally {
      app.unmount();
    }
  });

  test('off-ladder zoomIn lands on shared rung', async () => {
    let editor: DocxEditorInstance | null = null;
    const { app } = await mountVue((instance) => {
      editor = instance as DocxEditorInstance;
    });
    try {
      editor!.setZoom(OFF_LADDER_ZOOM);
      editor!.setZoom(offLadderZoomIn() ?? OFF_LADDER_ZOOM);
      expect(editor!.snapshot().zoom).toBe(offLadderZoomIn()!);
    } finally {
      app.unmount();
    }
  });
});
