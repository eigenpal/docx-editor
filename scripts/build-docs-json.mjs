#!/usr/bin/env node
// Generate consumer-friendly JSON docs for every published subpath of
// every public package. Two phases:
//
// 1. Drive the existing API Extractor runner with `emitDocModel: true`,
//    which writes raw `<pkg>/temp/api-model/<slug>.api.json` files
//    alongside the existing `docs/api/<pkg-slug>/<slug>.api.md` snapshots.
// 2. Walk each `.api.json`, parse the TSDoc blocks, join with a
//    source-location index (built by scanning each package's `src/`),
//    and emit `docs/json/<pkg-slug>/<slug>.json` — the shape the
//    `docx-editor-page` docs site consumes.
//
// Side effect: phase 1 runs the API Extractor with `isLocal: true`, which
// rewrites the committed `docs/api/<pkg-slug>/<slug>.api.md` snapshots in
// place. The bytes match what `api:check` would produce, so this is a
// no-op when snapshots are already in sync — but it DOES touch them.
// CI runs `api:check` first, so the rewrite is silent in CI. Locally,
// expect `git status` to surface `docs/api/<pkg-slug>/*.api.md` changes if
// your branch hasn't run `bun run api:extract` yet.
//
// Run:    bun run docs:json
// CI:     `bun run docs:check` verifies the committed docs JSON matches
//         what regenerating would produce.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runApiExtractor } from './lib/api-extractor-runner.mjs';
import { buildSourceIndex } from './lib/source-index.mjs';
import { transformApiPackageJson } from './lib/docs-model.mjs';
import { PACKAGES, buildHintFor, reportDirFor } from './lib/packages.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const docsJsonDir = path.join(repoRoot, 'docs', 'json');

// GitHub source-link target. `ref` controls the link permalink:
//   `main` -> always-latest links that move with the branch
//   <SHA>  -> snapshot links that pin to the docs JSON's commit
// Default is `main` for now since docs JSON is regenerated on every PR
// touch via api:extract anyway.
const GITHUB = {
  repo: 'eigenpal/docx-editor',
  ref: process.env.DOCS_GITHUB_REF || 'main',
};

function readPackageJson(pkgRoot) {
  return JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
}

function entriesFromExports(packageRoot, packageName, exportsMap) {
  // Mirrors the runner's logic. Returns one entry per published subpath
  // that has a `.types` field. Also resolves the source `.ts` (or
  // `.ts/index.ts`) that produced the dist — we read its top-level
  // doc-comment to recover the `@packageDocumentation` block that tsup
  // strips from the published `.d.ts`.
  //
  // Source resolution: tsup configs can map a subpath to an arbitrary
  // source file (e.g. React's `./dialogs` → `src/components/dialogs/index.ts`).
  // Instead of parsing tsup configs we use a robust fallback: scan all
  // `**/index.ts` and same-named `.ts` files under `src/`, pick the one
  // whose head doc-block names this exact subpath (e.g. matches the
  // string `@eigenpal/docx-editor-react/dialogs` in the comment).
  const subpathSrcIndex = buildSubpathSrcIndex(packageRoot, packageName);

  const entries = [];
  for (const [key, value] of Object.entries(exportsMap)) {
    if (key === './package.json') continue;
    if (typeof value !== 'object' || value === null) continue;
    if (typeof value.types !== 'string') continue;
    const slug = key === '.' ? 'index' : key.replace(/^\.\//, '').replace(/\//g, '-');
    const importPath = typeof value.import === 'string' ? value.import : null;
    let srcPath = null;
    if (importPath) {
      const distRel = importPath.replace(/^\.\/dist\//, '').replace(/\.(m|c)?js$/, '');
      const direct = path.join(packageRoot, 'src', `${distRel}.ts`);
      const indexed = path.join(packageRoot, 'src', distRel, 'index.ts');
      if (fs.existsSync(direct)) srcPath = direct;
      else if (fs.existsSync(indexed)) srcPath = indexed;
    }
    // Doc-block fallback: locate by `@packageDocumentation` header that
    // names this subpath. Wins when the entry source is elsewhere on
    // disk (e.g. `src/components/dialogs/index.ts` for the `./dialogs`
    // subpath).
    const fullSubpath = key === '.' ? packageName : `${packageName}${key.slice(1)}`;
    const byDocBlock = subpathSrcIndex.get(fullSubpath);
    if (byDocBlock) srcPath = byDocBlock;
    entries.push({ key, slug, srcPath });
  }
  return entries;
}

function buildSubpathSrcIndex(packageRoot, packageName) {
  // Walk src/ and index any `.ts` file whose top doc-block:
  //   (a) is the first leading `/** … */`
  //   (b) includes `@packageDocumentation`
  //   (c) names a `${packageName}` or `${packageName}/<subpath>` header
  // Maps that subpath name → file path.
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
  // Sort entries for deterministic walk order across OSes (macOS vs
  // Linux ext4 differ on raw readdir). Otherwise `docs/json/**` drifts
  // in CI on first run after a fresh checkout.
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  );
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

function processPackage(pkg) {
  const pkgRoot = path.join(repoRoot, pkg.root);
  const pkgJson = readPackageJson(pkgRoot);
  const apiModelDir = path.join(pkgRoot, 'temp', 'api-model');

  // Phase 1: drive API Extractor with docModel on. This also rewrites the
  // `docs/api/<pkg-slug>/<slug>.api.md` snapshots — fine because those are
  // deterministic outputs of the same .d.ts files; if they were correct
  // before this run they stay byte-identical.
  runApiExtractor({
    packageRoot: pkgRoot,
    reportDir: reportDirFor(pkg, repoRoot),
    isLocal: true,
    buildHint: buildHintFor(pkg),
    tsconfigPath: pkg.tsconfigPath
      ? path.join(repoRoot, pkg.tsconfigPath)
      : undefined,
    emitDocModel: true,
  });

  // Phase 2a: source-link index for this package.
  const sourceIndex = buildSourceIndex({ packageRoot: pkgRoot, repoRoot });

  // Phase 2b: transform every <slug>.api.json into docs JSON.
  const outDir = path.join(docsJsonDir, pkg.pkgSlug);
  fs.mkdirSync(outDir, { recursive: true });

  const entries = entriesFromExports(pkgRoot, pkg.name, pkgJson.exports || {});
  let written = 0;
  for (const { key, slug, srcPath } of entries) {
    const apiJsonPath = path.join(apiModelDir, `${slug}.api.json`);
    if (!fs.existsSync(apiJsonPath)) continue;
    const raw = JSON.parse(fs.readFileSync(apiJsonPath, 'utf8'));
    const clean = transformApiPackageJson(raw, {
      sourceIndex,
      github: GITHUB,
      packageName: pkg.name,
      subpath: key,
      version: pkgJson.version,
      // tsup strips the file-head `@packageDocumentation` block before
      // emitting `.d.ts`, so the doc-model can't see it. Recover the
      // block from the original source and pass it through — it becomes
      // the subpath's top-level `summary` / `remarks` / `examples`.
      entryDocBlock: readEntryDocBlock(srcPath),
    });
    const outPath = path.join(outDir, `${slug}.json`);
    fs.writeFileSync(outPath, JSON.stringify(clean, null, 2) + '\n');
    written++;
  }

  // Phase 2c: per-package index for top-level discovery. Lists every
  // subpath with its slug, key, summary (from the entry's
  // `@packageDocumentation` block), and the relative JSON path the
  // consumer should fetch.
  const indexEntries = [];
  for (const { key, slug } of entries) {
    const docPath = path.join(outDir, `${slug}.json`);
    if (!fs.existsSync(docPath)) continue;
    const doc = JSON.parse(fs.readFileSync(docPath, 'utf8'));
    indexEntries.push({
      key,
      slug,
      summary: doc.summary || '',
      path: path.relative(docsJsonDir, docPath),
    });
  }
  const indexJson = {
    _schemaVersion: 1,
    package: pkg.name,
    version: pkgJson.version,
    pkgSlug: pkg.pkgSlug,
    github: GITHUB,
    subpaths: indexEntries,
  };
  fs.writeFileSync(
    path.join(outDir, 'index.subpaths.json'),
    JSON.stringify(indexJson, null, 2) + '\n'
  );

  console.log(`  ${pkg.name}: ${written} subpath docs written`);
}

function main() {
  console.log('Building docs JSON...');
  fs.mkdirSync(docsJsonDir, { recursive: true });

  for (const pkg of PACKAGES) {
    processPackage(pkg);
  }

  // Top-level packages index: lists every package + its subpaths-index path.
  // Lets a docs site fetch one root JSON, then drill into each package.
  // No timestamp — `docs:check` compares bytes, and `git log docs/json`
  // already tells the consumer when the docs were last refreshed.
  const root = {
    _schemaVersion: 1,
    github: GITHUB,
    packages: PACKAGES.map((p) => ({
      name: p.name,
      pkgSlug: p.pkgSlug,
      indexPath: path.posix.join(p.pkgSlug, 'index.subpaths.json'),
    })),
  };
  fs.writeFileSync(
    path.join(docsJsonDir, 'index.json'),
    JSON.stringify(root, null, 2) + '\n'
  );
  console.log(`  root index: docs/json/index.json`);
  console.log('Done.');
}

main();
