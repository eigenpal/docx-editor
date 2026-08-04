/**
 * Extracts normalized shape facts for a manifest-selected subset of
 * DocxEditor's *own*, independently authored public declarations
 * (`compat/docxeditor/declarations.ts`) — the authored side of the
 * conformance comparison.
 *
 * This is deliberately the mirror image of `extract-word-reference.mjs`,
 * but simpler: DocxEditor's declarations live in exactly one
 * `declare namespace DocxEditor { ... }` block (no Word/OfficeExtension
 * split to reconstruct), and a manifest entry's `namespace` field — which
 * only records *where the symbol lived in Microsoft's source* — is
 * irrelevant here and ignored.
 */

import ts from 'typescript';

const NAMESPACE_NAME = 'DocxEditor';
const SELF_NAMESPACE_PREFIX = /\bDocxEditor\./g;
const SELF_NAMESPACED_TYPE_OR_ENUM_MEMBER = /^DocxEditor\.[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/;
const STRING_LITERAL = /^["'](?:[^"'\\]|\\.)*["']$/;
const SINGLE_QUOTED_LITERAL = /^'((?:[^'\\]|\\.)*)'$/;
const OBJECT_LITERAL_TYPE = /^\{[\s\S]*\}$/;

/** See the identical helper in `extract-word-reference.mjs` — drops the
 *  spurious empty leading alternative a leading-pipe multi-line union
 *  produces. */
function splitUnion(text) {
  return text
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** See the identical helper in `extract-word-reference.mjs` — quote style is not part of a string-literal type's identity. */
function canonicalizeStringLiteralQuotes(part) {
  const match = SINGLE_QUOTED_LITERAL.exec(part);
  return match ? `"${match[1]}"` : part;
}

/**
 * Normalizes a DocxEditor-authored parameter/return type string. DocxEditor
 * declarations are authored directly against the reference fixture's
 * already-normalized shapes (e.g. `"Portrait" | "Landscape"` rather than an
 * enum type), so no enum-collapsing is expected in practice — this mirrors
 * `extract-word-reference.mjs`'s `normalizeTypeText` anyway so a stray
 * self-qualified reference (`DocxEditor.Body`) or inline object-literal
 * alternative still normalizes consistently instead of causing a spurious
 * mismatch against the reference fixture.
 */
export function normalizeTypeText(text) {
  const parts = splitUnion(text).filter((part) => !OBJECT_LITERAL_TYPE.test(part));
  const hasStringLiteral = parts.some((part) => STRING_LITERAL.test(part));
  const kept = hasStringLiteral
    ? parts.filter((part) => !SELF_NAMESPACED_TYPE_OR_ENUM_MEMBER.test(part))
    : parts;
  const survivors = kept.length > 0 ? kept : parts;
  return survivors
    .map((part) => canonicalizeStringLiteralQuotes(part.replace(SELF_NAMESPACE_PREFIX, '')))
    .join(' | ');
}

function extractParams(sourceFile, params) {
  return params.map((param) => ({
    name: param.name.getText(sourceFile),
    type: normalizeTypeText(param.type ? param.type.getText(sourceFile) : 'any'),
    ...(param.questionToken ? { optional: true } : {}),
  }));
}

function extractReturns(sourceFile, node) {
  return normalizeTypeText(node.type ? node.type.getText(sourceFile) : 'void');
}

function isReadonlyMember(member) {
  if (!ts.canHaveModifiers(member)) return false;
  const modifiers = ts.getModifiers(member) ?? [];
  return modifiers.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword);
}

function isPropertyLike(node) {
  return ts.isPropertyDeclaration(node) || ts.isPropertySignature(node);
}

function isMethodLike(node) {
  return ts.isMethodDeclaration(node) || ts.isMethodSignature(node);
}

function extractClassOrInterface(sourceFile, name, stmt, selection) {
  const wantedMembers = new Set(selection.members ?? []);
  const byName = new Map();

  for (const member of stmt.members) {
    if (!member.name || !ts.isIdentifier(member.name)) continue;
    const memberName = member.name.text;
    if (!wantedMembers.has(memberName)) continue;
    if (!isPropertyLike(member) && !isMethodLike(member)) continue;

    const method = isMethodLike(member);
    const overload = method
      ? { params: extractParams(sourceFile, member.parameters), returns: extractReturns(sourceFile, member) }
      : { params: [], returns: extractReturns(sourceFile, member) };

    if (!byName.has(memberName)) {
      byName.set(memberName, {
        uid: `${NAMESPACE_NAME}.${name}#${memberName}`,
        kind: method ? 'method' : 'property',
        ...(!method && isReadonlyMember(member) ? { readonly: true } : {}),
        overloads: [],
      });
    }
    byName.get(memberName).overloads.push(overload);
  }

  const members = {};
  for (const memberName of wantedMembers) {
    if (byName.has(memberName)) members[memberName] = byName.get(memberName);
  }

  return {
    uid: `${NAMESPACE_NAME}.${name}`,
    kind: ts.isClassDeclaration(stmt) ? 'class' : 'interface',
    members,
  };
}

function extractFunction(sourceFile, name, stmt) {
  return {
    uid: `${NAMESPACE_NAME}.${name}`,
    kind: 'function',
    overloads: [
      { params: extractParams(sourceFile, stmt.parameters), returns: extractReturns(sourceFile, stmt) },
    ],
  };
}

function isDocxEditorNamespace(stmt) {
  return (
    ts.isModuleDeclaration(stmt) &&
    ts.isIdentifier(stmt.name) &&
    stmt.name.text === NAMESPACE_NAME &&
    stmt.body != null &&
    ts.isModuleBlock(stmt.body)
  );
}

/**
 * @param {string} sourceText DocxEditor's own declaration source — one or
 *   more `declare namespace DocxEditor { ... }` blocks (declaration
 *   merging across blocks is honored, same as the upstream extractor).
 * @param {Record<string, { members?: string[]; isFunction?: boolean }>} manifestSymbols
 *   The same per-symbol selection map used against the upstream reference.
 *   Any `namespace` field on an entry (recording where the symbol lived in
 *   *Microsoft's* source) is ignored here.
 * @returns Raw authored symbol facts, in exactly the shape
 *   `buildReferenceFixture`/`compareFixtures` expect.
 */
export function extractDocxEditorShape(sourceText, manifestSymbols) {
  const sourceFile = ts.createSourceFile(
    'docxeditor-declarations.ts',
    sourceText,
    ts.ScriptTarget.Latest,
    true
  );
  const result = {};

  for (const stmt of sourceFile.statements) {
    if (!isDocxEditorNamespace(stmt)) continue;

    for (const inner of stmt.body.statements) {
      if (ts.isFunctionDeclaration(inner)) {
        const name = inner.name?.text;
        const selection = name ? manifestSymbols[name] : undefined;
        if (!name || !selection?.isFunction) continue;
        const extracted = extractFunction(sourceFile, name, inner);
        if (result[name]) {
          result[name].overloads.push(...extracted.overloads);
        } else {
          result[name] = extracted;
        }
        continue;
      }

      if (ts.isClassDeclaration(inner) || ts.isInterfaceDeclaration(inner)) {
        const name = inner.name?.text;
        if (!name) continue;
        const selection = manifestSymbols[name];
        if (!selection || selection.isFunction) continue;

        const extracted = extractClassOrInterface(sourceFile, name, inner, selection);
        if (result[name]) {
          Object.assign(result[name].members, extracted.members);
        } else {
          result[name] = extracted;
        }
      }
    }
  }

  return result;
}
