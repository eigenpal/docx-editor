/**
 * Adapted from representative Word JavaScript API samples ("read/write a
 * content control's text", "apply a style to paragraphs"), namespace-rewritten
 * `Word` -> `DocxEditor`. See `insert-text.ts` for why the trailing
 * `context.sync()` call is included.
 *
 * The comment half of the original pair is gone with the comment object model:
 * the canonical comment reader lives in a lane this API's host may not import,
 * so `Comment`/`CommentCollection` are recorded omissions rather than declared
 * members. Applying a paragraph style is selected, and takes its place.
 */
import { DocxEditor } from '../../docxeditor/declarations';

export async function fillFirstPlainTextContentControl(newText: string): Promise<void> {
  await DocxEditor.run(async (context) => {
    const contentControls = context.document.contentControls;
    await context.sync();
    const first = contentControls.items[0];
    if (!first.cannotEdit) {
      first.insertText(newText, 'Replace');
    }
    await context.sync();
  });
}

export async function styleQuotedParagraphs(quoteStyleName: string): Promise<void> {
  await DocxEditor.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    await context.sync();
    for (const paragraph of paragraphs.items) {
      if (paragraph.text.startsWith('"')) {
        paragraph.style = quoteStyleName;
        paragraph.leftIndent = 36;
        paragraph.font.italic = true;
      }
    }
    await context.sync();
  });
}
