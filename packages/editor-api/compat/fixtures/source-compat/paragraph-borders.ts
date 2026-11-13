/**
 * NOTE: `load(...)` is deliberately absent, as in the other fixtures here; the
 * runtime needs `borders.load('items')` and a sync before an item is written.
 *
 * Adapted from a representative Word JavaScript API pattern ("put a rule under the
 * first paragraph"), namespace-rewritten `Word` -> `DocxEditor`. See `insert-text.ts`
 * for why the trailing `context.sync()` call is included.
 *
 * The line style is assigned before the width, because a line style write resets
 * the width; see the BorderUniversal runtime notes.
 */
import { DocxEditor } from '../../docxeditor/declarations';

export async function ruleUnderFirstParagraph(): Promise<void> {
  await DocxEditor.run(async (context) => {
    const bottom = context.document.body.paragraphs.getFirst().borders.items[2];
    bottom.lineStyle = 'Single';
    bottom.lineWidth = 'Pt150';
    bottom.color = '#1F4E79';
    await context.sync();
  });
}

export async function hideEveryBorder(): Promise<void> {
  await DocxEditor.run(async (context) => {
    for (const border of context.document.body.paragraphs.getFirst().borders.items) {
      border.isVisible = false;
    }
    await context.sync();
  });
}
