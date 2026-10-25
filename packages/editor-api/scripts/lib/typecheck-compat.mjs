/**
 * A thin, in-process wrapper around the real TypeScript compiler (`ts.createProgram`) for a
 * given `tsconfig.json`. No child process, no network — this is what makes the
 * "strict per-overload compile assertions" in
 * `compat/generated/conformance.assertions.ts` an actual, deterministic,
 * offline `bun test` check rather than aspirational documentation.
 */

import fs from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import ts from 'typescript';

/**
 * What a caller should allow a `typecheckProject` test.
 *
 * A project that reaches core's sources and checks the whole program is a real seven-to-twelve-
 * second compile, and far slower under a loaded test pool. `bun test` allows five seconds by
 * default, which made these fail for being slow rather than for finding anything — the worst kind
 * of red, because it says nothing about the code. The budget is stated where the cost is, so every
 * caller inherits the same one.
 */
export const TYPECHECK_TIMEOUT_MS = 120_000;

/**
 * Compile `tsconfigPath` and answer its diagnostics, one formatted string each.
 *
 * `scope: 'program'` (the default) answers `ts.getPreEmitDiagnostics`: every file the program
 * reaches. `scope: 'project'` answers the files the tsconfig itself includes: their syntactic,
 * semantic and (with `declaration` or `composite`) declaration diagnostics, plus the option and
 * global ones. The types those files use from other files still resolve and are checked where
 * used; the bodies of the other files are not. A project that reaches core's sources spends nearly
 * all of a whole-program check on core's own bodies, which core's typecheck covers: about ten times
 * the time and four times the memory, which under a loaded test pool runs past the timeout.
 *
 * `forbidHost: true` also reports, in every non-dependency file the program reaches and in either
 * scope, what only a server runtime provides: a Node or Bun module import (`node:fs`, `fs`,
 * `bun:test`, `import fs = require('fs')`), a `/// <reference types>` to Node or Bun, a
 * `HOST_IMPORT_META` member of `import.meta`, and a `HOST_GLOBALS` name that resolves to no
 * declaration or only to Node or Bun type packages, which a dependency's own types can pull into
 * any program (a local `process` binding is fine, and so are `globalThis.process` and a property
 * named `Bun`; an ambient `declare const process` is not, since nothing defines it in a browser).
 * A bare `buffer`, `events` or `util` import counts even where a browser polyfill would answer
 * it: the scan reports the name, and a polyfill is a decision to state, not to infer. A non-dependency file is one whose path has no `/node_modules/`. The scan reads syntax
 * and resolves only those names, so it is cheap where a whole-program check is not. Node-only
 * members of shared types (`setTimeout(...).unref()`, `Error.captureStackTrace`) are not
 * covered.
 */
export function typecheckProject(tsconfigPath, { scope = 'program', forbidHost = false } = {}) {
  const configFile = ts.readConfigFile(tsconfigPath, (file) => fs.readFileSync(file, 'utf8'));
  if (configFile.error) {
    return [ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n')];
  }

  const basePath = path.dirname(tsconfigPath);
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, basePath);
  if (parsed.errors.length > 0) {
    return parsed.errors.map((e) => ts.flattenDiagnosticMessageText(e.messageText, '\n'));
  }

  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const diagnostics =
    scope === 'project'
      ? projectDiagnostics(program, parsed.fileNames)
      : ts.getPreEmitDiagnostics(program);

  return [
    ...diagnostics.map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
      if (diagnostic.file && diagnostic.start !== undefined) {
        return `${where(diagnostic.file, diagnostic.start)} - ${message}`;
      }
      return message;
    }),
    ...(forbidHost ? hostReferences(program) : []),
  ];
}

function where(sourceFile, position) {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(position);
  return `${sourceFile.fileName}:${line + 1}:${character + 1}`;
}

function projectDiagnostics(program, fileNames) {
  const own = new Set(fileNames.map((fileName) => path.resolve(fileName)));
  const declarations =
    program.getCompilerOptions().declaration || program.getCompilerOptions().composite;
  const diagnostics = [...program.getOptionsDiagnostics(), ...program.getGlobalDiagnostics()];
  let matched = 0;
  for (const sourceFile of program.getSourceFiles()) {
    if (!own.has(path.resolve(sourceFile.fileName))) continue;
    matched += 1;
    diagnostics.push(
      ...program.getSyntacticDiagnostics(sourceFile),
      ...program.getSemanticDiagnostics(sourceFile),
      ...(declarations ? program.getDeclarationDiagnostics(sourceFile) : [])
    );
  }
  // A project whose own files the program spells differently would check nothing and pass.
  if (matched !== own.size) {
    throw new Error(`typecheckProject matched ${matched} of ${own.size} project files`);
  }
  return diagnostics;
}

/** Globals only a server runtime declares. */
export const HOST_GLOBALS = [
  'process',
  'Buffer',
  'Bun',
  'global',
  'setImmediate',
  'clearImmediate',
  '__dirname',
  '__filename',
  'require',
  'module',
  'exports',
  'NodeJS',
];

/** `import.meta` members only Node or Bun provide. */
export const HOST_IMPORT_META = ['dir', 'dirname', 'filename', 'main', 'path', 'resolveSync'];

const hostGlobals = new Set(HOST_GLOBALS);
const hostImportMeta = new Set(HOST_IMPORT_META);
// The runtime's own list, less the npm packages Bun ships inside it.
const builtins = new Set(
  builtinModules.filter((name) => !name.startsWith('bun') && name !== 'ws' && name !== 'undici')
);
/** Type packages only a server runtime provides. */
const HOST_TYPE_PACKAGES = new Set(['node', 'bun', 'bun-types']);
const hostTypeFile = /\/node_modules\/(@types\/(node|bun)|bun-types)\//;

function isHostModule(specifier) {
  return (
    specifier.startsWith('node:') ||
    specifier.startsWith('bun:') ||
    specifier === 'bun' ||
    builtins.has(specifier) ||
    builtins.has(specifier.split('/')[0])
  );
}

/** Server-runtime references in every non-dependency file of the program. */
function hostReferences(program) {
  const checker = program.getTypeChecker();
  const found = [];
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.fileName.includes('/node_modules/')) continue;
    const report = (node, what) =>
      found.push(`${where(sourceFile, node.getStart(sourceFile))} - ${what}`);
    for (const directive of sourceFile.typeReferenceDirectives) {
      if (HOST_TYPE_PACKAGES.has(directive.fileName))
        found.push(`${where(sourceFile, directive.pos)} - references types ${directive.fileName}`);
    }
    const visit = (node) => {
      const specifier = moduleSpecifierOf(node);
      if (specifier !== null && isHostModule(specifier)) report(node, `imports ${specifier}`);
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isMetaProperty(node.expression) &&
        node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
        hostImportMeta.has(node.name.text)
      )
        report(node, `reads import.meta.${node.name.text}`);
      if (
        ts.isIdentifier(node) &&
        hostGlobals.has(node.text) &&
        isReference(node) &&
        isHostSymbol(checker, node)
      )
        report(node, `names the host global ${node.text}`);
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return found;
}

/** The module an import, export, `import()`, `import("…")` type or `require` names, or null. */
function moduleSpecifierOf(node) {
  const literal =
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier
      ? node.moduleSpecifier
      : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
        ? node.arguments[0]
        : ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
          ? node.argument.literal
          : ts.isExternalModuleReference(node)
            ? node.expression
            : undefined;
  return literal && ts.isStringLiteral(literal) ? literal.text : null;
}

/** Whether an identifier is read, not a member, property, or declaration name. */
function isReference(node) {
  const parent = node.parent;
  if (!parent) return true;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isQualifiedName(parent) && parent.right === node) return false;
  // `{ process }` reads the global even though it also names the property.
  if (ts.isShorthandPropertyAssignment(parent)) return true;
  // Declarations, property assignments and signatures, import and export specifiers.
  return (
    !('name' in parent && parent.name === node) &&
    !('propertyName' in parent && parent.propertyName === node)
  );
}

/**
 * Whether a read resolves to no declaration, or only to Node or Bun type packages: a host global,
 * whether or not a dependency's types happened to declare it.
 */
function isHostSymbol(checker, node) {
  const symbol = ts.isShorthandPropertyAssignment(node.parent)
    ? checker.getShorthandAssignmentValueSymbol(node.parent)
    : checker.getSymbolAtLocation(node);
  // An ambient declaration (`declare const process`) states a name without defining it.
  const declarations = (symbol?.declarations ?? []).filter(
    (declaration) =>
      !hostTypeFile.test(declaration.getSourceFile().fileName) &&
      !(ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Ambient)
  );
  return declarations.length === 0;
}
