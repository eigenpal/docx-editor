/**
 * Shared parsers for API Extractor markdown snapshots under docs/api.
 */

/**
 * Pull field names out of an interface block in the snapshot.
 */
export function extractInterfaceFields(snapshotText, interfaceName) {
  const lines = snapshotText.split('\n');
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

/**
 * Extract member name → type string for top-level interface fields.
 */
export function extractInterfaceMemberTypes(snapshotText, interfaceName) {
  const lines = snapshotText.split('\n');
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

    const fieldMatch = /^ {4}readonly (\w+)\??: (.+);$/.exec(line);
    if (fieldMatch) {
      members.set(fieldMatch[1], fieldMatch[2].trim());
      continue;
    }
    const methodMatch = /^ {4}(\w+)\(([^)]*)\): (.+);$/.exec(line);
    if (methodMatch) {
      members.set(methodMatch[1], `(${methodMatch[2]}) => ${methodMatch[3].trim()}`);
    }
  }
  return members;
}

/** Normalize Vue ref wrappers and MaybeRefOrGetter for parity comparison. */
export function normalizeType(type, { parameterPosition = false } = {}) {
  let t = type.trim();
  if (parameterPosition) {
    const maybe = /^MaybeRefOrGetter<(.+)>$/.exec(t);
    if (maybe) t = maybe[1].trim();
  }
  for (;;) {
    const m =
      /^(?:Readonly<)?(?:Ref|ShallowRef|ComputedRef)<(.+)>$/.exec(t) ??
      /^Readonly<(.+)>$/.exec(t);
    if (!m) break;
    t = m[1].trim();
  }
  return t;
}

/** Split a parameter list on commas not nested inside brackets. */
function splitTopLevelParams(params) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < params.length; i++) {
    const c = params[i];
    if (c === '<' || c === '(' || c === '{') depth++;
    else if (c === '>' || c === ')' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      out.push(params.slice(start, i));
      start = i + 1;
    }
  }
  out.push(params.slice(start));
  return out.map((part) => part.trim()).filter(Boolean);
}

/** Normalize a function parameter list for cross-adapter comparison. */
export function normalizeParamSignature(params) {
  if (!params.trim()) return '';
  return splitTopLevelParams(params)
    .map((part) => {
      const idx = part.indexOf(':');
      if (idx < 0) return part;
      const name = part.slice(0, idx).trim();
      let type = part.slice(idx + 1).trim();
      type = normalizeType(type, { parameterPosition: true });
      const getter = /^\(\)\s*=>\s*(.+)$/.exec(type);
      if (getter) type = getter[1].trim();
      return `${name}: ${type}`;
    })
    .join(', ');
}

/**
 * Parse `export function useFoo(...)` declarations including overloads.
 * Returns Map<name, Array<{ params, returnType }>>.
 */
export function extractFunctionExports(snapshotText) {
  const exports = new Map();
  const re = /^export function (\w+)\(([^)]*)\): (.+);$/;
  for (const line of snapshotText.split('\n')) {
    const match = re.exec(line);
    if (!match) continue;
    const [, name, params, returnType] = match;
    const entry = { params: params.trim(), returnType: returnType.trim() };
    const list = exports.get(name) ?? [];
    list.push(entry);
    exports.set(name, list);
  }
  return exports;
}

/**
 * List every exported interface and type alias name in a snapshot.
 */
export function extractInterfaceNames(snapshotText) {
  const names = new Set();
  for (const line of snapshotText.split('\n')) {
    const iface = /^(?:export )?interface (\w+)/.exec(line);
    if (iface) names.add(iface[1]);
    const alias = /^export type (\w+) =/.exec(line);
    if (alias) names.add(alias[1]);
  }
  return names;
}

/**
 * Return interfaces whose names should participate in composable parity.
 * Excludes DocxEditorProps/Ref and internal-looking names.
 */
export function composableParityInterfaces(snapshotText) {
  const skip = new Set(['DocxEditorProps', 'DocxEditorRef']);
  return [...extractInterfaceNames(snapshotText)].filter((n) => !skip.has(n)).sort();
}
