// The Ecma copyright notice as a legal comment (`/*!`), for files that hold data derived from
// ECMA-376. Bundlers and minifiers keep legal comments, so the notice stays with every copy of
// the data, also inside an app bundle that inlines it.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** `text` wrapped at `width` columns, each line prefixed for a block comment. */
function commentLines(text, width = 96) {
  const out = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && line.length + word.length + 1 > width) {
        out.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    out.push(line);
  }
  return out.map((line) => (line ? ` * ${line}` : ' *')).join('\n');
}

/** A `/*!` comment: `preamble`, then the full Ecma notice from `reference/ecma-376/NOTICE`. */
export function ecmaLegalComment(preamble) {
  const notice = readFileSync(resolve(root, 'reference/ecma-376/NOTICE'), 'utf8');
  const start = notice.indexOf('COPYRIGHT NOTICE');
  if (start < 0) throw new Error('reference/ecma-376/NOTICE has no COPYRIGHT NOTICE heading.');
  const text = notice.slice(start).trim();
  if (text.includes('*/')) throw new Error('The notice cannot hold a comment terminator.');
  return `/*!\n${commentLines(preamble)}\n *\n${commentLines(text)}\n */\n`;
}
