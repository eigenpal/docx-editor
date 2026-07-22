/** @spike-features one-schema-backed-docx-editor-command, stable-paragraph-ids, fixture-comparators */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  auditImplementationSurface,
  deriveImplementationSurface,
  executeCommandOnServer,
  hashImplementationSurface,
  loadScopeManifest,
} from '../src';
import * as harness from '../src';

const BLOCK_ID_INDEX_INTERNALS = [
  'authoredBlockIdLookupWorkForTests',
  'buildBlockIdIndex',
  'resetAuthoredBlockIdLookupWorkForTests',
  'resolveAuthoredParagraphByBlockId',
  'validateBlockIdIndex',
  'registerCanonicalBodyIndex',
  'isRegisteredCanonicalAuthoredBody',
] as const;

describe('task 2.3 export surface — block ID index internals', () => {
  test('package root does not export block-index implementation symbols', () => {
    for (const symbol of BLOCK_ID_INDEX_INTERNALS) {
      expect(symbol in harness, `root must not export ${symbol}`).toBe(false);
    }
  });

  test('model/index re-exports no block-id-index symbols', () => {
    const source = readFileSync(join(import.meta.dir, '../src/model/index.ts'), 'utf8');
    expect(source).not.toMatch(/block-id-index/);
  });

  test('scope audit derived exports omit block-id-index internals from public barrels', () => {
    const scope = loadScopeManifest();
    const sourceRoot = join(import.meta.dir, '../src');
    const derived = auditImplementationSurface(
      { ...scope.implementationSurface, sourceRoot },
      scope.allowedProofFeatures,
      ['prosemirror', '__DOCX_EDITOR_E2E__', 'painter']
    );
    expect(derived).toEqual([]);

    const modelIndex = readFileSync(join(sourceRoot, 'model/index.ts'), 'utf8');
    for (const symbol of BLOCK_ID_INDEX_INTERNALS) {
      expect(modelIndex, `model/index must not export ${symbol}`).not.toMatch(
        new RegExp(`\\b${symbol}\\b`)
      );
    }
  });
});

describe('task 2.3 export surface — single schema command entry', () => {
  test('package root exposes exactly one server command executor returning CommandResult', () => {
    expect(typeof executeCommandOnServer).toBe('function');
    expect('executeCommandOnServerWithDiagnostics' in harness).toBe(false);
  });

  test('execution/index re-exports no diagnostics wrapper', () => {
    const source = readFileSync(join(import.meta.dir, '../src/execution/index.ts'), 'utf8');
    expect(source).not.toMatch(/executeCommandOnServerWithDiagnostics/);
    expect(source).not.toMatch(/ServerCommandExecutionDiagnostics/);
  });

  test('server-execution module does not export diagnostics wrapper', () => {
    const source = readFileSync(
      join(import.meta.dir, '../src/execution/server-execution.ts'),
      'utf8'
    );
    expect(source).not.toMatch(/export function executeCommandOnServerWithDiagnostics/);
    expect(source).not.toMatch(/export interface ServerCommandExecutionDiagnostics/);
  });
});

describe('task 2.3 export surface — scope hash binding', () => {
  test('derived implementation surface hash matches frozen scope manifest', () => {
    const scope = loadScopeManifest();
    const derived = deriveImplementationSurface(join(import.meta.dir, '../src'));
    expect(hashImplementationSurface(derived)).toBe(scope.implementationSurface.derivedSurfaceHash);
  });

  test('scope audit keeps inverse history out of store and replication runtimes', () => {
    const sourceRoot = join(import.meta.dir, '../src');
    for (const path of [
      'store/document-store.ts',
      'store/replication-coordinator.ts',
      'store/backend/yjs-backend.ts',
    ]) {
      const source = readFileSync(join(sourceRoot, path), 'utf8');
      expect(source).not.toContain('createActorSessionGroupHistoryManager');
      expect(source).not.toContain('prepareEligibleCommit');
      expect(source).not.toContain('commitUndoRedo');
      expect(source).not.toContain('historyEffects');
    }
  });
});
