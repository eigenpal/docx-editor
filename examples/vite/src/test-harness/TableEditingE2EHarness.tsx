// Paginated React editor harness for table-editing Playwright acceptance (Task 12).
//
// Activated with `?e2e=1&fixture=table-editing-nested.docx`. Publishes
// `window.__DOCX_EDITOR_E2E__` over real Editor APIs — no test-only mutation paths.

import { useEffect, useRef } from 'react';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import { DocxEditor, useDocxEditor, useDocxSource } from '@docx-editor.dev/react';
import { defaultFonts } from '@docx-editor.dev/fonts';
import { createDocxEditorE2EHook } from './table-editing-e2e-hook.ts';

function E2EBridge() {
  const editor = useDocxEditor();
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  useEffect(() => {
    window.__DOCX_EDITOR_E2E__ = createDocxEditorE2EHook(() => editorRef.current);
    return () => {
      delete window.__DOCX_EDITOR_E2E__;
    };
  }, []);

  return null;
}

export function TableEditingE2EHarness({ fixtureUrl }: { fixtureUrl: string }) {
  const {
    document: bytes,
    fonts,
    error: loadError,
  } = useDocxSource(fixtureUrl, {
    fonts: defaultFonts,
  });

  return (
    <div className="ep-root demo-app" data-testid="table-editing-e2e-mount">
      {bytes ? (
        <DocxEditor.Root document={bytes} {...(fonts ? { fonts } : {})}>
          <E2EBridge />
          <header className="demo-header" data-testid="table-editing-e2e-header">
            <strong>Table editing E2E harness</strong>
          </header>
          <DocxEditor.Toolbar />
          <DocxEditor.Viewport className="demo-viewport">
            <DocxEditor.Content />
            <DocxEditor.ContextMenu />
          </DocxEditor.Viewport>
        </DocxEditor.Root>
      ) : loadError ? (
        <div role="alert">{`Could not load fixture: ${loadError.message}`}</div>
      ) : (
        <DocxEditor.Loading>
          <DocxEditor.Loading.Spinner />
          <span>Loading fixture…</span>
        </DocxEditor.Loading>
      )}
    </div>
  );
}
