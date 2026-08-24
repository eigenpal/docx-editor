// Canonicalizes API Extractor markdown snapshots so the committed files are
// machine-independent.
//
// Why: the Vue dts rollup emits the members of inferred object types (the
// `ExtractPropTypes<{ ... }>` blocks inside `DefineComponent`) in an order
// that is stable per machine but differs between machines. API Extractor
// preserves that order in the report, so `api:check` fails on some machines
// with a pure-reordering diff. Declared interface members are already
// alphabetized by API Extractor itself; anonymous object TYPE literals are
// not.
//
// What we sort: only object type literals whose every top-level member is a
// plain property signature (`name: Type;`, optionally `readonly`/`?`, quoted
// names allowed). Property order in an object type is semantically
// meaningless in TypeScript, so alphabetizing is safe. Anything else —
// call/construct signatures (overload order matters), index signatures,
// method signatures, blocks containing report comments (declaration bodies) —
// is left exactly as emitted.

const PROPERTY_NAME =
  /^(?:readonly\s+)?([A-Za-z_$][\w$]*|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\??:(?!:)\s/;

/** Skip a quoted string starting at `i`; returns the index just past it. */
function skipString(text, i) {
  const quote = text[i];
  for (let j = i + 1; j < text.length; j++) {
    const c = text[j];
    if (c === '\\') {
      j++;
    } else if (c === quote) {
      return j + 1;
    }
  }
  return text.length;
}

/** Skip a `//` line comment starting at `i`; returns the index of the newline. */
function skipLineComment(text, i) {
  const nl = text.indexOf('\n', i);
  return nl === -1 ? text.length : nl;
}

/** Index of the `}` matching the `{` at `open`, or -1. */
function matchingBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "'" || c === '"' || c === '`') {
      i = skipString(text, i) - 1;
    } else if (c === '/' && text[i + 1] === '/') {
      i = skipLineComment(text, i) - 1;
    } else if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Split `body` on `;` at brace/paren/bracket depth zero. The final element is
 * the trailing text after the last `;` (whitespace before the closing brace).
 */
function splitTopLevelMembers(body) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "'" || c === '"' || c === '`') {
      i = skipString(body, i) - 1;
    } else if (c === '/' && body[i + 1] === '/') {
      i = skipLineComment(body, i) - 1;
    } else if (c === '{' || c === '(' || c === '[') {
      depth++;
    } else if (c === '}' || c === ')' || c === ']') {
      depth--;
    } else if (c === ';' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

function memberName(member) {
  const match = PROPERTY_NAME.exec(member.trim());
  return match ? match[1] : null;
}

/**
 * Sort the members of one object type body alphabetically, if every member is
 * a plain property signature. Returns the body unchanged otherwise.
 */
function sortMembersIfEligible(body) {
  const parts = splitTopLevelMembers(body);
  if (parts.length < 3) return body; // fewer than two members: nothing to sort
  const tail = parts[parts.length - 1];
  if (tail.trim() !== '') return body; // last member missing its `;`: not a member list
  const members = parts.slice(0, -1);
  const named = members.map((member) => ({ member, name: memberName(member) }));
  if (named.some((entry) => entry.name === null)) return body;
  named.sort((a, b) => {
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return a.member < b.member ? -1 : a.member > b.member ? 1 : 0;
  });
  return [...named.map((entry) => entry.member), tail].join(';');
}

/** Recursively canonicalize every `{ ... }` block in a stretch of type text. */
function canonicalizeTypeText(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "'" || c === '"' || c === '`') {
      const end = skipString(text, i);
      out += text.slice(i, end);
      i = end;
    } else if (c === '/' && text[i + 1] === '/') {
      const end = skipLineComment(text, i);
      out += text.slice(i, end);
      i = end;
    } else if (c === '{') {
      const close = matchingBrace(text, i);
      if (close === -1) {
        out += text.slice(i);
        break;
      }
      const inner = canonicalizeTypeText(text.slice(i + 1, close));
      out += `{${sortMembersIfEligible(inner)}}`;
      i = close + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/**
 * Canonicalize an API Extractor `.api.md` report so its content does not
 * depend on the machine that emitted the dts rollup. Only the fenced ```ts
 * block is touched; the markdown around it passes through verbatim.
 */
export function canonicalizeApiReport(reportText) {
  const lines = reportText.split('\n');
  const out = [];
  let fence = [];
  let inFence = false;
  for (const line of lines) {
    if (!inFence && line.trim() === '```ts') {
      inFence = true;
      out.push(line);
    } else if (inFence && line.trim() === '```') {
      inFence = false;
      out.push(canonicalizeTypeText(fence.join('\n')));
      fence = [];
      out.push(line);
    } else if (inFence) {
      fence.push(line);
    } else {
      out.push(line);
    }
  }
  if (fence.length > 0) out.push(...fence); // unterminated fence: pass through
  return out.join('\n');
}
