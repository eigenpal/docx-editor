/** @spike-features one-schema-backed-docx-editor-command, bold-mark */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createFrozenAuthoredFixture,
  createSemanticDocumentStore,
  docRange,
  executeCommandOnServer,
  isRangeFullyMarked,
  planSemanticCommand,
  snapshotAndValidateCommand,
  snapshotAndValidateQuery,
  type ServerExecutionContext,
} from '../src';

const STORY = 'story-body-0';

function serverContext(
  store: ReturnType<typeof createSemanticDocumentStore>,
  selection: ServerExecutionContext['selection'] = null
): ServerExecutionContext {
  return {
    store,
    actorId: 'actor-server',
    sessionId: 'session-server-1',
    groupId: 'group-server-1',
    selection,
    originKind: 'agent',
  };
}

describe('task 2.3 review regressions — command trust boundary', () => {
  test('snapshotAndValidateCommand rejects accessor fields without invoking getters', () => {
    let invoked = false;
    const accessor = Object.defineProperty(
      { type: 'toggleMark' },
      'mark',
      {
        enumerable: true,
        get() {
          invoked = true;
          return 'bold';
        },
      }
    );
    const result = snapshotAndValidateCommand(accessor);
    expect(result.snapshot).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(invoked).toBe(false);
  });

  test('snapshotAndValidateCommand rejects dangerous keys and non-plain objects', () => {
    expect(snapshotAndValidateCommand({ type: 'toggleMark', mark: 'bold', __proto__: { x: 1 } }).errors).not.toEqual([]);
    expect(snapshotAndValidateCommand(Object.create(null)).errors).not.toEqual([]);
    expect(snapshotAndValidateCommand(null).errors).not.toEqual([]);
  });

  test('snapshotAndValidateCommand validates a closed snapshot against TOCTOU mutation', () => {
    const mutable = { type: 'toggleMark', mark: 'bold' } as Record<string, unknown>;
    const first = snapshotAndValidateCommand(mutable);
    expect(first.errors).toEqual([]);
    expect(first.snapshot).toEqual({ type: 'toggleMark', mark: 'bold' });
    mutable.mark = 'underline';
    expect(snapshotAndValidateCommand(mutable).errors.length).toBeGreaterThan(0);
  });

  test('snapshotAndValidateCommand returns typed errors instead of throwing AJV exceptions', () => {
    const broken = { type: 'toggleMark', mark: 123 };
    expect(() => snapshotAndValidateCommand(broken)).not.toThrow();
    const result = snapshotAndValidateCommand(broken);
    expect(result.snapshot).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.every((error) => typeof error === 'string')).toBe(true);
  });

  test('snapshotAndValidateQuery applies the same closed-input trust boundary', () => {
    let invoked = false;
    const accessor = Object.defineProperty(
      { type: 'findText' },
      'text',
      {
        enumerable: true,
        get() {
          invoked = true;
          return 'probe';
        },
      }
    );
    const result = snapshotAndValidateQuery(accessor);
    expect(result.snapshot).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(invoked).toBe(false);
  });

  test('executeCommandOnServer uses command snapshot validation at the trust boundary', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    let invoked = false;
    const command = Object.defineProperty(
      { type: 'toggleMark' },
      'mark',
      {
        enumerable: true,
        get() {
          invoked = true;
          return 'bold';
        },
      }
    );
    const result = executeCommandOnServer(serverContext(store), command);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.code).toBe('invalid-command');
    expect(invoked).toBe(false);
    expect(store.model.revision).toBe(0);
  });
});

describe('task 2.3 review regressions — toggleMark planning bounds', () => {
  test('rejects out-of-bounds selection before mark planning', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    const selection = docRange({
      storyId: STORY,
      blockId: 'block-para-010',
      start: 0,
      end: 999,
    });
    const plan = planSemanticCommand(
      { type: 'toggleMark', mark: 'bold' },
      { storyId: STORY, selection, model: store.model },
      {
        actorId: 'actor-server',
        sessionId: 'session-server-1',
        groupId: 'group-server-1',
        constituentId: 'op-task23-bounds',
      }
    );
    expect(plan.result.status).toBe('failed');
    if (plan.result.status === 'failed') expect(plan.result.code).toBe('invalid-selection');
    expect(plan.docOp).toBeNull();
  });

  test('isRangeFullyMarked uses bounded interval coverage instead of per-offset scanning', () => {
    const paragraph = storeParagraphWithMarks();
    const source = readFileSync(
      join(import.meta.dir, '../src/execution/mark-range.ts'),
      'utf8'
    );
    expect(source).not.toMatch(/for\s*\(\s*let\s+offset\s*=\s*start/);
    expect(
      isRangeFullyMarked(paragraph, 'bold', 0, 4)
    ).toBe(true);
    expect(
      isRangeFullyMarked(paragraph, 'bold', 0, 5)
    ).toBe(false);
  });
});

describe('task 2.3 review regressions — isolated spike dependency', () => {
  test('harness package.json declares ajv directly', () => {
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dir, '../package.json'), 'utf8')
    ) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies?.ajv).toBeDefined();
    expect(pkg.dependencies?.ajv).toMatch(/^\^?8\./);
  });

  test('harness lockfile records ajv without parent hoisting', () => {
    const lock = readFileSync(join(import.meta.dir, '../bun.lock'), 'utf8');
    expect(lock).toMatch(/"ajv@/);
  });
});

function storeParagraphWithMarks() {
  const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
  const paragraph = store.model.authored.body.paragraphs.get('para-001')!;
  return {
    ...paragraph,
    marks: [
      { markId: 'mark-a', kind: 'bold' as const, start: 0, end: 2 },
      { markId: 'mark-b', kind: 'bold' as const, start: 2, end: 4 },
      { markId: 'mark-c', kind: 'italic' as const, start: 0, end: 4 },
    ],
  };
}
