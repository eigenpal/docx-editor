/* eslint-disable react-hooks/rules-of-hooks -- Vue composables in defineComponent setup */
/**
 * Cross-adapter composable differential — Vue harness over the shared table.
 */
import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { createApp, defineComponent, h, nextTick } from 'vue';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { useEditorCommand } from '../src/editor/useEditorCommand';
import { useZoom } from '../src/editor/useZoom';
import {
  SEARCH_MATCH_LIMIT,
  SEARCH_DEBOUNCE_MS,
  useDocumentSearch,
} from '../src/editor/navigation/useDocumentSearch';
import { usePageSetup } from '../src/editor/usePageSetup';
import { stepZoomLevel as vueStepZoomLevel } from '../src/editor/zoom-levels';
import {
  COMPOSABLE_PARITY_CASES,
  DIFFERENTIAL_SOURCE,
  OFF_LADDER_ZOOM,
  SEARCH_HEAVY_SOURCE,
  offLadderZoomIn,
} from '../../react/test/cross-adapter-composable-cases';

const { stepZoomLevel } = await import('../../react/src/editor/zoom-levels.ts');

async function flush(): Promise<void> {
  await nextTick();
  for (let i = 0; i < 10; i++) await new Promise((r) => queueMicrotask(r));
  await new Promise((r) => setTimeout(r, 150));
}

async function mountVue(
  source: Uint8Array,
  probe: ReturnType<typeof defineComponent>
): Promise<{ app: ReturnType<typeof createApp>; editor: () => DocxEditorInstance }> {
  let editor: DocxEditorInstance | null = null;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const app = createApp({
    render: () =>
      h(
        DocxEditorRoot,
        {
          document: source,
          onReady: (instance: Editor) => {
            editor = instance as DocxEditorInstance;
          },
        },
        {
          default: () =>
            h(DocxEditorViewport, null, {
              default: () => [h(DocxEditorContent), h(probe)],
            }),
        }
      ),
  });
  app.mount(container);
  await flush();
  return { app, editor: () => editor! };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('cross-adapter differential (Vue harness)', () => {
  for (const parityCase of COMPOSABLE_PARITY_CASES) {
    test(parityCase.id, async () => {
      if (parityCase.composable === 'useEditorCommand') {
        let binding: ReturnType<typeof useEditorCommand> | null = null;
        const Probe = defineComponent({
          setup() {
            binding = useEditorCommand(parityCase.slot);
            return () => null;
          },
        });
        const { app, editor } = await mountVue(DIFFERENTIAL_SOURCE, Probe);
        try {
          expect(() =>
            parityCase.assert(
              {
                isEnabled: binding!.isEnabled.value,
                isActive: binding!.isActive.value,
                disabledReason: binding!.disabledReason.value,
              },
              editor()
            )
          ).not.toThrow();
        } finally {
          app.unmount();
        }
        return;
      }

      if (parityCase.composable === 'useZoom') {
        let zoomApi: ReturnType<typeof useZoom> | null = null;
        const Probe = defineComponent({
          setup() {
            zoomApi = useZoom();
            return () => null;
          },
        });
        const { app, editor } = await mountVue(DIFFERENTIAL_SOURCE, Probe);
        try {
          editor().setZoom(OFF_LADDER_ZOOM);
          await flush();
          zoomApi!.zoomIn();
          await flush();
          expect(stepZoomLevel(OFF_LADDER_ZOOM, 'in')).toBe(
            vueStepZoomLevel(OFF_LADDER_ZOOM, 'in')
          );
          expect(() =>
            parityCase.assert({
              scale: zoomApi!.zoom.value,
              canZoomIn: zoomApi!.canZoomIn.value,
              expectedStepIn: offLadderZoomIn(),
            })
          ).not.toThrow();
        } finally {
          app.unmount();
        }
        return;
      }

      if (parityCase.composable === 'useDocumentSearch') {
        let searchApi: ReturnType<typeof useDocumentSearch> | null = null;
        const Probe = defineComponent({
          setup() {
            searchApi = useDocumentSearch();
            return () => null;
          },
        });
        const { app } = await mountVue(SEARCH_HEAVY_SOURCE, Probe);
        try {
          searchApi!.setQuery('a');
          await new Promise((r) => setTimeout(r, SEARCH_DEBOUNCE_MS + 100));
          await flush();
          expect(() =>
            parityCase.assert({
              truncated: searchApi!.truncated.value,
              matchCount: searchApi!.matches.value.length,
              limit: SEARCH_MATCH_LIMIT,
            })
          ).not.toThrow();
        } finally {
          app.unmount();
        }
        return;
      }

      if (parityCase.composable === 'usePageSetup') {
        let pageSetupApi: ReturnType<typeof usePageSetup> | null = null;
        const Probe = defineComponent({
          setup() {
            pageSetupApi = usePageSetup();
            return () => null;
          },
        });
        const { app, editor } = await mountVue(DIFFERENTIAL_SOURCE, Probe);
        try {
          const widthBefore = editor().getPageSetup()!.pageWidthTwips;
          pageSetupApi!.apply({ pageWidthTwips: widthBefore + 144 });
          await flush();
          const widthAfterApply = editor().getPageSetup()!.pageWidthTwips;
          editor().exec({ type: 'undo' });
          await flush();
          const widthAfterUndo = editor().getPageSetup()!.pageWidthTwips;
          expect(() =>
            parityCase.assert({ widthBefore, widthAfterApply, widthAfterUndo })
          ).not.toThrow();
        } finally {
          app.unmount();
        }
      }
    });
  }
});
