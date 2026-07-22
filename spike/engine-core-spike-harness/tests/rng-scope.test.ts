import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  RevisionOriginLog,
  auditImplementationSurface,
  assertScopedProofFeature,
  createSeededRng,
  formatFailureDiagnostic,
  loadScopeManifest,
  listAllowedProofFeatures,
  listForbiddenSpikeFeatures,
  pickOne,
  randomInt,
} from '../src';

describe('seeded RNG', () => {
  test('same seed produces identical sequence', () => {
    const a = createSeededRng(42);
    const b = createSeededRng(42);
    const seqA = [a(), a(), randomInt(a, 0, 5), pickOne(a, ['x', 'y'])];
    const seqB = [b(), b(), randomInt(b, 0, 5), pickOne(b, ['x', 'y'])];
    expect(seqA).toEqual(seqB);
  });

  test('different seeds diverge', () => {
    expect(createSeededRng(1)()).not.toBe(createSeededRng(2)());
  });
});

describe('failure diagnostic format', () => {
  test('includes fixture seed ops origins revisions divergent state', () => {
    const text = formatFailureDiagnostic({
      fixture: 'gate-3-yjs-convergence',
      seed: 99,
      operations: [{ kind: 'insert', text: 'a' }],
      origins: ['remote'],
      revisions: [3, 4],
      divergentState: { a: 'x', b: 'y' },
    });
    expect(text).toContain('fixture: gate-3-yjs-convergence');
    expect(text).toContain('seed: 99');
    expect(text).toContain('operations:');
    expect(text).toContain('origins:');
    expect(text).toContain('revisions:');
    expect(text).toContain('divergentState:');
  });
});

describe('scope manifest', () => {
  test('only scoped proof features are allowed', () => {
    expect(() => assertScopedProofFeature('production-document-engine')).toThrow(/forbidden/);
    expect(() => assertScopedProofFeature('unknown-feature')).toThrow(/unlisted/);
    expect(() => assertScopedProofFeature('seeded-rng-diagnostics')).not.toThrow();
    expect(listAllowedProofFeatures().length).toBeGreaterThan(10);
    expect(listForbiddenSpikeFeatures()).toContain('prosemirror-in-store');
  });

  test('audits concrete module/import/export feature inventory', () => {
    const scope = loadScopeManifest();
    expect(scope.implementationSurface.status).toBe(
      'harness-audit-only-not-engine-runtime-enforcement'
    );
    const sourceRoot = join(import.meta.dir, '../src');
    expect(
      auditImplementationSurface(
        { ...scope.implementationSurface, sourceRoot },
        scope.allowedProofFeatures,
        ['prosemirror', '__DOCX_EDITOR_E2E__', 'painter']
      )
    ).toEqual([]);
    expect(
      auditImplementationSurface(
        {
          sourceRoot,
          derivedSurfaceHash: 'invalid',
          modules: [
            {
              path: 'src/bad.ts',
              features: ['production-document-engine'],
            },
          ],
        },
        scope.allowedProofFeatures,
        ['prosemirror']
      )
    ).toHaveLength(2);
    const actualModules: string[] = [];
    const actualSource: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (path.endsWith('.ts')) {
          actualModules.push(path.slice(path.indexOf('src/')));
          actualSource.push(readFileSync(path, 'utf8'));
        }
      }
    };
    walk(sourceRoot);
    expect(scope.implementationSurface.modules.map((module) => module.path).sort()).toEqual(
      actualModules.sort()
    );
    expect(actualSource.join('\n')).not.toMatch(
      /from\s+['"][^'"]*(?:prosemirror|painter)[^'"]*['"]|window\.__DOCX_EDITOR_E2E__\s*(?:\?|\.)/
    );
  });
});

describe('revision and origin logger', () => {
  test('records immutable monotonic revision/origin entries', () => {
    const log = new RevisionOriginLog();
    log.append({
      fixture: 'gate-12-command-parity',
      revision: 1,
      origin: 'human',
      operationIds: ['op-1'],
    });
    log.append({
      fixture: 'gate-12-command-parity',
      revision: 2,
      origin: 'remote',
      operationIds: ['op-2'],
    });
    expect(log.entries()).toEqual([
      {
        fixture: 'gate-12-command-parity',
        revision: 1,
        origin: 'human',
        operationIds: ['op-1'],
      },
      {
        fixture: 'gate-12-command-parity',
        revision: 2,
        origin: 'remote',
        operationIds: ['op-2'],
      },
    ]);
    expect(() =>
      log.append({
        fixture: 'gate-12-command-parity',
        revision: 2,
        origin: 'agent',
        operationIds: ['op-3'],
      })
    ).toThrow(/increase/);
  });
});
