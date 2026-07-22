import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  createDocOpBatch,
  createFrozenAuthoredFixture,
  createMutationOrigin,
  createSemanticDocumentStore,
  docRange,
  executeCommandOnServer,
  executeDocOpOnServer,
  fingerprintAuthoredModel,
  nonEmptyString,
  planSemanticCommand,
  type DocOpSingle,
  type ServerExecutionContext,
} from '../src';

const STORY = 'story-body-0';

function agentBatch(ops: DocOpSingle[], constituentIds: string[]) {
  return createDocOpBatch({
    ops,
    transaction: {
      actorId: 'actor-server',
      sessionId: 'session-server-1',
      groupId: 'group-server-1',
      constituentIds,
    },
  });
}

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

describe('server execution — red gate (task 2.3)', () => {
  test('module exposes PM-free DocOp and command execution', () => {
    expect(typeof executeDocOpOnServer).toBe('function');
    expect(typeof executeCommandOnServer).toBe('function');
    expect(typeof planSemanticCommand).toBe('function');
  });
});

describe('server execution — DocOp path', () => {
  test('applies insert DocOp through canonical store with one ModelChange', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    let notifications = 0;
    store.subscribeModel(() => {
      notifications += 1;
    });
    const result = executeDocOpOnServer(
      serverContext(store),
      agentBatch(
        [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 2, text: 'S' }],
        ['op-server-insert-1']
      ),
      createMutationOrigin('agent', {
        actorId: 'actor-server',
        sessionId: 'session-server-1',
      })
    );
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(notifications).toBe(1);
    expect(result.change.revisionAfter).toBe(1);
    expect(store.model.authored.body.paragraphs.get('para-010')?.text).toBe('p0S10');
  });

  test('rejects untrusted DocOp at the trust boundary', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    const result = executeDocOpOnServer(
      serverContext(store),
      {
        version: 'doc-op/1',
        kind: 'batch',
        ops: [
          { kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'x' },
        ],
        transaction: {
          actorId: 'actor-server',
          sessionId: 'session-server-1',
          groupId: 'group-server-1',
          constituentIds: ['op-untrusted'],
        },
      },
      createMutationOrigin('agent', {
        actorId: 'actor-server',
        sessionId: 'session-server-1',
      })
    );
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.code).toBe('untrusted-doc-op');
    expect(store.model.revision).toBe(0);
  });
});

describe('server execution — schema-backed command', () => {
  test('toggleMark applies bold through shared semantic handler', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    const selection = docRange({
      storyId: STORY,
      blockId: 'block-para-010',
      start: 0,
      end: 4,
    });
    const result = executeCommandOnServer(serverContext(store, selection), {
      type: 'toggleMark',
      mark: 'bold',
    });
    expect(result).toEqual({ status: 'applied', changed: true });
    const paragraph = store.model.authored.body.paragraphs.get('para-010')!;
    expect(
      paragraph.marks.some((mark) => mark.kind === 'bold' && mark.start === 0 && mark.end === 4)
    ).toBe(true);
  });

  test('rejects invalid command payload at schema trust boundary', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    const result = executeCommandOnServer(serverContext(store), {
      type: 'toggleMark',
      mark: 'underline' as 'bold',
    });
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.code).toBe('invalid-command');
    expect(store.model.revision).toBe(0);
  });

  test('shared handler and server path return the same CommandResult shape', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    const selection = docRange({
      storyId: STORY,
      blockId: 'block-para-010',
      start: 0,
      end: 2,
    });
    const planned = planSemanticCommand(
      { type: 'toggleMark', mark: 'bold' },
      {
        storyId: STORY,
        selection,
        model: store.model,
      },
      {
        actorId: 'actor-server',
        sessionId: 'session-server-1',
        groupId: 'group-server-1',
        constituentId: 'op-server-plan',
      }
    );
    const executed = executeCommandOnServer(serverContext(store, selection), {
      type: 'toggleMark',
      mark: 'bold',
    });
    expect(executed.status).toBe(planned.result.status);
    expect(executed.changed).toBe(planned.result.changed);
  });
});

describe('server execution — PM-free surface', () => {
  test('server execution modules import no ProseMirror or DOM APIs', () => {
    const root = join(import.meta.dir, '../src/execution');
    const paths: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (path.endsWith('.ts')) paths.push(path);
      }
    };
    walk(root);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      const source = readFileSync(path, 'utf8');
      expect(source).not.toMatch(/\bprosemirror\b/i);
      expect(source).not.toMatch(/\bdocument\.(createElement|write)\b/);
      expect(source).not.toMatch(/\bwindow\b/);
    }
  });

  test('command no-op leaves canonical fingerprint unchanged', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    const fingerprintBefore = fingerprintAuthoredModel(store.model);
    const result = executeCommandOnServer(
      serverContext(store, docRange({ storyId: STORY, blockId: 'block-para-010', start: 2, end: 2 })),
      { type: 'toggleMark', mark: 'bold' }
    );
    expect(result.status).toBe('noOp');
    expect(fingerprintAuthoredModel(store.model)).toBe(fingerprintBefore);
  });
});
