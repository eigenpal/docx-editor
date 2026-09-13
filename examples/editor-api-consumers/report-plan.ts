/** Shared report actions. Both hosts execute exactly this public API workflow. */
import type { RequestContext } from '@docx-editor.dev/editor-api';
const assert = {
  equal(actual: unknown, expected: unknown) {
    if (actual !== expected) throw new Error(`Expected ${expected}; got ${actual}`);
  },
  deepEqual(actual: unknown, expected: unknown) {
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error(`Expected ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`);
  },
};
export const png =
  'iVBORw0KGgoAAAANSUhEUgAAAHgAAAAoCAIAAAC6iKlyAAAAZElEQVR4nO3QAQkAIADAMJOYyYhGtYXCHTzA2Zhr60Lj+cEngQbdCjToVqBBtwINuhVo0K1Ag24FGnQr0KBbgQbdCjToVqBBtwINuhVo0K1Ag24FGnQr0KBbgQbdCjToVqBBtzq0J8eeH02A1wAAAABJRU5ErkJggg==';
const jpeg =
  '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAeKADAAQAAAABAAAAKAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAKAB4AwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQACP/aAAwDAQACEQMRAD8A+J6KKK/sA/n8KKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/Q+J6KKK/sA/n8KKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/R+J6KKK/sA/n8KKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/Z';
type Action =
  | { kind: 'page-furniture' }
  | { kind: 'heading'; text: string }
  | { kind: 'summary'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; values: string[][] }
  | { kind: 'picture'; data: string; caption: string };
export const plan: Action[] = [
  { kind: 'heading', text: 'Q3 delivery report' },
  { kind: 'summary', text: 'Delivery improved. Two decisions require approval.' },
  {
    kind: 'list',
    ordered: false,
    items: ['Completed milestones', 'Accessibility audit complete', 'Temporary note'],
  },
  {
    kind: 'list',
    ordered: true,
    items: ['Approve rollout', 'Publish customer notice', 'Monitor adoption'],
  },
  {
    kind: 'table',
    values: [
      ['Metric', 'Q2'],
      ['Delivery', '81%'],
      ['Retention', '92%'],
    ],
  },
  { kind: 'picture', data: png, caption: 'Delivery trend & confidence <Q3>' },
  { kind: 'page-furniture' },
];
export async function execute(
  context: RequestContext,
  action: Action,
  evidence: unknown[],
  probe = false
) {
  const body = context.document.body;
  if (action.kind === 'heading' || action.kind === 'summary') {
    const p = body.insertParagraph(action.text, 'End');
    await context.sync(); // Resolve the newly inserted paragraph before formatting.
    p.font.name = 'Calibri';
    p.font.size = action.kind === 'heading' ? 22 : 11;
    p.font.bold = action.kind === 'heading';
    p.spaceAfter = 10;
    p.lineSpacing = 15;
    p.alignment = action.kind === 'heading' ? 'Centered' : 'Left';
    p.style = action.kind === 'heading' ? 'Heading 1' : 'Normal';
    await context.sync();
    if (action.kind === 'summary') {
      const matches = body.search('Two decisions', { matchCase: true });
      matches.load('items');
      await context.sync();
      matches.items[0]!.font.bold = true;
      matches.items[0]!.font.italic = true;
      matches.items[0]!.font.highlightColor = 'Yellow';
      await context.sync();
    }
  } else if (action.kind === 'list') {
    const first = body.insertParagraph(action.items[0]!, 'End');
    await context.sync();
    const list = first.startNewList();
    await context.sync();
    list.load('id');
    if (action.ordered) list.setLevelNumbering(0, 'Arabic', [0, '.']);
    else {
      list.setLevelBullet(0, 'Custom', 0x2022, 'Calibri');
      if (!probe) await context.sync();
      list.setLevelBullet(1, 'Custom', 0x25cb, 'Calibri');
      if (!probe) await context.sync();
    }
    list.setLevelIndents(0, 24, -12);
    list.setLevelStartingNumber(0, action.ordered ? 3 : 1);
    await context.sync();
    for (let i = 1; i < action.items.length; i++) {
      const p = list.insertParagraph(action.items[i]!, 'End');
      await context.sync();
      p.attachToList(list.id, !action.ordered && i === 1 ? 1 : 0);
      await context.sync();
      if (!action.ordered && i === 2) {
        p.detachFromList();
        await context.sync();
      }
    }
  } else if (action.kind === 'table') {
    const anchor = body.insertParagraph('Operating metrics', 'End');
    await context.sync();
    anchor.detachFromList();
    await context.sync(); // List detachment and paragraph formatting claim the same paragraph.
    anchor.style = 'Normal';
    anchor.font.bold = true;
    await context.sync();
    const table = anchor.getRange().insertTable(3, 2, 'After', action.values);
    await context.sync();
    table.headerRowCount = 1;
    table.style = 'Report Grid';
    await context.sync();
    const added = table.addRows('End', 1, [['Trial', '0%']]);
    await context.sync();
    added.load('items');
    await context.sync();
    assert.equal(added.items.length, 1);
    table.addColumns('End', 1, [['Q3'], ['95%'], ['94%'], ['1%']]);
    await context.sync();
    table.deleteRows(3, 1);
    await context.sync();
    table.addColumns('Start', 1, [['discard'], ['discard'], ['discard']]);
    await context.sync();
    table.deleteColumns(0, 1);
    await context.sync();
    table.values = [
      ['Metric', 'Q2', 'Q3'],
      ['Delivery', '81%', '95%'],
      ['Retention', '92%', '94%'],
    ];
    await context.sync();
    const cell = table.getCell(0, 0);
    cell.value = 'Measure';
    cell.columnWidth = 144;
    cell.shadingColor = '#DDEEFF';
    cell.verticalAlignment = 'Center';
    await context.sync();
    // Added columns copy template widths. Author the final 504-point body width explicitly.
    for (const [column, width] of [144, 180, 180].entries()) {
      table.getCell(0, column).columnWidth = width;
      await context.sync();
    }
    const cp = cell.body.paragraphs.getFirst();
    cp.alignment = 'Centered';
    cp.font.bold = true;
    await context.sync();
    const rows = table.rows;
    rows.load('items');
    await context.sync();
    const cells = rows.items.map((row) => row.cells);
    for (const collection of cells) collection.load('items');
    await context.sync();
    assert.deepEqual(
      (probe ? rows.items.map((row) => row.cells) : cells).map((c) => c.items.length),
      [3, 3, 3]
    );
  } else if (action.kind === 'page-furniture') {
    const section = context.document.sections.getFirst();
    const setup = section.pageSetup;
    setup.pageWidth = 612;
    setup.pageHeight = 792;
    setup.topMargin = 54;
    setup.bottomMargin = 54;
    setup.leftMargin = 54;
    setup.rightMargin = 54;
    await context.sync();
    const header = section.getHeader('Primary');
    await context.sync();
    const hp = header.insertParagraph('Q3 delivery • Internal report', 'End');
    await context.sync();
    hp.font.name = 'Calibri';
    hp.font.size = 9;
    hp.alignment = 'Right';
    await context.sync();
    const footer = section.getFooter('Primary');
    await context.sync();
    const fp = footer.insertParagraph('Page ', 'End');
    await context.sync();
    const page = fp.getRange('End').insertField('After', 'Page');
    await context.sync();
    fp.insertText(' of ', 'End');
    await context.sync();
    const total = fp.getRange('End').insertField('After', 'NumPages');
    await context.sync();
    try {
      fp.font.name = 'Calibri';
      fp.font.size = 9;
      fp.alignment = 'Centered';
      await context.sync();
    } catch (error) {
      evidence.push({
        kind: 'footer-formatting-after-fields',
        status: 'failed',
        code: (error as { code?: string }).code,
        error: String(error),
      });
    }
    page.updateResult();
    total.updateResult();
    await context.sync();
  } else {
    const p = body.insertParagraph('Figure 1. Delivery confidence', 'End');
    await context.sync();
    p.detachFromList();
    await context.sync();
    p.style = 'Normal';
    p.font.bold = false;
    await context.sync();
    const picture = p.getRange('End').insertInlinePictureFromBase64(action.data, 'After');
    await context.sync();
    picture.width = 72;
    picture.altTextDescription = action.caption;
    await context.sync();
    picture.load('width,height,lockAspectRatio,altTextDescription');
    await context.sync();
    assert.equal(picture.width, 72);
    assert.equal(picture.height, 24);
    assert.equal(picture.lockAspectRatio, true);
    picture.lockAspectRatio = false;
    picture.width = 96;
    picture.height = 36;
    await context.sync();
    const disposable = body.insertParagraph('Discarded draft figure', 'End');
    await context.sync();
    const duplicate = disposable.getRange('End').insertInlinePictureFromBase64(png, 'After');
    await context.sync();
    duplicate.delete();
    await context.sync();
    const draft = disposable.getRange('End').insertInlinePictureFromBase64(jpeg, 'After');
    await context.sync();
    draft.width = 24;
    draft.altTextDescription = 'Temporary JPEG';
    await context.sync();
    draft.delete();
    await context.sync();
    disposable.delete();
    await context.sync();
  }
}
