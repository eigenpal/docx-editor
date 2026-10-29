/**
 * Listing the styles a document defines, then applying a listed paragraph style.
 *
 * NOTE: `load(...)` is deliberately absent, as in the other fixtures. Runtime tests cover explicit
 * load and sync; this fixture checks the selected shape.
 */
import { DocxEditor } from '../../docxeditor/declarations';

export async function applyListedParagraphStyle(): Promise<void> {
  await DocxEditor.run(async (context) => {
    const styles = context.document.getStyles();
    const count = styles.getCount();
    await context.sync();

    const paragraphStyles: string[] = styles.items
      .filter((style) => style.type === 'Paragraph' && !style.linked)
      .map((style) => style.nameLocal);
    const total: number = count.value;
    void total;

    const quote = styles.getByNameOrNullObject('Quote');
    await context.sync();

    const custom: boolean = !quote.isNullObject && !quote.builtIn;
    void custom;
    const name = paragraphStyles[0];
    if (name !== undefined) context.document.paragraphs.getFirst().style = name;
    await context.sync();
  });
}
