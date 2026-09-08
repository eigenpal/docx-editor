// Office-shaped agent editing. Host setup and collaboration live outside the document model.
import { DocxEditor } from '../../docxeditor/declarations';

export async function redlineFirstMatch(): Promise<void> {
  await DocxEditor.run(async (context) => {
    const matches = context.document.body.search('within 7 days');
    await context.sync();
    context.document.changeTrackingMode = 'TrackMineOnly';
    matches.items[0].insertText('within 30 days', 'Replace');
    await context.sync();
    context.document.changeTrackingMode = 'Off';
    await context.sync();
  });
}
