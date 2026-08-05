#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  findUnresolvedDeclarationImports,
  validateDeclarationTree,
} from './lib/validate-declaration-syntax.mjs';

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

const PRIVATE_CORE_SPECIFIER = /@docx-editor\.dev\/core(?:-contract)?(?:\/[^'"]*)?/;
const WORKSPACE_CORE_PATH = /(?:\.\.\/)+core\/src\//;

function isPrivateDeclarationImportLine(line) {
  if (/^import\s/.test(line) && (PRIVATE_CORE_SPECIFIER.test(line) || WORKSPACE_CORE_PATH.test(line))) {
    return true;
  }
  if (
    /^export\s.*\sfrom\s['"]/.test(line) &&
    (PRIVATE_CORE_SPECIFIER.test(line) || WORKSPACE_CORE_PATH.test(line))
  ) {
    return true;
  }
  return false;
}

function referencesPrivateCoreDeclaration(content) {
  return content.split('\n').some(isPrivateDeclarationImportLine);
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
    if (/\.rollup-temp\.d\.ts$/.test(artifact)) continue;
    const content = readFileSync(artifact, 'utf8');
    const isDeclaration = artifact.endsWith('.d.ts');
    const leaksWorkspacePath =
      isDeclaration &&
      (/(?:\.\.\/)+core\/src\//.test(content) ||
        /\/packages\/[^/]+\/src\//.test(content) ||
        /@docx-editor\.dev\/core\/(?:flow-model|pagination-model|painter-model)(?:\/|['"])/.test(
          content
        ));
    const referencesPrivateCoreContract =
      isDeclaration && referencesPrivateCoreDeclaration(content);
    const referencesPlaceholderCore = referencesPrivateCoreContract;
    const importsPrivateCoreSubpath =
      !isDeclaration &&
      /(?:from\s*|import\s*\()\s*['"]@docx-editor\.dev\/core\/(?:flow-model|pagination-model|painter-model)(?:\/|['"])/.test(
        content
      );
    if (
      leaksWorkspacePath ||
      referencesPrivateCoreContract ||
      referencesPlaceholderCore ||
      importsPrivateCoreSubpath
    ) {
      errors.push(`${path.relative(root, artifact)} exposes a private or placeholder core import`);
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

for (const packageDir of packageDirs) {
  const distDir = path.join(root, 'packages', packageDir, 'dist');
  if (!existsSync(distDir)) continue;
  errors.push(...findUnresolvedDeclarationImports(distDir));
  errors.push(...validateDeclarationTree(distDir));
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log('Published package exports and declarations are self-contained.');
