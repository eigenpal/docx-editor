/**
 * Parse JSON with comments and trailing commas, as `.oxlintrc.json` and tsconfig allow.
 *
 * Both passes skip over strings. A glob string such as "**" followed by "/*.ts" contains a
 * block-comment opener, and a message string can contain ", ]", so neither pass can be a
 * plain pattern match.
 */
export function parseJsonc(text) {
  return JSON.parse(withoutTrailingCommas(withoutComments(text)));
}

/** The end index (inclusive) of the string that starts at `start`. */
function stringEnd(text, start) {
  let j = start + 1;
  while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
  return j;
}

function withoutComments(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      const end = stringEnd(text, i);
      out += text.slice(i, end + 1);
      i = end;
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) throw new Error('Unterminated block comment');
      i = end + 1;
    } else {
      out += ch;
    }
  }
  return out;
}

function withoutTrailingCommas(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      const end = stringEnd(text, i);
      out += text.slice(i, end + 1);
      i = end;
    } else if (ch === ',' && /^\s*[}\]]/.test(text.slice(i + 1))) {
      // A trailing comma: drop it.
    } else {
      out += ch;
    }
  }
  return out;
}
