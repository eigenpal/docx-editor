/**
 * Adapted from a representative Word JavaScript API sample ("search the
 * document body and highlight matches"), namespace-rewritten `Word` ->
 * `DocxEditor`. See `insert-text.ts` for why the trailing `context.sync()`
 * call is included.
 */
import { DocxEditor } from '../../docxeditor/declarations';

export async function highlightAllMatches(searchText: string): Promise<void> {
  await DocxEditor.run(async (context) => {
    const body = context.document.body;
    // NOTE: real Office.js also accepts a partial plain object here (an
    // inline anonymous type unioned with `Word.SearchOptions`); that
    // overload is a deliberate, documented omission in
    // `extract-word-reference.mjs` (deep structural comparison of
    // anonymous object types is out of scope for this task), so only the
    // fully-specified `SearchOptions` shape is source-compatible here.
    const searchOptions = new DocxEditor.SearchOptions();
    searchOptions.matchCase = false;
    searchOptions.matchWholeWord = true;
    const searchResults = body.search(searchText, searchOptions);
    await context.sync();

    for (const range of searchResults.items) {
      range.font.highlightColor = 'yellow';
      range.font.bold = true;
    }
    await context.sync();
  });
}

export async function replaceFirstMatch(searchText: string, replacement: string): Promise<void> {
  await DocxEditor.run(async (context) => {
    const results = context.document.body.search(searchText);
    await context.sync();
    const first = results.getFirst();
    first.insertText(replacement, 'Replace');
    await context.sync();
  });
}
