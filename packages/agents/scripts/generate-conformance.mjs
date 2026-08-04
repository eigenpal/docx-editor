#!/usr/bin/env node
/**
 * The conformance generator (task-1 requirement 5).
 *
 * Reads the repository-owned normalized reference fixture
 * (`compat/reference/word.reference.json`) plus DocxEditor's own,
 * independently authored declarations (`compat/docxeditor/declarations.ts`)
 * and emits:
 *
 *   - `compat/generated/docxeditor.shape.json` — the same normalized shape
 *     data extracted from DocxEditor's own source, for human/diff review.
 *   - `compat/generated/conformance.assertions.ts` — strict, per-overload
 *     TypeScript compile assertions (see the file's own header for why this
 *     is a real second check, not a restatement of the JSON diff).
 *
 * This is a pure, offline, read-only transformation: it never fetches
 * anything over the network and never emits the public DocxEditor API
 * itself (that lives in `compat/docxeditor/declarations.ts`, hand-authored,
 * not generated).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractDocxEditorShape } from './lib/extract-docxeditor-shape.mjs';
import { buildReferenceFixture } from './lib/reference-normalize.mjs';
import { compareFixtures, overloadEquals } from './lib/shape-compare.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Re-qualifies bare references to DocxEditor's own selected type names
 * (e.g. `RangeCollection` -> `DocxEditor.RangeCollection`) so a type built
 * from extracted, namespace-stripped overload text can be embedded in a
 * standalone `.ts` file that imports the `DocxEditor` namespace rather than
 * living inside it. String-literal contents are protected from rewriting.
 */
function qualifyKnownTypeNames(text, knownNames) {
  if (knownNames.size === 0) return text;
  const literalPattern = /"(?:[^"\\]|\\.)*"/g;
  const literals = [];
  const masked = text.replace(literalPattern, (match) => {
    literals.push(match);
    return `\u0000${literals.length - 1}\u0000`;
  });
  const sortedNames = [...knownNames].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const namePattern = new RegExp(`\\b(${sortedNames.join('|')})\\b`, 'g');
  const qualified = masked.replace(namePattern, 'DocxEditor.$1');
  return qualified.replace(/\u0000(\d+)\u0000/g, (_, index) => literals[Number(index)]);
}

/**
 * `Word.run<T>` is the only generic member in the selected subset (a
 * single free type parameter named `T`). Rather than re-declaring each
 * synthetic wrapper type as generic (which reintroduces exactly the
 * deferred-conditional problem `type-assert.ts` documents, one level up —
 * TypeScript cannot resolve `IsExact<Ref<T>, Auth<T>>` to a concrete
 * `true`/`false` while `T` is still abstract), substitute a single
 * concrete placeholder for `T` on both the reference and authored sides
 * *before* the comparison. Structural/arity conformance for a generic
 * overload does not depend on which concrete type its free variable takes.
 */
function substituteGenericPlaceholder(text) {
  return text.replace(/\bT\b/g, 'unknown');
}

function overloadToFunctionTypeText(overload, knownNames) {
  const params = overload.params
    .map((p) => `${p.name}${p.optional ? '?' : ''}: ${qualifyKnownTypeNames(p.type, knownNames)}`)
    .join(', ');
  const returns = qualifyKnownTypeNames(overload.returns, knownNames);
  return substituteGenericPlaceholder(`(${params}) => ${returns}`);
}

/**
 * Names that may legitimately appear as a bare type reference inside a
 * generated overload's parameter/return type text, and so must be
 * re-qualified to `DocxEditor.Name` for use outside the namespace block.
 * Deliberately excludes `isFunction` manifest entries (e.g. `run`): a
 * function is never a valid type-position reference, so keeping it out of
 * this set means the regex in `qualifyKnownTypeNames` can never rewrite an
 * incidental identifier that happens to share a function's name.
 */
function collectKnownTypeNames(manifest) {
  const typeSymbolNames = Object.entries(manifest.symbols ?? {})
    .filter(([, selection]) => !selection.isFunction)
    .map(([name]) => name);
  return new Set([...typeSymbolNames, 'ClientRequestContext', 'SelectionMode', 'HeaderFooterType']);
}

function sanitizeIdentifier(text) {
  return text.replace(/[^A-Za-z0-9_]/g, '_');
}

function emitAssertionPair(label, refOverload, authoredOverload, knownNames, counterState) {
  const index = counterState.next++;
  const baseName = sanitizeIdentifier(`${label}_${index}`);
  const refText = overloadToFunctionTypeText(refOverload, knownNames);
  const authoredText = overloadToFunctionTypeText(authoredOverload, knownNames);
  // Two steps, not one `AssertExact<A, B>` combinator — see the `Expect`
  // doc comment in `type-assert.ts` for why folding this into a single
  // generic alias fails to compile regardless of the concrete types used.
  return [
    `type Ref_${baseName} = ${refText};`,
    `type Auth_${baseName} = ${authoredText};`,
    `type _check_${baseName} = IsExact<Ref_${baseName}, Auth_${baseName}>;`,
    `type _assert_${baseName} = Expect<_check_${baseName}>;`,
    '',
  ];
}

/**
 * A bare function-type comparison (`() => T`, what `emitAssertionPair`
 * builds for every overload including property getters) cannot distinguish
 * `readonly` from writable: `readonly` is a member modifier, not part of a
 * function type. Wrapping the return type in a single-property object
 * literal — `{ readonly value: T }` vs `{ value: T }` — moves the
 * comparison onto ground where `IsExact`'s bidirectional-`extends` trick
 * *does* see the modifier (verified empirically: TypeScript's structural
 * `extends` ignores `readonly` for plain object types too in general, but
 * the conditional-distribution trick `IsExact` uses does not — the two
 * property shapes compare as `false`, not `true`). Emitted in addition to,
 * not instead of, the getter-shaped pair from `emitAssertionPair`, and only
 * for property-kind members — `readonly` has no meaning on a method
 * overload or a top-level function, so there is nothing to represent there.
 */
function emitPropertyReadonlyAssertionPair(
  label,
  referenceMember,
  authoredMember,
  knownNames,
  counterState
) {
  const index = counterState.next++;
  const baseName = sanitizeIdentifier(`${label}_readonly_${index}`);
  const referenceOverload = referenceMember.overloads?.[0] ?? { returns: 'never' };
  const authoredOverload = authoredMember?.overloads?.[0] ?? { returns: 'never' };
  const refType = qualifyKnownTypeNames(referenceOverload.returns, knownNames);
  const authType = qualifyKnownTypeNames(authoredOverload.returns, knownNames);
  const refText = substituteGenericPlaceholder(
    `{ ${referenceMember.readonly ? 'readonly ' : ''}value: ${refType} }`
  );
  const authText = substituteGenericPlaceholder(
    `{ ${authoredMember?.readonly ? 'readonly ' : ''}value: ${authType} }`
  );
  return [
    `type Ref_${baseName} = ${refText};`,
    `type Auth_${baseName} = ${authText};`,
    `type _check_${baseName} = IsExact<Ref_${baseName}, Auth_${baseName}>;`,
    `type _assert_${baseName} = Expect<_check_${baseName}>;`,
    '',
  ];
}

function findAuthoredOverload(referenceOverload, authoredOverloads) {
  // Assertions are generated per *reference* overload. Prefer an authored
  // overload that is an exact `overloadEquals` match — the same predicate
  // `compareFixtures` uses — so that when a member has *multiple*
  // same-arity overloads (e.g. `Word.run`'s `(ClientObject, batch)` vs
  // `(ClientObject[], batch)`), the assertion pairs each reference overload
  // with the authored overload it actually corresponds to, rather than
  // arbitrarily pairing same-arity-but-different-shape overloads (which
  // would report a spurious mismatch even though a real exact match exists
  // elsewhere in the authored list). Falls back to an arity match, then to
  // authored[0], then to an intentionally-empty stand-in so the generated
  // file still compiles far enough to surface the real error at the
  // `Expect` site rather than at a missing-identifier site.
  return (
    authoredOverloads.find((o) => overloadEquals(referenceOverload, o)) ??
    authoredOverloads.find((o) => o.params.length === referenceOverload.params.length) ??
    authoredOverloads[0] ?? {
      params: referenceOverload.params.map(() => ({ name: 'never', type: 'never' })),
      returns: 'never',
    }
  );
}

function renderAssertionsFile(referenceFixture, authoredFixture, knownNames) {
  const counterState = { next: 0 };
  const body = [];

  for (const [symbolName, referenceSymbol] of Object.entries(referenceFixture.symbols)) {
    const authoredSymbol = authoredFixture.symbols[symbolName];
    if (referenceSymbol.kind === 'function') {
      const authoredOverloads = authoredSymbol?.overloads ?? [];
      for (const overload of referenceSymbol.overloads ?? []) {
        body.push(
          ...emitAssertionPair(
            symbolName,
            overload,
            findAuthoredOverload(overload, authoredOverloads),
            knownNames,
            counterState
          )
        );
      }
      continue;
    }
    for (const [memberName, referenceMember] of Object.entries(referenceSymbol.members ?? {})) {
      const authoredMember = authoredSymbol?.members?.[memberName];
      const authoredOverloads = authoredMember?.overloads ?? [];
      for (const overload of referenceMember.overloads ?? []) {
        body.push(
          ...emitAssertionPair(
            `${symbolName}_${memberName}`,
            overload,
            findAuthoredOverload(overload, authoredOverloads),
            knownNames,
            counterState
          )
        );
      }
      if (referenceMember.kind === 'property') {
        body.push(
          ...emitPropertyReadonlyAssertionPair(
            `${symbolName}_${memberName}`,
            referenceMember,
            authoredMember,
            knownNames,
            counterState
          )
        );
      }
    }
  }

  return [
    '// GENERATED FILE — do not edit by hand.',
    '//',
    '// Produced by packages/agents/scripts/generate-conformance.mjs from',
    '// compat/reference/word.reference.json (upstream-derived facts, never',
    "// upstream source) and compat/docxeditor/declarations.ts (DocxEditor's",
    '// own, independently authored public interfaces).',
    '//',
    "// Each `_assert_*` alias fails to compile — via IsExact's bidirectional",
    '// `extends` check, not one-directional structural `extends` — the moment a',
    '// selected Word.* overload (per compat/manifest.json) stops having an exact',
    "// structural match in DocxEditor's own declarations. Referencing `DocxEditor.*`",
    "// names also means a typo'd or unexported authored type name fails here as a",
    '// real "Cannot find name" compiler error, not just a silent textual mismatch.',
    '',
    "import type { IsExact, Expect } from '../docxeditor/type-assert';",
    "import type { DocxEditor } from '../docxeditor/declarations';",
    '',
    ...body,
  ].join('\n');
}

/**
 * @param {object} params
 * @param {object} params.referenceFixture Parsed `word.reference.json`.
 * @param {object} params.manifest Parsed `manifest.json`.
 * @param {string} params.docxEditorSourceText Full text of
 *   `compat/docxeditor/declarations.ts`.
 * @param {string} params.docxEditorPackageVersion Version recorded in the
 *   authored shape fixture's `generatedFrom` field (informational only).
 */
export function generateConformance({
  referenceFixture,
  manifest,
  docxEditorSourceText,
  docxEditorPackageVersion,
}) {
  const rawAuthoredShape = extractDocxEditorShape(docxEditorSourceText, manifest.symbols);
  const authoredFixture = buildReferenceFixture({
    packageName: 'docxeditor-declarations (compat/docxeditor/declarations.ts)',
    packageVersion: docxEditorPackageVersion,
    symbols: rawAuthoredShape,
  });
  const issues = compareFixtures(referenceFixture, authoredFixture);
  const knownNames = collectKnownTypeNames(manifest);
  const assertionsSource = renderAssertionsFile(referenceFixture, authoredFixture, knownNames);
  return { authoredFixture, issues, assertionsSource };
}

async function main() {
  const compatDir = path.join(__dirname, '..', 'compat');
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
  );
  const referenceFixture = JSON.parse(
    fs.readFileSync(path.join(compatDir, 'reference', 'word.reference.json'), 'utf8')
  );
  const manifest = JSON.parse(fs.readFileSync(path.join(compatDir, 'manifest.json'), 'utf8'));
  const docxEditorSourceText = fs.readFileSync(
    path.join(compatDir, 'docxeditor', 'declarations.ts'),
    'utf8'
  );

  const { authoredFixture, issues, assertionsSource } = generateConformance({
    referenceFixture,
    manifest,
    docxEditorSourceText,
    docxEditorPackageVersion: packageJson.version,
  });

  const generatedDir = path.join(compatDir, 'generated');
  fs.mkdirSync(generatedDir, { recursive: true });
  fs.writeFileSync(
    path.join(generatedDir, 'docxeditor.shape.json'),
    `${JSON.stringify(authoredFixture, null, 2)}\n`
  );
  fs.writeFileSync(path.join(generatedDir, 'conformance.assertions.ts'), `${assertionsSource}\n`);

  console.log(`Wrote ${path.join(generatedDir, 'docxeditor.shape.json')}`);
  console.log(`Wrote ${path.join(generatedDir, 'conformance.assertions.ts')}`);

  if (issues.length > 0) {
    console.error(`\n${issues.length} conformance issue(s):`);
    for (const issue of issues) console.error(`  - ${issue}`);
    process.exitCode = 1;
  } else {
    console.log('No conformance issues.');
  }
}

// See the identical guard in `fetch-office-reference.mjs` for why
// `pathToFileURL` is used instead of the fragile `file://${argv[1]}` string
// build.
const isMainModule =
  process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
