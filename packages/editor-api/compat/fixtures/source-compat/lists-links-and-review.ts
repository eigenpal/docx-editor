/**
 * NOTE: `load(...)` is deliberately absent, the same way it is absent from the
 * other fixtures here: the declarations declare the batch boundary and nothing
 * else of the proxy runtime (see their file header), so a fixture says what it
 * wants and syncs. The runtime's own examples in `src/runtime/examples/` are
 * where `load` is exercised.
 *
 * Adapted from representative Word JavaScript API samples for the objects a
 * document has beyond its text — a numbered list, a hyperlink, a bookmark, a
 * section's page setup, a footnote, a comment thread and a tracked change —
 * namespace-rewritten `Word` -> `DocxEditor`. See `insert-text.ts` for why the
 * trailing `context.sync()` call is included.
 *
 * The samples' de-selected members are not used: a comment is read and
 * resolved rather than rewritten or deleted (`Comment#content`/`#delete` are
 * recorded omissions), a bookmark is read by name and range rather than by
 * document-wide offset, and a list item's level is read rather than its
 * rendered marker string.
 */
import { DocxEditor } from '../../docxeditor/declarations';

export async function extendTheFirstList(text: string): Promise<void> {
  await DocxEditor.run(async (context) => {
    const lists = context.document.body.lists;
    await context.sync();

    const list = lists.getFirst();
    list.insertParagraph(text, 'End');
    await context.sync();
  });
}

export async function levelsOfTheFirstList(): Promise<number[]> {
  return DocxEditor.run(async (context) => {
    const lists = context.document.body.lists;
    await context.sync();

    const paragraphs = lists.items[0]!.getLevelParagraphs(0);
    await context.sync();

    const levels = paragraphs.items.map((paragraph) => paragraph.listItem);
    await context.sync();

    return levels.map((item) => item.level);
  });
}

export async function linkEveryMatch(searchText: string, url: string): Promise<void> {
  await DocxEditor.run(async (context) => {
    const results = context.document.body.search(searchText);
    await context.sync();

    for (const range of results.items) range.hyperlink = url;
    await context.sync();
  });
}

export async function bookmarkNamesIn(searchText: string): Promise<string[]> {
  return DocxEditor.run(async (context) => {
    const results = context.document.body.search(searchText);
    await context.sync();

    const bookmarks = results.getFirst().bookmarks;
    await context.sync();

    return bookmarks.items.map((bookmark) => bookmark.name);
  });
}

export async function widenTheFirstSectionsMargins(points: number): Promise<void> {
  await DocxEditor.run(async (context) => {
    const sections = context.document.sections;
    await context.sync();

    const setup = sections.getFirst().pageSetup;
    setup.leftMargin = points;
    setup.rightMargin = points;
    await context.sync();
  });
}

export async function firstHeaderText(): Promise<string> {
  return DocxEditor.run(async (context) => {
    const sections = context.document.sections;
    await context.sync();

    const header = sections.items[0]!.getHeader('Primary');
    await context.sync();
    return header.text;
  });
}

export async function settleEveryComment(reply: string): Promise<string[]> {
  return DocxEditor.run(async (context) => {
    const comments = context.document.body.getComments();
    await context.sync();

    const authors = comments.items;
    for (const comment of comments.items) {
      comment.reply(reply);
      await context.sync();
      comment.resolved = true;
      await context.sync();
    }
    return authors.map((comment) => comment.authorName);
  });
}

export async function acceptEveryChange(): Promise<void> {
  await DocxEditor.run(async (context) => {
    const revisions = context.document.revisions;
    await context.sync();

    revisions.acceptAll();
    await context.sync();
  });
}
