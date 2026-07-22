/** @spike-features fixture-comparators */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { canonicalJson } from '../canonical-json';

export interface SurfaceModule {
  readonly path: string;
  readonly imports: readonly string[];
  readonly exports: readonly string[];
  readonly features: readonly string[];
}

export interface SurfaceAudit {
  readonly sourceRoot: string;
  readonly derivedSurfaceHash: string;
  readonly modules: readonly Pick<SurfaceModule, 'path' | 'features'>[];
}

export function auditImplementationSurface(
  audit: SurfaceAudit,
  allowedFeatures: readonly string[],
  forbiddenTerms: readonly string[]
): readonly string[] {
  const errors: string[] = [];
  const derived = deriveImplementationSurface(audit.sourceRoot);
  if (hashImplementationSurface(derived) !== audit.derivedSurfaceHash) {
    errors.push('derived import/export/feature surface hash mismatch');
  }
  const expectedByPath = new Map(audit.modules.map((module) => [module.path, module]));
  const derivedByPath = new Map(derived.map((module) => [module.path, module]));
  if (!sameStrings([...expectedByPath.keys()], [...derivedByPath.keys()])) {
    errors.push('observed module inventory mismatch');
  }
  for (const module of derived) {
    if (!module.path.startsWith('src/')) errors.push(`${module.path}: module must be under src/`);
    const expected = expectedByPath.get(module.path);
    if (!expected) continue;
    if (!sameStrings(module.features, expected.features)) {
      errors.push(`${module.path}: feature inventory mismatch`);
    }
    for (const feature of module.features) {
      if (!allowedFeatures.includes(feature))
        errors.push(`${module.path}: unscoped feature ${feature}`);
    }
    for (const imported of module.imports) {
      if (forbiddenTerms.some((term) => imported.toLowerCase().includes(term.toLowerCase()))) {
        errors.push(`${module.path}: forbidden import ${imported}`);
      }
    }
  }
  return errors;
}

export function deriveImplementationSurface(sourceRoot: string): readonly SurfaceModule[] {
  const paths: string[] = [];
  walk(sourceRoot, paths);
  return paths.sort(codeUnitCompare).map((path) => deriveModule(sourceRoot, path));
}

export function hashImplementationSurface(modules: readonly SurfaceModule[]): string {
  return new Bun.CryptoHasher('sha256').update(canonicalJson(modules)).digest('hex');
}

function walk(directory: string, paths: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path, paths);
    else if (path.endsWith('.ts')) paths.push(path);
  }
}

function deriveModule(sourceRoot: string, path: string): SurfaceModule {
  const source = readFileSync(path, 'utf8');
  const imports = new Set<string>();
  for (const match of source.matchAll(
    /\bimport\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gs
  )) {
    imports.add(match[1]!);
  }
  for (const match of source.matchAll(
    /\bexport\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/gs
  )) {
    imports.add(match[1]!);
  }
  const exports = new Set<string>();
  for (const match of source.matchAll(
    /\bexport\s+(?:declare\s+)?(?:abstract\s+)?(?:namespace|class|function|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g
  )) {
    exports.add(match[1]!);
  }
  for (const match of source.matchAll(/\bexport\s*\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/gs)) {
    for (const item of match[1]!.split(',')) {
      const cleaned = item.trim().replace(/^type\s+/, '');
      if (cleaned.length === 0) continue;
      const parts = cleaned.split(/\s+as\s+/);
      exports.add(parts.at(-1)!);
    }
  }
  for (const match of source.matchAll(/\bexport\s+\*\s+from\s+['"]([^'"]+)['"]/g)) {
    exports.add(`*:${match[1]}`);
  }
  const featureMatch = source.match(/@spike-features\s+([^\n*]+)/);
  const features = featureMatch
    ? featureMatch[1]!
        .split(',')
        .map((feature) => feature.trim())
        .filter(Boolean)
    : [];
  return {
    path: `src/${relative(sourceRoot, path).replaceAll('\\', '/')}`,
    imports: [...imports].sort(codeUnitCompare),
    exports: [...exports].sort(codeUnitCompare),
    features: features.sort(codeUnitCompare),
  };
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return (
    a.length === b.length &&
    [...a]
      .sort(codeUnitCompare)
      .every((value, index) => value === [...b].sort(codeUnitCompare)[index])
  );
}

function codeUnitCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
