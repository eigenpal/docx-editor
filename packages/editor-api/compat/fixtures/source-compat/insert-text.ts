/**
 * Adapted from a representative Word JavaScript API sample ("insert text at
 * the end of the document" / "insert a paragraph"), namespace-rewritten
 * `Word` -> `DocxEditor` per the task-1 brief. This is a straight
 * namespace-only rewrite — including the trailing `await context.sync()`
 * every real Office.js sample ends a batch with; see
 * `compat/docxeditor/declarations.ts`'s `ClientRequestContext` doc comment
 * for why `sync()` is safe to call here despite being outside this task's
 * frozen conformance subset (declaration-only, no runtime behavior).
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
    await context.sync();
  });
}

export async function insertFormattedParagraph(): Promise<void> {
  await DocxEditor.run(async (context) => {
    const body = context.document.body;
    const paragraph = body.insertParagraph('This is a bold paragraph.', 'End');
    paragraph.font.bold = true;
    paragraph.font.size = 14;
    paragraph.alignment = 'Centered';
    await context.sync();
  });
}
