import { DocxEditor } from '@docx-editor.dev/editor-api/browser';

/** Probe requested styles on disposable bytes through the public document API. */
export async function preflightDraftStyles(bytes: Uint8Array, styles: readonly string[]) {
  if (!styles.length) return;
  const probe = await DocxEditor.createServer(bytes);
  try {
    await probe.run(async (context) => {
      const paragraph = context.document.body.insertParagraph('', 'End');
      await context.sync();
      for (const style of new Set(styles)) {
        paragraph.style = style;
        await context.sync();
      }
    });
  } finally {
    probe.dispose();
  }
}
