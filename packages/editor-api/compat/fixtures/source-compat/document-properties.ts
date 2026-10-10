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

export async function removeProperties(): Promise<void> {
  await DocxEditor.run(async (context) => {
    // Runtime tests cover explicit load and sync; this fixture checks the selected shape.
    const lastAuthor: string = context.document.properties.lastAuthor;
    void lastAuthor;
    context.document.removeDocumentInformation(DocxEditor.RemoveDocInfoType.documentProperties);
    await context.sync();
    context.document.removeDocumentInformation('DocumentProperties');
    await context.sync();
  });
}
