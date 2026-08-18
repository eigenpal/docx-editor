/**
 * Shared parsers for API Extractor markdown snapshots under docs/api.
 */

/** Normalize CRLF/CR to LF before any line-based parsing. */
export function normalizeSnapshotText(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function linesOf(snapshotText) {
  return normalizeSnapshotText(snapshotText).split('\n');
}

/**
 * Pull field names out of an interface block in the snapshot.
 */
export function extractInterfaceFields(snapshotText, interfaceName) {
  const lines = linesOf(snapshotText);
  const startMarker = `export interface ${interfaceName} `;
  const startIdx = lines.findIndex(
    (l) =>
      l.startsWith(startMarker) ||
      l.startsWith(`export interface ${interfaceName}{`) ||
      l.startsWith(`interface ${interfaceName} `) ||
      l.startsWith(`interface ${interfaceName}{`)
  );
  if (startIdx === -1) return null;

  const fields = new Set();
  let depth = 0;
  let inBlockComment = false;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false;
      continue;
    }
    if (line.trimStart().startsWith('/*')) {
      if (!line.includes('*/')) inBlockComment = true;
      continue;
    }
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (depth === 0 && i > startIdx) break;
    const match =
      /^ {4}readonly (\w+)\??[(:]/.exec(line) ?? /^ {4}(\w+)\??[(:]/.exec(line);
    if (match) fields.add(match[1]);
  }
  return fields;
}

/** Split on commas not nested inside brackets. */
function splitTopLevelCommas(text) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '<' || c === '(' || c === '{' || c === '[') depth++;
    else if (c === '>' || c === ')' || c === '}' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out.map((part) => part.trim()).filter(Boolean);
}

/** Parse `name: Type` segments from a parameter list, respecting nesting. */
function parseParamList(params) {
  if (!params.trim()) return [];
  return splitTopLevelCommas(params).map((part) => {
    let depth = 0;
    let colon = -1;
    for (let i = 0; i < part.length; i++) {
      const c = part[i];
      if (c === '<' || c === '(' || c === '{' || c === '[') depth++;
      else if (c === '>' || c === ')' || c === '}' || c === ']') depth--;
      else if (c === ':' && depth === 0) {
        colon = i;
        break;
      }
    }
    if (colon < 0) return { name: part.trim(), type: '' };
    return {
      name: part.slice(0, colon).trim(),
      type: part.slice(colon + 1).trim(),
    };
  });
}

/**
 * Extract member name → type string for top-level interface fields.
 */
export function extractInterfaceMemberTypes(snapshotText, interfaceName) {
  const lines = linesOf(snapshotText);
  const startMarker = `export interface ${interfaceName} `;
  const startIdx = lines.findIndex(
    (l) =>
      l.startsWith(startMarker) ||
      l.startsWith(`export interface ${interfaceName}{`) ||
      l.startsWith(`interface ${interfaceName} `) ||
      l.startsWith(`interface ${interfaceName}{`)
  );
  if (startIdx === -1) return null;

  const members = new Map();
  let depth = 0;
  let inBlockComment = false;
  let pendingField = null;

  const flushField = (name, typeParts) => {
    const type = typeParts.join(' ').replace(/;$/, '').trim();
    if (name && type) members.set(name, type);
  };

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false;
      continue;
    }
    if (line.trimStart().startsWith('/*')) {
      if (!line.includes('*/')) inBlockComment = true;
      continue;
    }
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (depth === 0 && i > startIdx) break;

    if (pendingField) {
      pendingField.parts.push(line.trim());
      if (line.trim().endsWith(';')) {
        flushField(pendingField.name, pendingField.parts);
        pendingField = null;
      }
      continue;
    }

    const fieldMatch = /^ {4}readonly (\w+)\??: (.+)$/.exec(line);
    if (fieldMatch) {
      const [, name, rest] = fieldMatch;
      if (rest.trim().endsWith(';')) {
        flushField(name, [rest]);
      } else {
        pendingField = { name, parts: [rest] };
      }
      continue;
    }
    const plainField = /^ {4}(\w+)\??: (.+)$/.exec(line);
    if (plainField && !line.includes('(')) {
      const [, name, rest] = plainField;
      if (rest.trim().endsWith(';')) {
        flushField(name, [rest]);
      } else {
        pendingField = { name, parts: [rest] };
      }
      continue;
    }
    const methodMatch = /^ {4}(\w+)\((.*)$/.exec(line);
    if (methodMatch) {
      const [, name, rest] = methodMatch;
      const combined = `(${rest}`;
      if (combined.includes('):') && combined.trim().endsWith(';')) {
        const close = combined.lastIndexOf('):');
        const params = combined.slice(1, close);
        const ret = combined.slice(close + 2).replace(/;$/, '').trim();
        members.set(name, `(${params}) => ${ret}`);
      } else {
        pendingField = { name, parts: [combined], method: true };
      }
    }
  }
  return members;
}

function unwrapRefWrappers(type) {
  let t = type.trim();
  for (let guard = 0; guard < 16; guard++) {
    const before = t;
    if (t.startsWith('Readonly<') && t.endsWith('>')) {
      t = t.slice('Readonly<'.length, -1).trim();
    }
    for (const wrapper of ['ShallowRef', 'ComputedRef', 'Ref']) {
      const prefix = `${wrapper}<`;
      if (t.startsWith(prefix) && t.endsWith('>')) {
        t = t.slice(prefix.length, -1).trim();
        break;
      }
    }
    if (t === before) break;
  }
  return t;
}

/**
 * Normalize types for cross-adapter parity.
 * Allowed rules only:
 * 1. Vue ref wrappers unwrap to the contained value.
 * 2. MaybeRefOrGetter<T> in parameter position reduces to T.
 */
function unwrapMaybeRefOrGetter(type) {
  let t = type;
  for (let i = 0; i < 8; i++) {
    const next = t.replace(/MaybeRefOrGetter<([^>]+)>(\[\])?/g, (_, inner, suffix = '') =>
      suffix ? `(${inner})${suffix}` : inner
    );
    if (next === t) break;
    t = next;
  }
  return t;
}

function unwrapRefWrappersDeep(type) {
  let t = type;
  for (let i = 0; i < 16; i++) {
    const before = t;
    t = unwrapRefWrappers(t);
    t = t
      .replace(/ShallowRef<([^>]+)>/g, '$1')
      .replace(/ComputedRef<([^>]+)>/g, '$1')
      .replace(/Ref<([^>]+)>/g, '$1');
    if (t === before) break;
  }
  return t;
}

export function normalizeType(type, { parameterPosition = false } = {}) {
  let t = type.trim().replace(/\s+/g, ' ');
  t = t.replace(/\/\*\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  t = unwrapRefWrappersDeep(t);
  if (parameterPosition) t = unwrapMaybeRefOrGetter(t);
  return t;
}

/** Normalize a function parameter list for cross-adapter comparison. */
export function normalizeParamSignature(params) {
  if (!params.trim()) return '';
  return parseParamList(params)
    .map(({ name, type }) => {
      const normalized = normalizeType(type, { parameterPosition: true });
      return type ? `${name}: ${normalized}` : name;
    })
    .join(', ');
}

function parseReturnType(rest) {
  if (!rest.startsWith(':')) return null;
  let body = rest.slice(1).trim();
  if (!body.endsWith(';')) return null;
  body = body.slice(0, -1);
  let angles = 0;
  let braces = 0;
  let parens = 0;
  for (const c of body) {
    if (c === '<') angles++;
    else if (c === '>') angles--;
    else if (c === '{') braces++;
    else if (c === '}') braces--;
    else if (c === '(') parens++;
    else if (c === ')') parens--;
  }
  if (angles !== 0 || braces !== 0 || parens !== 0) return null;
  return body.trim();
}

function parseExportFunctionBlock(block) {
  const nameMatch = /^export function (\w+)/.exec(block);
  if (!nameMatch) return null;
  const name = nameMatch[1];
  const open = block.indexOf('(', nameMatch[0].length - 1);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < block.length; i++) {
    const c = block[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) {
        const params = block.slice(open + 1, i).trim();
        const returnType = parseReturnType(block.slice(i + 1).trim());
        if (!returnType) return null;
        return { name, params, returnType };
      }
    }
  }
  return null;
}

/**
 * Parse `export function useFoo(...)` declarations including overloads.
 * Returns Map<name, Array<{ params, returnType }>>.
 */
export function extractFunctionExports(snapshotText) {
  const exports = new Map();
  const lines = linesOf(snapshotText);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('export function ')) continue;
    let block = line;
    let parsed = parseExportFunctionBlock(block);
    while (!parsed && i + 1 < lines.length) {
      const next = lines[i + 1];
      if (/^export (function|interface|type|declare|const|class|enum)\b/.test(next)) break;
      i++;
      block += ` ${next.trim()}`;
      parsed = parseExportFunctionBlock(block);
    }
    if (!parsed) continue;
    const entry = { params: parsed.params, returnType: parsed.returnType };
    const list = exports.get(parsed.name) ?? [];
    list.push(entry);
    exports.set(parsed.name, list);
  }
  return exports;
}

/**
 * List every exported interface and type alias name in a snapshot.
 */
export function extractInterfaceNames(snapshotText) {
  const names = new Set();
  for (const line of linesOf(snapshotText)) {
    const iface = /^(?:export )?interface (\w+)/.exec(line);
    if (iface) names.add(iface[1]);
    const alias = /^export type (\w+) =/.exec(line);
    if (alias) names.add(alias[1]);
  }
  return names;
}

/**
 * Return interfaces whose names should participate in composable parity.
 * Excludes DocxEditorProps/Ref (owned by check-parity-contract.mjs).
 */
export function composableParityInterfaces(snapshotText) {
  const skip = new Set(['DocxEditorProps', 'DocxEditorRef']);
  return [...extractInterfaceNames(snapshotText)].filter((n) => !skip.has(n)).sort();
}

/**
 * Parse `export type Alias = Body;` from a snapshot.
 * Returns Map<name, body> for single-line aliases only.
 */
export function extractTypeAliasBodies(snapshotText) {
  const aliases = new Map();
  const lines = linesOf(snapshotText);
  for (let i = 0; i < lines.length; i++) {
    const single = /^export type (\w+) = (.+);$/.exec(lines[i].trim());
    if (single) {
      aliases.set(single[1], single[2].trim());
      continue;
    }
    const start = /^export type (\w+) =/.exec(lines[i].trim());
    if (!start) continue;
    let body = lines[i].trim().slice(start[0].length).trim();
    let depth = 0;
    for (const ch of body) {
      if (ch === '<' || ch === '(' || ch === '{' || ch === '[') depth++;
      else if (ch === '>' || ch === ')' || ch === '}' || ch === ']') depth--;
    }
    while (!body.endsWith(';') && i + 1 < lines.length) {
      i++;
      const next = lines[i].trim();
      body += ` ${next}`;
      for (const ch of next) {
        if (ch === '<' || ch === '(' || ch === '{' || ch === '[') depth++;
        else if (ch === '>' || ch === ')' || ch === '}' || ch === ']') depth--;
      }
    }
    aliases.set(start[1], body.replace(/;$/, '').trim());
  }
  return aliases;
}
