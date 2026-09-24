// Compiler options for the package declaration builds (tsup `dts.compilerOptions`).
//
// Each package's tsconfig maps its sibling packages (`@docx-editor.dev/*`) to their
// sources, for `bun run typecheck`. The declaration builds drop those mappings and read
// the siblings' built `dist/*.d.ts` instead, which `build:packages` builds first: compiling
// the sibling sources again multiplied the memory of every declaration build. Local
// aliases, such as react's `@/*`, stay.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/** @param {string | URL} configUrl the calling tsup config's `import.meta.url` */
export function declarationCompilerOptions(configUrl, extra = {}) {
  const file = join(dirname(fileURLToPath(configUrl)), 'tsconfig.json');
  const { config, error } = ts.readConfigFile(file, ts.sys.readFile);
  if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'));
  const paths = Object.fromEntries(
    Object.entries(config.compilerOptions?.paths ?? {}).filter(
      ([specifier]) => !specifier.startsWith('@docx-editor.dev/')
    )
  );
  return { ...extra, paths };
}
