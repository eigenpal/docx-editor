// Browser editing-performance harness.
//
// Activated with `?perfE2e=1&fixture=synthetic-long-edit.docx`. It mounts the real React
// adapter, review module, toolbar, paginated surface, and review rail while exposing the
// existing E2E bridge. The benchmark drives real trusted browser input through this UI.

import { useEffect, useRef } from 'react';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import { defaultFonts } from '@docx-editor.dev/fonts';
import { reviewModule } from '@docx-editor.dev/pro';
import { DocxEditorReview } from '@docx-editor.dev/pro/react';
import { DocxEditor, useDocxEditor, useDocxSource } from '@docx-editor.dev/react';
import { createDocxEditorE2EHook } from './table-editing-e2e-hook.ts';

const PERFORMANCE_MODULES = [reviewModule()];

function PerformanceBridge() {
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

export function PerformanceE2EHarness({ fixtureUrl }: { fixtureUrl: string }) {
  const reviewRailEnabled =
    typeof window === 'undefined' ||
    new URLSearchParams(window.location.search).get('reviewRail') !== '0';
  const {
    document: bytes,
    fonts,
    error: loadError,
  } = useDocxSource(fixtureUrl, {
    fonts: defaultFonts,
  });

  return (
    <div className="docx-editor demo-app" data-testid="performance-e2e-mount">
      {bytes ? (
        <DocxEditor.Root
          document={bytes}
          author="Synthetic Benchmark"
          modules={PERFORMANCE_MODULES}
          {...(fonts ? { fonts } : {})}
        >
          <PerformanceBridge />
          <DocxEditor.Toolbar />
          <DocxEditor.Viewport className="demo-viewport">
            <DocxEditor.Content />
            {reviewRailEnabled ? <DocxEditorReview /> : null}
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
