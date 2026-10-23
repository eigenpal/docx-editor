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
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
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
const compilerIdentity = JSON.stringify([
  'typescript-runtime-v2',
  ts.version,
  digest(readFileSync(ts.sys.getExecutingFilePath())),
  digest(readFileSync(fileURLToPath(import.meta.url))),
  process.version,
  process.platform,
  compilerOptions,
]);
const marker = '.docx-editor-typescript-cache-v1';
const namespacePattern = /^compile-[a-f0-9]{64}$/;
let cacheWarningEmitted = false;
let cacheWarningMessage = null;
const cacheDirectory = prepareCache();

// Infrastructure diagnostics for process-level regression tests and startup investigations.
export const transpileCacheStats = {
  hits: 0,
  compiled: 0,
  disabled: cacheDirectory === null,
  get warning() {
    return cacheWarningMessage;
  },
};

function prepareCache() {
  const root =
    process.env.DOCX_EVAL_TRANSPILE_CACHE ||
    resolve(tmpdir(), `docx-editor-typescript-${process.getuid?.() ?? 'user'}`);
  try {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    if (!privateDirectory(root))
      throw new Error('Cache directory must be owned by this user with mode 0700');
    const directory = resolve(
      root,
      `compile-${digest(JSON.stringify([compilerIdentity, configPath]))}`
    );
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (!privateDirectory(directory)) throw new Error('Unsafe cache namespace');
    const receipt = resolve(directory, marker);
    try {
      mkdirSync(receipt, { mode: 0o700 });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    if (!ownedNamespace(directory)) throw new Error('Invalid cache namespace');
    const now = new Date();
    utimesSync(directory, now, now);
    pruneNamespaces(root, directory);
    return directory;
  } catch (error) {
    warnCache(
      `Compilation cache is disabled (${error.code ?? error.message}). Check DOCX_EVAL_TRANSPILE_CACHE permissions and free space.`
    );
    return null;
  }
}

function privateDirectory(path) {
  const stat = lstatSync(path);
  return (
    stat.isDirectory() &&
    (stat.mode & 0o077) === 0 &&
    (!process.getuid || stat.uid === process.getuid())
  );
}

function ownedNamespace(path) {
  return privateDirectory(path) && privateDirectory(resolve(path, marker));
}

function pruneNamespaces(root, current) {
  const previous = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !namespacePattern.test(entry.name)) continue;
    const path = resolve(root, entry.name);
    if (path === current) continue;
    try {
      if (ownedNamespace(path)) previous.push({ path, used: lstatSync(path).mtimeMs });
    } catch {
      /* Another process can remove an old namespace. */
    }
  }
  previous.sort((a, b) => b.used - a.used);
  // Keep the current checkout and seven recent compiler/checkout namespaces.
  for (const entry of previous.slice(7)) {
    try {
      rmSync(entry.path, { recursive: true, force: true });
    } catch {
      warnCache(
        'An old compilation cache could not be removed. Check cache permissions and free space.'
      );
    }
  }
}

function warnCache(message) {
  if (cacheWarningEmitted) return;
  cacheWarningEmitted = true;
  cacheWarningMessage = message;
  process.emitWarning(message, { code: 'DOCX_TRANSPILE_CACHE' });
}

function compile(fileName, source) {
  const key = digest(JSON.stringify([compilerIdentity, fileName, source]));
  // Replace changed versions of the same file instead of retaining its complete edit history.
  const file = digest(fileName);
  const path = cacheDirectory && resolve(cacheDirectory, `${file}.json`);
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
    } catch (error) {
      warnCache(
        `Compilation cache writes failed (${error.code ?? 'unknown'}). Compilation continues; check cache permissions and free space.`
      );
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
