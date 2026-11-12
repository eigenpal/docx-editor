import { DocxEditor } from '../../docxeditor/declarations';

// Runtime tests cover the refused locations; this fixture checks the selected shape.
export async function replaceDocumentFromFile(docxBase64: string): Promise<void> {
  await DocxEditor.run(async (context) => {
    context.document.body.insertFileFromBase64(docxBase64, 'Replace');
    await context.sync();
  });
}
