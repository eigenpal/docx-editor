import { DocxEditor } from '../../docxeditor/declarations';

export async function compareWithRevision(revisedBase64: string): Promise<void> {
  await DocxEditor.run(async (context) => {
    context.document.compareFromBase64(revisedBase64, {
      authorName: 'Legal',
      compareTarget: DocxEditor.CompareTarget.compareTargetCurrent,
      detectFormatChanges: true,
      removeDateAndTime: false,
    });
    await context.sync();
  });
}

export async function compareWithStringTarget(revisedBase64: string): Promise<void> {
  await DocxEditor.run(async (context) => {
    // Runtime tests cover the refusals; this fixture checks the selected shape.
    context.document.compareFromBase64(revisedBase64, { compareTarget: 'CompareTargetCurrent' });
    await context.sync();
  });
}
