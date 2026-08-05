// Emit a private core-contract declaration graph into a published package's
// `dist/_contract/` folder. Uses a temp directory outside src/dist; nothing
// is written under packages/core/src.

import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const CORE_ROOT = 'packages/core';
const SURFACES = {
  adapter: 'contract-surfaces/adapter-contract-surface.ts',
  agentsHeadless: 'contract-surfaces/agents-headless-surface.ts',
};

/**
 * @param {string} repoRoot
 * @param {'adapter' | 'agentsHeadless'} surface
 * @param {string} destDir absolute path to dist/_contract
 */
export function bundleContractDts(repoRoot, surface, destDir) {
  const coreRoot = path.join(repoRoot, CORE_ROOT);
  const surfaceRel = SURFACES[surface];
  const surfaceAbs = path.join(coreRoot, surfaceRel);
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'docx-contract-dts-'));
  const outDir = path.join(tempRoot, 'out');
  const tsconfigPath = path.join(tempRoot, 'tsconfig.json');

  writeFileSync(
    tsconfigPath,
    `${JSON.stringify(
      {
        extends: path.join(coreRoot, 'tsconfig.json'),
        compilerOptions: {
          noEmit: false,
          emitDeclarationOnly: true,
          declaration: true,
          declarationMap: false,
          noCheck: true,
          outDir,
          rootDir: coreRoot,
        },
        include: [surfaceAbs],
      },
      null,
      2
    )}\n`
  );

  const result = spawnSync('bunx', ['tsc', '-p', tsconfigPath], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    rmSync(tempRoot, { recursive: true, force: true });
    throw new Error(`contract dts emit failed for ${surfaceRel}`);
  }

  const emittedSrc = path.join(outDir, 'src');
  rmSync(destDir, { recursive: true, force: true });
  cpSync(emittedSrc, destDir, { recursive: true });

  if (surface === 'agentsHeadless') {
    writeFileSync(
      path.join(destDir, 'headless.d.ts'),
      "export type * from './headless/types';\n"
    );
  }

  rewriteContractGraphImports(destDir);
  stripExternalModuleImports(destDir);
  rmSync(tempRoot, { recursive: true, force: true });
}

const CORE_CONTRACT_SUBPATH = /@docx-editor\.dev\/core-contract(?:\/([^'"]+))?/g;
const WORKSPACE_CORE_SRC = /\.\.\/\.\.\/core\/src\/([^'"]+)/g;
const PRIVATE_CORE = /@docx-editor\.dev\/core(?:\/([^'"]+))?/g;

function walkDtsFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const absolute = path.join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      files.push(...walkDtsFiles(absolute));
      continue;
    }
    if (entry.endsWith('.d.ts')) files.push(absolute);
  }
  return files;
}

function resolveContractModule(destDir, subpath) {
  const normalized =
    !subpath || subpath === 'contracts/types'
      ? 'contracts/types-barrel'
      : subpath.replace(/\/index$/, '').replace(/\.ts$/, '');
  const withEditor = normalized === 'editor' ? 'editor/index' : normalized;
  const flat = path.join(destDir, `${withEditor}.d.ts`);
  if (existsSync(flat)) return flat;
  const index = path.join(destDir, withEditor, 'index.d.ts');
  if (existsSync(index)) return index;
  return flat;
}

function relativeContractImport(fromFile, targetFile) {
  let rel = path.relative(path.dirname(fromFile), targetFile).replace(/\\/g, '/');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel.replace(/\.d\.ts$/, '');
}

function stripExternalModuleImports(destDir) {
  const ambientPath = path.join(destDir, 'ambient.d.ts');
  writeFileSync(
    ambientPath,
    `declare module 'fflate' {
  export function strToU8(input: string): Uint8Array;
  export function strFromU8(input: Uint8Array): string;
}
declare module 'prosemirror-model' {
  export class Schema {}
  export type Node = unknown;
}
declare module 'prosemirror-view' {
  export class EditorView {}
}

declare function strToU8(input: string): Uint8Array;
declare function strFromU8(input: Uint8Array): string;

type PMNode = unknown;
`
  );

  const externalImport = /^import(?: type)?(?: .*)? from '(?!\.)([^'"]+)';?\s*\n/gm;
  for (const file of walkDtsFiles(destDir)) {
    if (file.endsWith(`${path.sep}ambient.d.ts`)) continue;
    const before = readFileSync(file, 'utf8');
    let after = before.replace(externalImport, '');
    after = after.replace(/^export \{ strToU8, strFromU8 \};\s*\n/gm, '');
    after = after.replace(/\bPMNode\b/g, 'unknown');
    after = after.replace(/\bEditorView\b/g, 'unknown');
    after = after.replace(/\bSchema<[^>]+>/g, 'unknown');
    after = after.replace(/\bSchema\b/g, 'unknown');
    if (after !== before) writeFileSync(file, after);
  }
}

function rewriteContractGraphImports(destDir) {
  for (const file of walkDtsFiles(destDir)) {
    let content = readFileSync(file, 'utf8');
    content = content.replace(
      /(from ['"])@docx-editor\.dev\/core-contract(?:\/([^'"]+))?(['"])/g,
      (_, pre, subpath, post) =>
        `${pre}${relativeContractImport(file, resolveContractModule(destDir, subpath))}${post}`
    );
    content = content.replace(
      /import\('@docx-editor\.dev\/core-contract(?:\/([^'"]+))?'\)/g,
      (_, subpath) =>
        `import('${relativeContractImport(file, resolveContractModule(destDir, subpath))}')`
    );
    content = content.replace(/(from ['"]\.\/?[^'"]+)\.ts(['"])/g, '$1$2');
    content = content.replace(/import\('(\.\/?[^'"]+)\.ts'\)/g, "import('$1')");
    writeFileSync(file, content);
  }
}

/** Map a core-contract subpath to a relative `_contract` module id. */
export function contractSubpathToRelative(subpath) {
  if (!subpath) return './_contract/contracts/types-barrel';
  const normalized = subpath.replace(/\.ts$/, '').replace(/\/index$/, (match, offset, whole) =>
    offset + match.length === whole.length ? '' : '/index'
  );
  if (normalized === 'editor') return './_contract/editor/index';
  if (normalized === 'contracts/types') return './_contract/contracts/types-barrel';
  return `./_contract/${normalized}`;
}

/** Map a private `@docx-editor.dev/core` subpath to `_contract` for agents. */
export function coreSubpathToRelative(subpath) {
  if (!subpath || subpath === 'headless') return './_contract/headless';
  if (subpath === 'utils/paragraphFlashTypes') return './_contract/utils/paragraphFlashTypes';
  return `./_contract/${subpath.replace(/\.ts$/, '')}`;
}

export function rewriteCoreContractImports(content) {
  let after = content.replace(CORE_CONTRACT_SUBPATH, (_, subpath) =>
    contractSubpathToRelative(subpath)
  );
  after = after.replace(WORKSPACE_CORE_SRC, (_, subpath) => contractSubpathToRelative(subpath));
  return after;
}

export function rewritePrivateCoreImports(content) {
  let after = content.replace(PRIVATE_CORE, (_, subpath) => coreSubpathToRelative(subpath));
  after = after.replace(WORKSPACE_CORE_SRC, (_, subpath) => coreSubpathToRelative(subpath));
  return after;
}
