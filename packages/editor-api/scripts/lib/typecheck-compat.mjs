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

export function typecheckProject(tsconfigPath) {
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
  const diagnostics = ts.getPreEmitDiagnostics(program);

  return diagnostics.map((diagnostic) => {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    if (diagnostic.file && diagnostic.start !== undefined) {
      const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      return `${diagnostic.file.fileName}:${line + 1}:${character + 1} - ${message}`;
    }
    return message;
  });
}
