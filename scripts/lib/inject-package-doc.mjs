// Post-build helper that prepends each entry's source `@packageDocumentation`
// block to the generated `.d.ts` (and `.d.mts` / `.d.cts`) files.
//
// Why this exists:
// tsup uses rollup-plugin-dts under the hood, which hoists transitive type
// imports above the file-head doc comment. That strips the
// `@packageDocumentation` block from the published `.d.ts`. Both API
// Extractor (driving `docs/api/<pkg>/*.api.md`) and consumer IDEs lose the
// package-level description.
//
// This script reads the original source's head doc-block (the one tagged
// `@packageDocumentation`), and re-prepends it to the corresponding dist
// `.d.ts` so the description survives the build. Idempotent: if the dist
// already has the tag, it's a no-op.
//
// Wired into each package's `build` script after tsup and asset-copying.

import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolve the source file behind a subpath's dist `import` path.
 * Mirrors the logic in `api-extractor-runner.mjs` so this stays in sync
 * with how API Extractor resolves entries.
 */
function sourcePathForEntry(packageRoot, value) {
  const importPath = typeof value.import === 'string' ? value.import : null;
  if (!importPath) return null;
  const distRel = importPath.replace(/^\.\/dist\//, '').replace(/\.(m|c)?js$/, '');
  const direct = path.join(packageRoot, 'src', `${distRel}.ts`);
  if (fs.existsSync(direct)) return direct;
  const indexed = path.join(packageRoot, 'src', distRel, 'index.ts');
  if (fs.existsSync(indexed)) return indexed;
  return null;
}

/**
 * Fallback resolver for subpaths whose source lives somewhere other than
 * the dist mirror path (e.g. React's `./dialogs` maps to
 * `src/components/dialogs/index.ts`). Walks `src/` for any `.ts` whose
 * head doc-block names this exact subpath.
 */
function buildSubpathSrcIndex(packageRoot, packageName) {
  const srcRoot = path.join(packageRoot, 'src');
  const idx = new Map();
  if (!fs.existsSync(srcRoot)) return idx;
  const headerRx = new RegExp(`\\*\\s+(${escapeRegex(packageName)}(?:\\/[\\w/-]+)?)`);
  walkTs(srcRoot, (filePath) => {
    const content = fs.readFileSync(filePath, 'utf8');
    const block = /^\s*\/\*\*([\s\S]*?)\*\//.exec(content);
    if (!block) return;
    if (!block[0].includes('@packageDocumentation')) return;
    const header = headerRx.exec(block[0]);
    if (header && !idx.has(header[1])) idx.set(header[1], filePath);
  });
  return idx;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function walkTs(dir, fn) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkTs(full, fn);
    else if (entry.isFile() && /\.ts$/.test(entry.name)) fn(full);
  }
}

function readEntryDocBlock(srcPath) {
  if (!srcPath || !fs.existsSync(srcPath)) return '';
  const content = fs.readFileSync(srcPath, 'utf8');
  const m = /^\s*\/\*\*([\s\S]*?)\*\//.exec(content);
  if (!m) return '';
  if (!m[0].includes('@packageDocumentation')) return '';
  return m[0];
}

function injectIntoDts(dtsAbsPath, block) {
  if (!fs.existsSync(dtsAbsPath)) return false;
  const content = fs.readFileSync(dtsAbsPath, 'utf8');
  // API Extractor only treats a doc-block as the entry-point description
  // when it's the FIRST `/** ... */` in the file. A `@packageDocumentation`
  // tag elsewhere (e.g. inline locale data that tsup hoisted above it)
  // doesn't count, so we still need to prepend the block. Skip only when
  // the head doc-block already carries the tag.
  const headBlock = /^\s*\/\*\*([\s\S]*?)\*\//.exec(content);
  if (headBlock && headBlock[0].includes('@packageDocumentation')) return false;
  fs.writeFileSync(dtsAbsPath, `${block}\n${content}`);
  return true;
}

/**
 * @param {{ packageRoot: string, packageName: string }} options
 */
export function injectPackageDocs(options) {
  const { packageRoot, packageName } = options;
  const pkgJsonPath = path.join(packageRoot, 'package.json');
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  const exportsMap = pkgJson.exports || {};
  const subpathIdx = buildSubpathSrcIndex(packageRoot, packageName);

  let injected = 0;
  let skipped = 0;
  for (const [key, value] of Object.entries(exportsMap)) {
    if (key === './package.json') continue;
    if (typeof value !== 'object' || value === null) continue;
    if (typeof value.types !== 'string') continue;

    // Source resolution: dist-mirror first, then doc-block fallback.
    let srcPath = sourcePathForEntry(packageRoot, value);
    const fullSubpath = key === '.' ? packageName : `${packageName}${key.slice(1)}`;
    const byDocBlock = subpathIdx.get(fullSubpath);
    if (byDocBlock) srcPath = byDocBlock;

    const block = readEntryDocBlock(srcPath);
    if (!block) {
      skipped++;
      continue;
    }

    // Inject into every type-declaration sibling of `types`. tsup emits
    // both `.d.ts` (for `require`) and `.d.mts` (for `import`); rollup
    // configs sometimes also produce `.d.cts`. Re-prepend to each so the
    // description survives whichever consumer resolver picks.
    const typesAbs = path.resolve(packageRoot, value.types);
    const variants = [typesAbs];
    const noExt = typesAbs.replace(/\.d\.[cm]?ts$/, '');
    for (const ext of ['.d.ts', '.d.mts', '.d.cts']) {
      const variant = `${noExt}${ext}`;
      if (variant !== typesAbs) variants.push(variant);
    }
    for (const v of variants) {
      if (injectIntoDts(v, block)) injected++;
    }
  }

  console.log(`[inject-package-docs] ${packageName}: injected=${injected} skipped=${skipped}`);
}
