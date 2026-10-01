import { DocxEditor } from '../../docxeditor/declarations';

export async function publishProperties(): Promise<void> {
  await DocxEditor.run(async (context) => {
    const properties = context.document.properties;
    properties.author = 'Public Records Office';
    properties.title = 'Release packet';
    properties.subject = 'Release packet';
    properties.keywords = 'public';
    properties.comments = '';
    properties.category = 'Policy';
    await context.sync();
  });
}
