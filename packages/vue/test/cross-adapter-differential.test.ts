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
import { SEARCH_MATCH_LIMIT as VUE_SEARCH_LIMIT } from '../src/editor/navigation/useDocumentSearch';
import { stepZoomLevel as vueStepZoomLevel } from '../src/editor/zoom-levels';
import {
  COMPOSABLE_PARITY_CASES,
  DIFFERENTIAL_SOURCE,
  offLadderZoomIn,
} from '../../react/test/cross-adapter-composable-cases';

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
  for (const parityCase of COMPOSABLE_PARITY_CASES) {
    test(parityCase.id, async () => {
      if (parityCase.composable === 'useEditorCommand') {
        let editor: DocxEditorInstance | null = null;
        const { app } = await mountVue((instance) => {
          editor = instance as DocxEditorInstance;
        });
        try {
          let binding: ReturnType<typeof useEditorCommand> | null = null;
          const Probe = defineComponent({
            setup() {
              binding = useEditorCommand(parityCase.slot);
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
          expect(() =>
            parityCase.assert(
              {
                isEnabled: (binding as unknown as { isEnabled: { value: boolean } }).isEnabled
                  .value,
                isActive: (binding as unknown as { isActive: { value: boolean } }).isActive.value,
                disabledReason: (binding as unknown as { disabledReason: { value: string | null } })
                  .disabledReason.value,
              },
              editor!
            )
          ).not.toThrow();
          probeApp.unmount();
          probeContainer.remove();
        } finally {
          app.unmount();
        }
        return;
      }

      let editor: DocxEditorInstance | null = null;
      const { app } = await mountVue((instance) => {
        editor = instance as DocxEditorInstance;
      });
      try {
        if (parityCase.composable === 'useZoom') {
          expect(stepZoomLevel(0.73, 'in')).toBe(vueStepZoomLevel(0.73, 'in'));
          expect(() => parityCase.assert(editor!, offLadderZoomIn())).not.toThrow();
        } else if (parityCase.composable === 'useDocumentSearch') {
          expect(REACT_SEARCH_LIMIT).toBe(VUE_SEARCH_LIMIT);
          expect(() => parityCase.assert(VUE_SEARCH_LIMIT)).not.toThrow();
        } else if (parityCase.composable === 'usePageSetup') {
          expect(() => parityCase.assert(editor!)).not.toThrow();
        }
      } finally {
        app.unmount();
      }
    });
  }
});
