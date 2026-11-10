import { createApp, h } from 'vue';
import { DocxEditorRoot, DocxEditorViewport, DocxEditorContent } from '@docx-editor.dev/vue';
import { DocxEditorReview } from '../packages/pro/src/vue/DocxEditorReview';
import { reviewModule } from '../packages/pro/src/index';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';

export async function mountCommentEditor(bytes: Uint8Array): Promise<Editor> {
  const host = document.createElement('div');
  host.className = 'docx-editor';
  document.body.replaceChildren(host);
  return new Promise((resolve) => {
    createApp({
      render: () =>
        h(
          DocxEditorRoot,
          {
            document: bytes,
            modules: [reviewModule()],
            author: 'Demo Reviewer',
            onReady: resolve,
          },
          {
            default: () =>
              h(
                DocxEditorViewport,
                { style: { height: '100vh', width: '100%' } },
                {
                  default: () => [h(DocxEditorContent), h(DocxEditorReview)],
                }
              ),
          }
        ),
    }).mount(host);
  });
}
