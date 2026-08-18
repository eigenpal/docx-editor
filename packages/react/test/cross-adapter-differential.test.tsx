/**
 * Cross-adapter composable differential — React harness over the shared table.
 */
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { useEditorCommand } from '../src/editor/useEditorCommand.ts';
import { SEARCH_MATCH_LIMIT as REACT_SEARCH_LIMIT } from '../src/editor/navigation/useDocumentSearch.ts';
import { stepZoomLevel } from '../src/editor/zoom-levels.ts';
import {
  COMPOSABLE_PARITY_CASES,
  DIFFERENTIAL_SOURCE,
  offLadderZoomIn,
} from './cross-adapter-composable-cases.ts';

const { stepZoomLevel: vueStepZoomLevel } = await import('../../vue/src/editor/zoom-levels.ts');

function mountReact(onReady: (editor: DocxEditorInstance) => void) {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    createElement(
      DocxEditorRoot,
      {
        document: DIFFERENTIAL_SOURCE,
        onReady: (editor) => {
          instance = editor as DocxEditorInstance;
          onReady(instance);
        },
      },
      createElement(DocxEditorViewport, null, createElement(DocxEditorContent))
    )
  );
  return { view, editor: () => instance! };
}

afterEach(cleanup);

describe('cross-adapter differential (React harness)', () => {
  for (const parityCase of COMPOSABLE_PARITY_CASES) {
    test(parityCase.id, async () => {
      if (parityCase.composable === 'useEditorCommand') {
        let binding: ReturnType<typeof useEditorCommand> | null = null;
        const Probe = () => {
          binding = useEditorCommand(parityCase.slot);
          return null;
        };
        const { view, editor } = mountReact(() => {});
        view.rerender(
          createElement(
            DocxEditorRoot,
            { document: DIFFERENTIAL_SOURCE },
            createElement(
              DocxEditorViewport,
              null,
              createElement(DocxEditorContent),
              createElement(Probe)
            )
          )
        );
        await act(async () => {
          await new Promise((r) => setTimeout(r, 200));
        });
        expect(() => parityCase.assert(binding!, editor())).not.toThrow();
        view.unmount();
        return;
      }

      let ready: DocxEditorInstance | null = null;
      const { view } = mountReact((editor) => {
        ready = editor;
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 200));
      });
      if (parityCase.composable === 'useZoom') {
        expect(stepZoomLevel(0.73, 'in')).toBe(vueStepZoomLevel(0.73, 'in'));
        expect(() => parityCase.assert(ready!, offLadderZoomIn())).not.toThrow();
      } else if (parityCase.composable === 'useDocumentSearch') {
        const { SEARCH_MATCH_LIMIT: VUE_SEARCH_LIMIT } =
          await import('../../vue/src/editor/navigation/useDocumentSearch.ts');
        expect(REACT_SEARCH_LIMIT).toBe(VUE_SEARCH_LIMIT);
        expect(() => parityCase.assert(REACT_SEARCH_LIMIT)).not.toThrow();
      } else if (parityCase.composable === 'usePageSetup') {
        expect(() => parityCase.assert(ready!)).not.toThrow();
      }
      view.unmount();
    });
  }
});
