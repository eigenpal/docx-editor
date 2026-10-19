/**
 * Adapted from representative Word JavaScript API samples ("split a paragraph into words",
 * "expand a range", and "get the reviewed text"), namespace-rewritten `Word` -> `DocxEditor`.
 * See `insert-text.ts` for why the trailing `context.sync()` call is included.
 */
import { DocxEditor } from '../../docxeditor/declarations';

export async function replaceWordRun(first: number, last: number, text: string): Promise<void> {
  await DocxEditor.run(async (context) => {
    const paragraph = context.document.body.paragraphs.getFirst();
    const words = paragraph.getTextRanges([' '], true);
    await context.sync();

    const run = words.items[first]!.expandTo(words.items[last]!);
    run.insertText(text, 'Replace');
    await context.sync();
  });
}

export async function insertAfterWord(index: number, text: string): Promise<void> {
  await DocxEditor.run(async (context) => {
    const range = context.document.body.search('clause').getFirst();
    const words = range.getTextRanges([' ', '.'], false);
    await context.sync();

    words.items[index]!.getRange('End').insertText(text, 'Start');
    await context.sync();
  });
}

export async function readProposedParagraph(): Promise<string> {
  let proposed = '';
  await DocxEditor.run(async (context) => {
    const paragraph = context.document.body.paragraphs.getFirst();
    const current = paragraph.getReviewedText('Current');
    const original = paragraph.getReviewedText('Original');
    const match = context.document.body.search('clause').getFirst().getRange('Whole');
    match.getReviewedText();
    await context.sync();
    proposed = `${original.value} -> ${current.value}`;
  });
  return proposed;
}
