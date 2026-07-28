// Semantic selection sync and edit-surface integration (interactive-paginated 4.1–4.2).

import './dom-setup.ts';

import { describe, expect, test } from 'bun:test';
import {
  openDocxSession,
  mountEditSurface,
  EditorBinding,
} from '../src/index.ts';
import { resolveSemanticTarget, resolveSemanticSelection } from '../src/semantic-sync.ts';
import { resolveSelection } from '../src/selection.ts';
import { authorizeFocus, dispatchBeforeInput, dispatchHistoryUndo, dispatchPaste, pmDom, semanticMount } from './input-dom-helpers.ts';
import {
  DocumentStore,
  createEmptyModel,
  bodyStoryId,
  writeDocx,
  ORIGIN_IDS,
  type ParagraphRecord,
  type PackageModel,
  type TableRecord,
} from '@docx-editor.dev/engine-core';
import type { SemanticSelection } from '@docx-editor.dev/core-contract/interaction';
import { expectGraphemeParity } from './grapheme-parity.ts';
import { graphemeOffsetToUtf16 as layoutGraphemeOffsetToUtf16 } from '@docx-editor.dev/engine-layout';

const HUMAN = ORIGIN_IDS.mutationHuman;

function modelWithTableCell(cellText: string): PackageModel {
  const base = createEmptyModel();
  const storyId = bodyStoryId(base);
  const story = base.stories.get(storyId)!;
  const table: TableRecord = {
    kind: 'table',
    id: 'tbl-1',
    rows: [{ id: 'row-1', cells: [{ id: 'cell-1', blocks: [{ kind: 'paragraph', id: 'p-cell', runs: [{ text: cellText }] }] }] }],
  };
  return {
    ...base,
    stories: new Map(base.stories).set(storyId, { ...story, blocks: [story.blocks[0]!, table] }),
  };
}

function editableSession(initial = '') {
  const model = createEmptyModel();
  const p1 = (model.stories.get(bodyStoryId(model))!.blocks[0] as ParagraphRecord).id;
  const store = new DocumentStore(model);
  if (initial) store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p1, text: initial }));
  const binding = new EditorBinding(store);
  const session = {
    editable: true,
    readOnlyReason: null,
    projectDoc: () => binding.projectDoc(),
    applyPmDoc: (doc: Parameters<EditorBinding['commitFromDoc']>[0]) => {
      const res = binding.commitFromDoc(doc);
      return { committed: res.result?.ok === true, rejected: res.rejected === true || res.result?.ok === false, opCount: res.ops.length };
    },
    bodyText: () => initial,
    bodyBlockIds: () => store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks.map((b) => b.id),
    currentModel: () => store.currentModel,
    revision: () => store.currentRevision,
    undo: () => (store.canUndo() ? store.undo().ok : false),
    redo: () => (store.canRedo() ? store.redoLast().ok : false),
    subscribe: (fn: () => void) => store.subscribe(fn),
    save: () => writeDocx(store.currentModel),
  };
  return { session, store, binding, p1 };
}

function textTarget(storyId: string, blockId: string, graphemeOffset: number) {
  return {
    kind: 'text' as const,
    scope: { kind: 'body' as const },
    identity: { storyId, blockId },
    graphemeOffset,
    affinity: 'upstream' as const,
  };
}

function collapsedSelection(session: ReturnType<typeof editableSession>['session'], p1: string, graphemeOffset: number): SemanticSelection {
  const storyId = bodyStoryId(session.currentModel());
  const target = textTarget(storyId, p1, graphemeOffset);
  return { frameId: { value: 1 }, scope: { kind: 'body' }, anchor: target, head: target };
}

function pmFrom(binding: EditorBinding, paragraphId: string, offset: number): number {
  return resolveSelection({ paragraphId, offset, affinity: 'after' }, binding.projectDoc()).from;
}

function mountWithHooks(session: ReturnType<typeof editableSession>['session'], parent: HTMLElement, onModelChanged?: () => void) {
  let helpers: {
    pmSelection(): { from: number; to: number; empty: boolean };
    stripBlockEmbed(objectId: string): void;
  } | undefined;
  const surface = mountEditSurface(parent, session, {
    onModelChanged,
    testHooks: {
      onReady: (h) => {
        helpers = h;
      },
    },
  }) as TestSurface;
  if (!helpers) throw new Error('test hooks not ready');
  return { surface, helpers: helpers! };
}

describe('grapheme parity with engine-layout', () => {
  test('binding grapheme offsets match layout segmentation vectors', () => {
    expectGraphemeParity();
  });
});

describe('semantic ownership resolution', () => {
  test('rejects table-cell paragraph without caller role', () => {
    const model = modelWithTableCell('cell');
    const session = { currentModel: () => model } as ReturnType<typeof openDocxSession>;
    const storyId = bodyStoryId(model);
    const outcome = resolveSemanticTarget(session, textTarget(storyId, 'p-cell', 0), { value: 1 });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe('readOnly');
  });

  test('combining mark and surrogate offsets resolve to expected UTF-16 positions', () => {
    const { session, p1, binding, store } = editableSession();
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p1, text: 'e\u0301😀' }));
    const storyId = bodyStoryId(store.currentModel);
    const combining = resolveSemanticTarget(session, textTarget(storyId, p1, 1), { value: 1 });
    const surrogate = resolveSemanticTarget(session, textTarget(storyId, p1, 2), { value: 1 });
    expect(combining.ok && surrogate.ok).toBe(true);
    if (combining.ok) expect(combining.value.offset).toBe(2);
    if (surrogate.ok) {
      expect(surrogate.value.offset).toBe(layoutGraphemeOffsetToUtf16('e\u0301😀', 2));
    }
  });

  test('run-boundary grapheme offset uses concatenated paragraph text', () => {
    const model = createEmptyModel();
    const storyId = bodyStoryId(model);
    const store = new DocumentStore(model);
    const p1 = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
    store.transact(HUMAN, (c) =>
      c.apply({
        op: 'setParagraphRuns',
        paragraphId: p1,
        runs: [
          { text: 'ab' },
          { text: 'cd', props: { bold: true } },
        ],
      }),
    );
    const session = { currentModel: () => store.currentModel } as ReturnType<typeof openDocxSession>;
    const outcome = resolveSemanticTarget(session, textTarget(storyId, p1, 2), { value: 1 });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value.offset).toBe(layoutGraphemeOffsetToUtf16('abcd', 2));
  });

  test('cross-paragraph range resolves both endpoints', () => {
    const model = createEmptyModel();
    const storyId = bodyStoryId(model);
    const store = new DocumentStore(model);
    const p1 = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p1, text: 'aaa' }));
    const appended = store.transact(HUMAN, (c) => c.apply({ op: 'appendParagraph', storyId }));
    const p2 = appended.ok ? appended.modelChange.created[0]! : p1;
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p2, text: 'bbb' }));
    const binding = new EditorBinding(store);
    const session = { currentModel: () => store.currentModel } as ReturnType<typeof openDocxSession>;
    const selection: SemanticSelection = {
      frameId: { value: 1 },
      scope: { kind: 'body' },
      anchor: textTarget(storyId, p1, 3),
      head: textTarget(storyId, p2, 0),
    };
    const resolved = resolveSemanticSelection(session, { frameId: { value: 1 }, selection });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      const doc = binding.projectDoc();
      const from = resolveSelection(resolved.value.anchor, doc).from;
      const to = resolveSelection(resolved.value.head, doc).to;
      expect(to).toBeGreaterThan(from);
    }
  });
});

describe('edit surface semantic sync', () => {
  test('sync sets exact PM from/to before focus', () => {
    const { session, binding, p1 } = editableSession('hello');
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountEditSurface(parent, session);
    const synced = surface.syncSemanticSelection({ frameId: { value: 1 }, selection: collapsedSelection(session, p1, 3) });
    expect(synced.ok).toBe(true);
    expect(surface.getPmSelection().from).toBe(pmFrom(binding, p1, 3));
    expect(surface.focus({ frameId: { value: 1 } }).ok).toBe(true);
    expect(surface.getPmSelection()).toEqual({ from: pmFrom(binding, p1, 3), to: pmFrom(binding, p1, 3), empty: true });
    surface.destroy();
    parent.remove();
  });

  test('stale sync leaves PM selection unchanged', () => {
    const { session, binding, p1 } = editableSession('hello');
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountEditSurface(parent, session);
    const baseline = surface.getPmSelection();
    expect(surface.syncSemanticSelection({ frameId: { value: 2 }, selection: collapsedSelection(session, p1, 4) }).ok).toBe(false);
    expect(surface.getPmSelection()).toEqual(baseline);
    surface.destroy();
    parent.remove();
  });

  test('local edit clears retained intent; undo restores history caret', () => {
    const { session, binding, p1 } = editableSession('hello');
    const parent = document.createElement('div');
    document.body.append(parent);
    const { surface } = mountWithHooks(session, parent);
    authorizeFocus(surface, collapsedSelection(session, p1, 1));
    const dom = pmDom(parent);
    const afterSync = surface.getPmSelection().from;
    dispatchBeforeInput(dom, 'insertText', 'Z');
    expect(surface.getPmSelection().from).not.toBe(afterSync);
    const beforeUndo = surface.getPmSelection().from;
    dispatchHistoryUndo(dom);
    expect(surface.getPmSelection().from).toBe(afterSync);
    expect(surface.getPmSelection().from).not.toBe(beforeUndo);
    surface.destroy();
    parent.remove();
  });

  test('owned popup retains semantic selection across blur and refocus', () => {
    const { session, binding, p1 } = editableSession('abc');
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountEditSurface(parent, session);
    surface.syncSemanticSelection({ frameId: { value: 1 }, selection: collapsedSelection(session, p1, 2) });
    surface.focus({ frameId: { value: 1 } });
    const pos = surface.getPmSelection().from;
    surface.retainSelectionForOwnedPopup();
    surface.blur();
    surface.focus({ frameId: { value: 1 } });
    expect(surface.getPmSelection().from).toBe(pos);
    surface.releaseOwnedPopup();
    surface.destroy();
    parent.remove();
  });

  test('external store revision reapplies retained semantic selection once', () => {
    const { session, store, p1 } = editableSession('abc');
    const parent = document.createElement('div');
    document.body.append(parent);
    let externalCalls = 0;
    const surface = mountEditSurface(parent, session, { onModelChanged: () => (externalCalls += 1) });
    surface.syncSemanticSelection({ frameId: { value: 1 }, selection: collapsedSelection(session, p1, 1) });
    surface.focus({ frameId: { value: 1 } });
    const expected = surface.getPmSelection().from;
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p1, text: '!' }));
    expect(externalCalls).toBe(1);
    expect(surface.getPmSelection().from).toBe(expected);
    surface.destroy();
    parent.remove();
  });

  test('local commit notifies onModelChanged once', () => {
    const { session, p1 } = editableSession('a');
    let externalCalls = 0;
    const parent = document.createElement('div');
    document.body.append(parent);
    const { surface } = mountWithHooks(session, parent, () => (externalCalls += 1));
    authorizeFocus(surface, collapsedSelection(session, p1, 1));
    dispatchBeforeInput(pmDom(parent), 'insertText', 'b');
    expect(externalCalls).toBe(1);
    surface.destroy();
    parent.remove();
  });

  test('toggle mark increments one revision and notifies onModelChanged once', () => {
    const { session, p1 } = editableSession('a');
    let modelChangeCalls = 0;
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountEditSurface(parent, session, {
      onModelChanged: () => (modelChangeCalls += 1),
    });
    const storyId = bodyStoryId(session.currentModel());
    const revisionBefore = session.revision();
    const selection: SemanticSelection = {
      frameId: { value: 1 },
      scope: { kind: 'body' },
      anchor: textTarget(storyId, p1, 0),
      head: textTarget(storyId, p1, 1),
    };
    expect(surface.syncSemanticSelection({ frameId: { value: 1 }, selection }).ok).toBe(true);
    expect(surface.focus({ frameId: { value: 1 } }).ok).toBe(true);

    expect(surface.runEditCommand({ kind: 'toggleMark', mark: 'bold' })).toEqual({
      ok: true,
      changed: true,
    });

    expect(session.revision()).toBe(revisionBefore + 1);
    expect(modelChangeCalls).toBe(1);
    surface.destroy();
    parent.remove();
  });

  test('focus without current frame identity is rejected', () => {
    const { session, p1 } = editableSession('hi');
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountEditSurface(parent, session);
    surface.syncSemanticSelection({ frameId: { value: 1 }, selection: collapsedSelection(session, p1, 0) });
    const outcome = surface.focus();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe('invalidTarget');
    surface.destroy();
    parent.remove();
  });

  test('semantic resolution success with PM application failure leaves selection unchanged', () => {
    const model = modelWithTableCell('cell');
    const store = new DocumentStore(model);
    const binding = new EditorBinding(store);
    const session = {
      editable: true,
      readOnlyReason: null,
      projectDoc: () => binding.projectDoc(),
      applyPmDoc: (doc: Parameters<EditorBinding['commitFromDoc']>[0]) => {
        const res = binding.commitFromDoc(doc);
        return { committed: res.result?.ok === true, rejected: res.rejected === true || res.result?.ok === false, opCount: res.ops.length };
      },
      bodyText: () => 'cell',
      bodyBlockIds: () => store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks.map((b) => b.id),
      currentModel: () => store.currentModel,
      revision: () => store.currentRevision,
      undo: () => false,
      redo: () => false,
      subscribe: (fn: () => void) => store.subscribe(fn),
      save: () => writeDocx(store.currentModel),
    };
    const parent = document.createElement('div');
    document.body.append(parent);
    const { surface, helpers } = mountWithHooks(session, parent);
    const baseline = surface.getPmSelection();
    helpers.stripBlockEmbed('tbl-1');
    const atomicSelection: SemanticSelection = {
      frameId: { value: 1 },
      scope: { kind: 'body' },
      anchor: { kind: 'atomic', scope: { kind: 'body' }, objectId: 'tbl-1' },
      head: { kind: 'atomic', scope: { kind: 'body' }, objectId: 'tbl-1' },
    };
    const failed = surface.syncSemanticSelection({ frameId: { value: 1 }, selection: atomicSelection });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.code).toBe('invalidTarget');
    expect(surface.getPmSelection()).toEqual(baseline);
    const refocus = surface.focus({ frameId: { value: 1 } });
    expect(refocus.ok).toBe(true);
    expect(surface.getPmSelection()).toEqual(baseline);
    surface.destroy();
    parent.remove();
  });

  test('read-only semantic projection allows focus without input authorization', () => {
    const { session } = editableSession();
    const readOnlySession = { ...session, editable: false };
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountEditSurface(parent, readOnlySession, { readOnlyProjection: true });
    const outcome = surface.focus({ frameId: { value: 1 } });
    expect(outcome.ok).toBe(true);
    expect(surface.interactionAuthorized).toBe(false);
    expect(surface.getAccessibilityObservation({ frameId: { value: 1 }, scope: { kind: 'body' } }).editable).toBe(false);
    surface.destroy();
    parent.remove();
  });
});

describe('resolveSemanticSelection frame guard', () => {
  test('detects frame mismatch', () => {
    const { session, p1 } = editableSession();
    const outcome = resolveSemanticSelection(session, {
      frameId: { value: 2 },
      selection: collapsedSelection(session, p1, 0),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe('staleFrame');
  });
});
