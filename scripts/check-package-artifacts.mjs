#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
// Nuxt remains private and has no publishable dist artifact.
const packageDirs = [
  'core',
  'react',
  'vue',
  'editor-api',
  'i18n',
  'pro',
  'fonts',
];
const errors = [];

// What a published artifact may name when it reaches for the engine: exactly the
// subpaths core's own export map declares. Deriving the set instead of listing it
// keeps this honest when core adds or retires a lane — a hand-written denylist ages
// into false positives on subpaths that have since become public.
const corePackageJson = JSON.parse(
  readFileSync(path.join(root, 'packages/core/package.json'), 'utf8')
);
const publicCoreSubpaths = new Set(
  Object.keys(corePackageJson.exports ?? {})
    .filter((subpath) => subpath.startsWith('./'))
    .map((subpath) => subpath.slice(2))
);

function filesBelow(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    const absolute = path.join(directory, entry);
    return statSync(absolute).isDirectory() ? filesBelow(absolute) : [absolute];
  });
}

function exportTargets(value) {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap(exportTargets);
}

for (const packageDir of packageDirs) {
  const packageRoot = path.join(root, 'packages', packageDir);
  const packageJson = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));

  for (const [subpath, declaration] of Object.entries(packageJson.exports ?? {})) {
    for (const target of exportTargets(declaration)) {
      if (!target.startsWith('./dist/')) continue;
      if (!existsSync(path.resolve(packageRoot, target))) {
        errors.push(`${packageJson.name} ${subpath} points to missing ${target}`);
      }
    }
  }

  for (const artifact of filesBelow(path.join(packageRoot, 'dist'))) {
    if (!/\.(?:[cm]?js|d\.ts)$/.test(artifact)) continue;
    const content = readFileSync(artifact, 'utf8');
    const isDeclaration = artifact.endsWith('.d.ts');
    if (isDeclaration && (/(?:\.\.\/)+core\/src\//.test(content) || /\/packages\/[^/]+\/src\//.test(content))) {
      errors.push(`${path.relative(root, artifact)} exposes a workspace-only source path`);
    }

    // A subpath core does not export resolves to nothing on a consumer's disk, so the
    // failure lands at their `npm install`, not ours.
    if (packageDir !== 'core') {
      for (const [, subpath] of content.matchAll(/@docx-editor\.dev\/core\/([\w./-]+)/g)) {
        if (!publicCoreSubpaths.has(subpath)) {
          errors.push(
            `${path.relative(root, artifact)} imports @docx-editor.dev/core/${subpath}, which core does not export`
          );
        }
      }
    }

    if (!isDeclaration && artifact.endsWith('.js')) {
      for (const match of content.matchAll(/\brequire\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
        const request = match[1];
        const target = path.resolve(path.dirname(artifact), request);
        const candidates = [target, `${target}.js`, path.join(target, 'index.js')];
        if (!candidates.some(existsSync)) {
          errors.push(
            `${path.relative(root, artifact)} requires missing private artifact ${request}`
          );
        }
      }
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log('Published package exports and declarations are self-contained.');
