#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const packageDirs = ['react', 'vue', 'agents', 'i18n', 'nuxt'];
const errors = [];

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
    const leaksWorkspacePath =
      isDeclaration &&
      (/(?:\.\.\/)+core\/src\//.test(content) ||
        /\/packages\/[^/]+\/src\//.test(content) ||
        /@docx-editor\.dev\/core\/(?:flow-model|pagination-model|painter-model|editor)(?:\/|['"])/.test(
          content
        ));
    const importsPrivateCoreSubpath =
      !isDeclaration &&
      /(?:from\s*|import\s*\()\s*['"]@docx-editor\.dev\/core\/(?:flow-model|pagination-model|painter-model|editor)(?:\/|['"])/.test(
        content
      );
    if (leaksWorkspacePath || importsPrivateCoreSubpath) {
      errors.push(`${path.relative(root, artifact)} exposes a workspace-only source path`);
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

// The `@docx-editor.dev/core/api` runtime-export check lives in the core repo —
// core ships from npm and its dist/ is not present here.

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log('Published package exports and declarations are self-contained.');
