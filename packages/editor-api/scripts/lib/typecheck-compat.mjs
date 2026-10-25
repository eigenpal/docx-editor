/**
 * A thin, in-process wrapper around the real TypeScript compiler (`ts.createProgram`) for a
 * given `tsconfig.json`. No child process, no network — this is what makes the
 * "strict per-overload compile assertions" in
 * `compat/generated/conformance.assertions.ts` an actual, deterministic,
 * offline `bun test` check rather than aspirational documentation.
 */

import fs from 'node:fs';
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
 * `forbiddenGlobals` names host globals no file the program reaches may reference as a bare
 * identifier, in either scope (`globalThis.process` and a property named `Bun` are fine). It is
 * a parse-only scan, so a project can keep that guarantee for code it does not type-check.
 */
export function typecheckProject(tsconfigPath, { scope = 'program', forbiddenGlobals = [] } = {}) {
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
    ...globalReferences(program, new Set(forbiddenGlobals)),
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

/** Bare references to `names` in every non-dependency file of the program. */
function globalReferences(program, names) {
  if (names.size === 0) return [];
  const found = [];
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.fileName.includes('/node_modules/')) continue;
    const visit = (node) => {
      if (ts.isIdentifier(node) && names.has(node.text) && isReference(node)) {
        found.push(
          `${where(sourceFile, node.getStart(sourceFile))} - names the host global ${node.text}`
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return found;
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
  return !('name' in parent && parent.name === node);
}
