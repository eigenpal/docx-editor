import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { DocxEditorRoot, DocxEditorViewport, DocxEditorContent } from '@docx-editor.dev/react';
import { DocxEditorReview } from '../packages/pro/src/react/DocxEditorReview';
import { reviewModule } from '../packages/pro/src/index';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';

export async function mountCommentEditor(bytes: Uint8Array): Promise<Editor> {
  const host = document.createElement('div');
  host.className = 'docx-editor';
  document.body.replaceChildren(host);
  return new Promise((resolve) => {
    createRoot(host).render(
      h(
        DocxEditorRoot,
        {
          document: bytes,
          modules: [reviewModule()],
          author: 'Demo Reviewer',
          onReady: resolve,
        },
        h(
          DocxEditorViewport,
          { style: { height: '100vh', width: '100%' } },
          h(DocxEditorContent),
          h(DocxEditorReview)
        )
      )
    );
  });
}
