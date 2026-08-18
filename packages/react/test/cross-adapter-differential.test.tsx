/**
 * Cross-adapter composable differential — React harness over the shared table.
 */
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { toolbarCommandState } from '@docx-editor.dev/core/editor';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { useEditorCommand } from '../src/editor/useEditorCommand.ts';
import { SEARCH_MATCH_LIMIT as REACT_SEARCH_LIMIT } from '../src/editor/navigation/useDocumentSearch.ts';
import { stepZoomLevel } from '../src/editor/zoom-levels.ts';
import {
  DIFFERENTIAL_SLOTS,
  DIFFERENTIAL_SOURCE,
  OFF_LADDER_ZOOM,
  offLadderZoomIn,
} from './cross-adapter-shared.ts';

const { SEARCH_MATCH_LIMIT: VUE_SEARCH_LIMIT } =
  await import('../../vue/src/editor/navigation/useDocumentSearch.ts');
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
  for (const slot of DIFFERENTIAL_SLOTS) {
    test(`toolbar slot ${slot} matches engine command state`, async () => {
      let binding: ReturnType<typeof useEditorCommand> | null = null;
      const Probe = () => {
        binding = useEditorCommand(slot);
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
      const engine = toolbarCommandState(editor(), slot);
      expect(binding!.isEnabled).toBe(engine.enabled);
      expect(binding!.isActive).toBe(engine.active);
      expect(binding!.disabledReason ?? null).toBe(engine.disabledReason ?? null);
      view.unmount();
    });
  }

  test('off-ladder zoom step matches Vue ladder', () => {
    expect(stepZoomLevel(OFF_LADDER_ZOOM, 'in')).toBe(vueStepZoomLevel(OFF_LADDER_ZOOM, 'in'));
    expect(stepZoomLevel(OFF_LADDER_ZOOM, 'out')).toBe(vueStepZoomLevel(OFF_LADDER_ZOOM, 'out'));
  });

  test('search cap constant matches Vue export', () => {
    expect(REACT_SEARCH_LIMIT).toBe(VUE_SEARCH_LIMIT);
    expect(REACT_SEARCH_LIMIT).toBeGreaterThan(0);
  });

  test('page-setup write is one undo step', async () => {
    let ready: DocxEditorInstance | null = null;
    const { view } = mountReact((editor) => {
      ready = editor;
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    const beforeWidth = ready!.getPageSetup()!.pageWidthTwips;
    ready!.exec({ type: 'setPageSetup', pageWidth: beforeWidth + 144 });
    expect(ready!.getPageSetup()!.pageWidthTwips).toBe(beforeWidth + 144);
    ready!.exec({ type: 'undo' });
    expect(ready!.getPageSetup()!.pageWidthTwips).toBe(beforeWidth);
    view.unmount();
  });

  test('off-ladder zoomIn lands on shared rung', async () => {
    let ready: DocxEditorInstance | null = null;
    const { view } = mountReact((editor) => {
      ready = editor;
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    ready!.setZoom(OFF_LADDER_ZOOM);
    ready!.setZoom(offLadderZoomIn() ?? OFF_LADDER_ZOOM);
    expect(ready!.snapshot().zoom).toBe(offLadderZoomIn()!);
    view.unmount();
  });
});
