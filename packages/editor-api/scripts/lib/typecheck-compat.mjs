/**
 * A thin, in-process wrapper around the real TypeScript compiler
 * (`ts.createProgram` + `ts.getPreEmitDiagnostics`) for a given
 * `tsconfig.json`. No child process, no network — this is what makes the
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
 * These projects necessarily contain core's sources, so each one is a real ten-to-fifteen-second
 * compile. `bun test` allows five seconds by default, which made these fail for being slow rather
 * than for finding anything — the worst kind of red, because it says nothing about the code. The
 * budget is stated where the cost is, so every caller inherits the same one.
 */
export const TYPECHECK_TIMEOUT_MS = 120_000;

/**
 * `scope: 'program'` (the default) answers the diagnostics of every file the program reaches.
 * `scope: 'project'` answers those of the files the tsconfig itself includes, plus the option and
 * global diagnostics; the types they use from other files still resolve and are checked where
 * used. A project that reaches core's sources spends nearly all of a whole-program check on
 * core's own bodies, which core's typecheck already covers: about ten times the time and four
 * times the memory, which under a loaded test pool runs past the timeout.
 */
export function typecheckProject(tsconfigPath, { scope = 'program' } = {}) {
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

  return diagnostics.map((diagnostic) => {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    if (diagnostic.file && diagnostic.start !== undefined) {
      const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      return `${diagnostic.file.fileName}:${line + 1}:${character + 1} - ${message}`;
    }
    return message;
  });
}

function projectDiagnostics(program, fileNames) {
  const own = new Set(fileNames.map((fileName) => path.resolve(fileName)));
  const diagnostics = [...program.getOptionsDiagnostics(), ...program.getGlobalDiagnostics()];
  for (const sourceFile of program.getSourceFiles()) {
    if (!own.has(path.resolve(sourceFile.fileName))) continue;
    diagnostics.push(
      ...program.getSyntacticDiagnostics(sourceFile),
      ...program.getSemanticDiagnostics(sourceFile)
    );
  }
  return diagnostics;
}
