/**
 * Adapted from a representative Word JavaScript API sample ("insert text at
 * the end of the document" / "insert a paragraph"), namespace-rewritten
 * `Word` -> `DocxEditor` per the task-1 brief. The trailing
 * `await context.sync()` real Office.js samples always end a batch with is
 * omitted — `sync` is proxy-runtime plumbing (see the
 * `OfficeExtension.ClientRequestContext#sync` entry in
 * `compat/manifest.json`), out of scope for this contract-freeze task.
 *
 * This file is not executed; it exists to be *type-checked* against
 * `compat/docxeditor/declarations.ts` (see `compat/tsconfig.json`) as
 * evidence that a real Office.js call pattern remains source-compatible
 * after the rename.
 */
import { DocxEditor } from '../../docxeditor/declarations';

export async function insertTextAtEndOfDocument(): Promise<void> {
  await DocxEditor.run(async (context) => {
    const body = context.document.body;
    body.insertParagraph('Hello, World!', 'End');
  });
}

export async function insertFormattedParagraph(): Promise<void> {
  await DocxEditor.run(async (context) => {
    const body = context.document.body;
    const paragraph = body.insertParagraph('This is a bold paragraph.', 'End');
    paragraph.font.bold = true;
    paragraph.font.size = 14;
    paragraph.alignment = 'Centered';
  });
}
