/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Resolve development source aliases for Node evaluation workers, and compile their TypeScript.
 *
 * The sources use syntax that type stripping cannot run, such as parameter properties, so each
 * `.ts` file is transpiled here. Node 26 removed `--experimental-transform-types`, and this works
 * the same on every Node release that has `registerHooks`.
 */
import { readFileSync } from 'node:fs';
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
const TYPESCRIPT = /\.(?:ts|mts|tsx)$/;
registerHooks({
  resolve(specifier, context, nextResolve) {
    const paths = Object.hasOwn(aliases, specifier) ? aliases[specifier] : undefined;
    return nextResolve(paths ? pathToFileURL(resolve(base, paths[0])).href : specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.startsWith('file:') || !TYPESCRIPT.test(new URL(url).pathname)) {
      return nextLoad(url, context);
    }
    const fileName = fileURLToPath(url);
    const { outputText } = ts.transpileModule(readFileSync(fileName, 'utf8'), {
      fileName,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        sourceMap: false,
      },
    });
    return { format: 'module', source: outputText, shortCircuit: true };
  },
});
