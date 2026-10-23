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
import { lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { enableCompileCache, registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
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
const compilerOptions = {
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX,
  sourceMap: false,
};
const digest = (value) => createHash('sha256').update(value).digest('hex');
const compilerIdentity = JSON.stringify(['typescript-runtime-v1', ts.version, compilerOptions]);
const cacheDirectory = prepareCache();

// Infrastructure diagnostics for process-level regression tests and startup investigations.
export const transpileCacheStats = { hits: 0, compiled: 0, disabled: cacheDirectory === null };

function prepareCache() {
  const directory =
    process.env.DOCX_EVAL_TRANSPILE_CACHE ??
    resolve(tmpdir(), `docx-editor-typescript-${process.getuid?.() ?? 'user'}`);
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stat = lstatSync(directory);
    if (
      !stat.isDirectory() ||
      (stat.mode & 0o077) !== 0 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      return null;
    return directory;
  } catch {
    return null; // A missing or read-only cache must not prevent compilation.
  }
}

function compile(fileName, source) {
  const key = digest(JSON.stringify([compilerIdentity, fileName, source]));
  const path = cacheDirectory && resolve(cacheDirectory, `${key}.json`);
  if (path) {
    try {
      const stat = lstatSync(path);
      if (stat.isFile() && stat.size <= 32 * 1024 * 1024) {
        const entry = JSON.parse(readFileSync(path, 'utf8'));
        if (
          entry.key === key &&
          typeof entry.code === 'string' &&
          digest(entry.code) === entry.sha256
        ) {
          transpileCacheStats.hits++;
          return entry.code;
        }
      }
    } catch {
      /* Missing, incomplete, and damaged entries compile again. */
    }
  }
  const { outputText } = ts.transpileModule(source, { fileName, compilerOptions });
  transpileCacheStats.compiled++;
  if (path) {
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(
        temporary,
        JSON.stringify({ key, code: outputText, sha256: digest(outputText) }),
        {
          flag: 'wx',
          mode: 0o600,
        }
      );
      renameSync(temporary, path);
    } catch {
      /* Concurrent writers and unavailable storage do not affect rendering. */
    } finally {
      try {
        unlinkSync(temporary);
      } catch {
        /* Published or unavailable. */
      }
    }
  }
  return outputText;
}

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
    return {
      format: 'module',
      source: compile(fileName, readFileSync(fileName, 'utf8')),
      shortCircuit: true,
    };
  },
});
