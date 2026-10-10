/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/** Resolve development source aliases for Node evaluation workers. */
import { enableCompileCache, registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
// Cache compiled source only; every request still opens and lays out its document.
enableCompileCache();
const { default: ts } = await import('typescript');

const configPath = fileURLToPath(new URL('../../tsconfig.json', import.meta.url));
const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'));
const base = resolve(dirname(configPath), config.compilerOptions.baseUrl ?? '.');
const aliases = config.compilerOptions.paths ?? {};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const paths = Object.hasOwn(aliases, specifier) ? aliases[specifier] : undefined;
    return nextResolve(paths ? pathToFileURL(resolve(base, paths[0])).href : specifier, context);
  },
});
