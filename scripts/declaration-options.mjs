// Compiler options for the package declaration builds (tsup `dts.compilerOptions`).
//
// Each package's tsconfig maps its sibling packages (`@docx-editor.dev/*`) to their
// sources, for `bun run typecheck`. The declaration builds drop those mappings and read
// the siblings' built `dist/*.d.ts` instead, which `build:packages` builds first: compiling
// the sibling sources again multiplied the memory of every declaration build.
//
// The siblings are exactly the ones scripts/check-built-siblings.mjs checks for a current
// build. Every other path stays: local aliases such as react's `@/*`, the package's own
// name, and packages it uses only in tests.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { packageName } from './build-core-declarations.mjs';
import { siblingsOf } from './check-built-siblings.mjs';

/** @param {string | URL} configUrl the calling tsup config's `import.meta.url` */
export function declarationCompilerOptions(configUrl, extra = {}) {
  const file = join(dirname(fileURLToPath(configUrl)), 'tsconfig.json');
  const { config, error } = ts.readConfigFile(file, ts.sys.readFile);
  if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'));
  // The effective paths, including any that an `extends` base defines.
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, dirname(file));
  const siblings = siblingsOf(dirname(file));
  const paths = Object.fromEntries(
    Object.entries(options.paths ?? {}).filter(
      ([specifier]) => !siblings.has(packageName(specifier))
    )
  );
  return { ...extra, paths };
}
