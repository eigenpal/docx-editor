/**
 * Extracts normalized conformance facts for a manifest-selected subset of
 * the `Word` namespace out of an upstream Office.js declaration source
 * text.
 *
 * This is a read-only, in-memory AST walk (TypeScript compiler API) over
 * text the caller supplies — it never reads files, never touches the
 * network, and never emits Microsoft declaration source. The output is
 * exactly the shape `reference-normalize.mjs` expects: symbol/member
 * names, upstream UIDs, parameter/return *shapes* (not full type
 * declarations), and `[Api set: ...]` requirement-set metadata.
 *
 * Only symbols and members explicitly present in `manifestSymbols` are ever
 * extracted; everything else upstream — however large — is ignored.
 */

import ts from 'typescript';

const REQUIREMENT_SET_PATTERN = /\[Api set:\s*([^\]]+)\]/;

const KNOWN_NAMESPACE_PREFIXES = /\b(Word|OfficeExtension)\./g;
/** Matches a bare namespace-qualified type reference, e.g. `Word.InsertLocation`
 *  (the enum type itself) or `Word.InsertLocation.replace` (an enum member). */
const NAMESPACED_TYPE_OR_ENUM_MEMBER = /^(Word|OfficeExtension)\.[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/;
const STRING_LITERAL = /^["'](?:[^"'\\]|\\.)*["']$/;
const SINGLE_QUOTED_LITERAL = /^'((?:[^'\\]|\\.)*)'$/;
const OBJECT_LITERAL_TYPE = /^\{[\s\S]*\}$/;

/**
 * Splits a top-level union type's text on `|`, respecting that an inline
 * object-literal type's own members may (in principle) contain further
 * unions — the split only needs to be correct for the shapes actually
 * present in the manifest-selected members of this task's Word subset, all
 * of which keep object-literal alternatives free of top-level `|`.
 */
/**
 * Splits on `|`, trims each part, and drops empty parts — a Prettier-style
 * multi-line union with a leading `|` before its first member (as this
 * repository's own formatting produces) otherwise leaves a spurious empty
 * leading alternative.
 */
function splitUnion(text) {
  return text
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * String-literal types compare on *value*, not on the source's quote
 * style — `'Start'` and `"Start"` are the same type. Canonicalizing to
 * double quotes here means this fixture's shape comparison can never
 * false-positive on a code-style difference between Office.js's own
 * double-quoted declarations and DocxEditor's authored source (which may
 * reasonably use single quotes per this repository's formatting).
 */
function canonicalizeStringLiteralQuotes(part) {
  const match = SINGLE_QUOTED_LITERAL.exec(part);
  return match ? `"${match[1]}"` : part;
}

/**
 * Normalizes an Office.js parameter/return type string down to the shape
 * facts this task's reference fixture records. Two deliberate,
 * documented simplifications (see compat/manifest.json):
 *
 *  1. Office.js overloads frequently offer the same value two ways — a
 *     `Word.SomeEnum` member (`Word.InsertLocation.replace`) or the
 *     equivalent string literal (`"Replace"`). When a string-literal
 *     alternative is present, the enum-qualified alternatives collapse
 *     into it; the runtime enum objects themselves are proxy-runtime
 *     plumbing (Task 3), not part of this contract-freeze task.
 *  2. Inline anonymous object-literal alternatives (e.g. the "or a plain
 *     options object" overload on `search(...)`) are dropped in favor of
 *     the named class alternative (e.g. `Word.SearchOptions`) already
 *     covered by its own selected symbol; deep structural comparison of
 *     anonymous object types is out of scope for this task.
 *
 * Any remaining `Word.`/`OfficeExtension.` namespace qualifiers are
 * stripped so the fixture stays namespace-agnostic (facts about shapes,
 * not about which host namespace declared them).
 */
export function normalizeTypeText(text) {
  const parts = splitUnion(text).filter((part) => !OBJECT_LITERAL_TYPE.test(part));
  const hasStringLiteral = parts.some((part) => STRING_LITERAL.test(part));
  const kept = hasStringLiteral
    ? parts.filter((part) => !NAMESPACED_TYPE_OR_ENUM_MEMBER.test(part))
    : parts;
  const survivors = kept.length > 0 ? kept : parts;
  return survivors
    .map((part) => canonicalizeStringLiteralQuotes(part.replace(KNOWN_NAMESPACE_PREFIXES, '')))
    .join(' | ');
}

function getRequirementSet(sourceFile, node) {
  const ranges = ts.getLeadingCommentRanges(sourceFile.text, node.getFullStart()) ?? [];
  for (const range of ranges) {
    const match = REQUIREMENT_SET_PATTERN.exec(sourceFile.text.slice(range.pos, range.end));
    if (match) return match[1].trim();
  }
  return null;
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

function extractClassOrInterface(sourceFile, namespaceName, name, stmt, selection) {
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
        uid: `${namespaceName}.${name}#${memberName}`,
        kind: method ? 'method' : 'property',
        ...(!method && isReadonlyMember(member) ? { readonly: true } : {}),
        requirementSet: getRequirementSet(sourceFile, member),
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
    uid: `${namespaceName}.${name}`,
    kind: ts.isClassDeclaration(stmt) ? 'class' : 'interface',
    requirementSet: getRequirementSet(sourceFile, stmt),
    members,
  };
}

function extractFunction(sourceFile, namespaceName, name, stmt) {
  return {
    uid: `${namespaceName}.${name}`,
    kind: 'function',
    requirementSet: getRequirementSet(sourceFile, stmt),
    overloads: [
      { params: extractParams(sourceFile, stmt.parameters), returns: extractReturns(sourceFile, stmt) },
    ],
  };
}

function matchesNamespace(stmt, namespaceName) {
  return (
    ts.isModuleDeclaration(stmt) &&
    ts.isIdentifier(stmt.name) &&
    stmt.name.text === namespaceName &&
    stmt.body != null &&
    ts.isModuleBlock(stmt.body)
  );
}

/**
 * @param {string} sourceText Full upstream declaration source (or any
 *   subset of it containing `declare namespace <Namespace> { ... }`
 *   blocks).
 * @param {Record<string, { members?: string[]; isFunction?: boolean; namespace?: string }>} manifestSymbols
 *   Local symbol name -> selection. `namespace` defaults to `"Word"`; a few
 *   foundational symbols (e.g. `ClientObject`) live in `OfficeExtension`
 *   instead. Declaration merging (multiple `declare namespace X {}` blocks
 *   for the same namespace) is honored: a symbol's members accumulate
 *   across every block that declares them.
 * @returns Raw symbol facts, suitable for `buildReferenceFixture`'s
 *   `symbols` argument.
 */
export function extractWordReference(sourceText, manifestSymbols) {
  const sourceFile = ts.createSourceFile(
    'office-js.d.ts',
    sourceText,
    ts.ScriptTarget.Latest,
    true
  );
  const result = {};
  const namespacesToScan = new Set(
    Object.values(manifestSymbols).map((selection) => selection.namespace ?? 'Word')
  );

  for (const stmt of sourceFile.statements) {
    const namespaceName = [...namespacesToScan].find((ns) => matchesNamespace(stmt, ns));
    if (!namespaceName) continue;

    for (const inner of stmt.body.statements) {
      if (ts.isFunctionDeclaration(inner)) {
        const name = inner.name?.text;
        const selection = name ? manifestSymbols[name] : undefined;
        if (!name || !selection?.isFunction || (selection.namespace ?? 'Word') !== namespaceName) {
          continue;
        }
        const extracted = extractFunction(sourceFile, namespaceName, name, inner);
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
        if ((selection.namespace ?? 'Word') !== namespaceName) continue;

        const extracted = extractClassOrInterface(sourceFile, namespaceName, name, inner, selection);
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
