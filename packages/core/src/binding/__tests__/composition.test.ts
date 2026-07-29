// Native ProseMirror/DOM composition integration (interactive-paginated 4.4).

import './dom-setup.ts';

import { describe, expect, test } from 'bun:test';
import {
  mountEditSurface,
  EditorBinding,
  type EditSurface,
  type PmSelectionSnapshot,
} from '../index.ts';
import { resolveSelection } from '../selection.ts';
import {
  DocumentStore,
  createEmptyModel,
  bodyStoryId,
  writeDocx,
  parseDocx,
  ORIGIN_IDS,
  paragraphText,
  type ParagraphRecord,
} from '@docx-editor.dev/engine-core';
import type { SemanticSelection } from '@docx-editor.dev/core-contract/contracts/interaction';
import { zipSync, strToU8 } from 'fflate';
import { flushCompositionFrames } from './composition-dom.ts';
import { authorizeFocus, dispatchBeforeInput, dispatchModKey, dispatchHistoryUndo, pmDom } from './input-dom-helpers.ts';

const HUMAN = ORIGIN_IDS.mutationHuman;
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Blur-while-composing policy: flush commits the final overlay exactly once (same path as compositionend). */
const BLUR_COMPOSITION_POLICY = 'commit-once' as const;

type CompositionTestHelpers = {
  compose: (options: {
    updates: readonly string[];
    final?: string;
    cancel?: boolean;
    during?: () => void;
    end?: boolean;
  }) => Promise<void>;
  beginComposition(): void;
  pushCompositionUpdate(text: string): void;
  endComposition(finalText?: string): Promise<void>;
  readPmParagraph(paragraphId: string): string;
  pmSelection(): PmSelectionSnapshot;
  stripBlockEmbed(objectId: string): void;
};

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
    bodyText: () => paragraphText(store.currentModel, p1),
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

function rangeSelection(session: ReturnType<typeof editableSession>['session'], p1: string, from: number, to: number): SemanticSelection {
  const storyId = bodyStoryId(session.currentModel());
  return {
    frameId: { value: 1 },
    scope: { kind: 'body' },
    anchor: textTarget(storyId, p1, from),
    head: textTarget(storyId, p1, to),
  };
}

function pmFrom(binding: EditorBinding, paragraphId: string, offset: number): number {
  return resolveSelection({ paragraphId, offset, affinity: 'after' }, binding.projectDoc()).from;
}

function mountWithComposition(
  session: ReturnType<typeof editableSession>['session'],
  parent: HTMLElement,
  onModelChanged?: () => void,
): { surface: EditSurface; helpers: CompositionTestHelpers } {
  let helpers!: CompositionTestHelpers;
  const surface = mountEditSurface(parent, session, {
    onModelChanged,
    testHooks: {
      onReady: (h) => {
        helpers = h;
      },
    },
  });
  if (!helpers) throw new Error('composition test hooks not ready');
  return { surface, helpers };
}

function mixedDocSession() {
  const docx = zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>` +
        '<w:p><w:r><w:t>before</w:t></w:r></w:p>' +
        '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
        '<w:p><w:r><w:t>after</w:t></w:r></w:p>' +
        '</w:body></w:document>',
    ),
  });
  const parsed = parseDocx(docx);
  if (!parsed.ok) throw new Error('parse failed');
  const store = new DocumentStore(parsed.model);
  const binding = new EditorBinding(store);
  const blocks = store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks;
  const pBefore = blocks[0]!.id;
  const session = {
    editable: true,
    readOnlyReason: null,
    projectDoc: () => binding.projectDoc(),
    applyPmDoc: (doc: Parameters<EditorBinding['commitFromDoc']>[0]) => {
      const res = binding.commitFromDoc(doc);
      return { committed: res.result?.ok === true, rejected: res.rejected === true || res.result?.ok === false, opCount: res.ops.length };
    },
    bodyText: () => blocks.filter((b) => b.kind === 'paragraph').map((b) => paragraphText(store.currentModel, b.id)).join('\n'),
    bodyBlockIds: () => blocks.map((b) => b.id),
    currentModel: () => store.currentModel,
    revision: () => store.currentRevision,
    undo: () => (store.canUndo() ? store.undo().ok : false),
    redo: () => (store.canRedo() ? store.redoLast().ok : false),
    subscribe: (fn: () => void) => store.subscribe(fn),
    save: () => writeDocx(store.currentModel),
  };
  return { session, store, binding, pBefore };
}

describe('composition lifecycle through hidden input host', () => {
  test('start → repeated updates → end commits exactly once with no duplicate text', async () => {
    const { session, store, binding, p1 } = editableSession('hel');
    const parent = document.createElement('div');
    document.body.append(parent);
    let commits = 0;
    const { surface, helpers } = mountWithComposition(session, parent, () => (commits += 1));
    surface.syncSemanticSelection({ frameId: { value: 1 }, selection: collapsedSelection(session, p1, 3) });
    surface.focus({ frameId: { value: 1 } });
    const revBefore = store.currentRevision;

    await helpers.compose({ updates: ['l', 'lo', 'lo\u0301'], final: 'lo\u0301' });

    expect(store.currentRevision).toBe(revBefore + 1);
    expect(commits).toBe(1);
    expect(paragraphText(store.currentModel, p1)).toBe('hello\u0301');
    expect(surface.getPmSelection().from).toBe(pmFrom(binding, p1, 'hello\u0301'.length));
    expect(surface.getCompositionObservation().lastCancel).toBeNull();
    surface.destroy();
    parent.remove();
  });

  test('in-flight blur without compositionend commits overlay exactly once (blur policy)', async () => {
    expect(BLUR_COMPOSITION_POLICY).toBe('commit-once');
    const { session, store, p1 } = editableSession('ab');
    const parent = document.createElement('div');
    document.body.append(parent);
    let commits = 0;
    const { surface, helpers } = mountWithComposition(session, parent, () => (commits += 1));
    surface.syncSemanticSelection({ frameId: { value: 1 }, selection: collapsedSelection(session, p1, 2) });
    surface.focus({ frameId: { value: 1 } });
    const revBefore = store.currentRevision;

    helpers.beginComposition();
    helpers.pushCompositionUpdate('c');
    helpers.pushCompositionUpdate('cd');
    expect(surface.getCompositionObservation().active).toBe(true);
    expect(store.currentRevision).toBe(revBefore);
    expect(commits).toBe(0);

    surface.blur();
    await flushCompositionFrames();

    expect(surface.getCompositionObservation().active).toBe(false);
    expect(store.currentRevision).toBe(revBefore + 1);
    expect(commits).toBe(1);
    expect(paragraphText(store.currentModel, p1)).toBe('abcd');
    expect(surface.getCompositionObservation().lastCancel).toBeNull();

    surface.syncSemanticSelection({ frameId: { value: 1 }, selection: collapsedSelection(session, p1, 4) });
    surface.focus({ frameId: { value: 1 } });
    dispatchHistoryUndo(pmDom(parent));
    expect(paragraphText(store.currentModel, p1)).toBe('ab');
    surface.destroy();
    parent.remove();
  });

  test('cancelled composition end records typed cancel and leaves canonical unchanged', async () => {
    const { session, store, p1 } = editableSession('abc');
    const parent = document.createElement('div');
    document.body.append(parent);
    const { surface, helpers } = mountWithComposition(session, parent);
    surface.syncSemanticSelection({ frameId: { value: 1 }, selection: collapsedSelection(session, p1, 3) });
    surface.focus({ frameId: { value: 1 } });
    const revBefore = store.currentRevision;

    await helpers.compose({ updates: ['X', 'XY'], cancel: true });
    expect(store.currentRevision).toBe(revBefore);
    expect(paragraphText(store.currentModel, p1)).toBe('abc');
    expect(surface.getCompositionObservation().lastCancel?.code).toBe('cancelled');
    surface.destroy();
    parent.remove();
  });

  test('dead-key repeated updates commit accented grapheme once with one-step undo', async () => {
    const { session, store, p1 } = editableSession('');
    const parent = document.createElement('div');
    document.body.append(parent);
    let commits = 0;
    const { surface, helpers } = mountWithComposition(session, parent, () => (commits += 1));
    surface.syncSemanticSelection({ frameId: { value: 1 }, selection: collapsedSelection(session, p1, 0) });
    surface.focus({ frameId: { value: 1 } });
    const revBefore = store.currentRevision;
    const accented = 'a\u0300';

    await helpers.compose({ updates: ['`', 'a', accented], final: accented });

    expect(store.currentRevision).toBe(revBefore + 1);
    expect(commits).toBe(1);
    expect(paragraphText(store.currentModel, p1)).toBe(accented);
    expect(paragraphText(store.currentModel, p1)).not.toContain('aa');
    expect(paragraphText(store.currentModel, p1)?.length).toBe(2);

    dispatchModKey(pmDom(parent), 'z');
    expect(paragraphText(store.currentModel, p1)).toBe('');
    expect(store.canUndo()).toBe(false);
    expect(store.currentRevision).toBe(revBefore + 2);
    surface.destroy();
    parent.remove();
  });

  test('RTL composition commits exact UTF-16 content without duplication', async () => {
    const prefix = 'prefix ';
    const rtlFinal = '\u0645\u0631\u062D\u0628\u0627';
    const { session, store, p1 } = editableSession(prefix);
    const parent = document.createElement('div');
    document.body.append(parent);
    let commits = 0;
    const { surface, helpers } = mountWithComposition(session, parent, () => (commits += 1));
    surface.syncSemanticSelection({ frameId: { value: 1 }, selection: collapsedSelection(session, p1, prefix.length) });
    surface.focus({ frameId: { value: 1 } });
    const revBefore = store.currentRevision;

    await helpers.compose({
      updates: ['\u0645', '\u0645\u0631', '\u0645\u0631\u062D', rtlFinal],
      final: rtlFinal,
    });

    expect(store.currentRevision).toBe(revBefore + 1);
    expect(commits).toBe(1);
    const canonical = paragraphText(store.currentModel, p1)!;
    expect(canonical).toBe(`${prefix}${rtlFinal}`);
    expect(canonical).toBe('prefix \u0645\u0631\u062D\u0628\u0627');
    expect(canonical.includes(rtlFinal + rtlFinal)).toBe(false);
    expect(canonical.match(/\u0645\u0631\u062D\u0628\u0627/g)?.length).toBe(1);
    surface.destroy();
    parent.remove();
  });

  test('middle-of-paragraph caret insertion uses anchored overlay diff', async () => {
    const { session, store, p1 } = editableSession('helloworld');
    const parent = document.createElement('div');
    document.body.append(parent);
    const { surface, helpers } = mountWithComposition(session, parent);
    surface.syncSemanticSelection({ frameId: { value: 1 }, selection: collapsedSelection(session, p1, 5) });
    surface.focus({ frameId: { value: 1 } });

    await helpers.compose({ updates: ['X', 'XX'], final: 'XX' });
    expect(paragraphText(store.currentModel, p1)).toBe('helloXXworld');
    surface.destroy();
    parent.remove();
  });

  test('selected-range replacement composes without splitting surrogate pair', async () => {
    const { session, store, p1 } = editableSession('x\uD83D\uDE00y');
    const parent = document.createElement('div');
    document.body.append(parent);
    const { surface, helpers } = mountWithComposition(session, parent);
    surface.syncSemanticSelection({ frameId: { value: 1 }, selection: rangeSelection(session, p1, 1, 2) });
    surface.focus({ frameId: { value: 1 } });

    await helpers.compose({ updates: ['\uD83D\uDE01'], final: '\uD83D\uDE01' });
    expect(paragraphText(store.currentModel, p1)).toBe('x\uD83D\uDE01y');
    surface.destroy();
    parent.remove();
  });

  test('local relayout scheduling during composition preserves PM overlay and canonical revision', async () => {
    const { session, store, p1 } = editableSession('hello');
    const parent = document.createElement('div');
    document.body.append(parent);
    const { surface, helpers } = mountWithComposition(session, parent);
    surface.syncSemanticSelection({ frameId: { value: 1 }, selection: collapsedSelection(session, p1, 5) });
    surface.focus({ frameId: { value: 1 } });
    const revBefore = store.currentRevision;

    helpers.beginComposition();
    helpers.pushCompositionUpdate('!!!');
    surface.updateInputHostPlacement({
      frameId: { value: 1 },
      activeFrameId: { value: 1 },
      caretClientRect: { x: 12, y: 12, width: 2, height: 18 },
      pendingLayout: true,
    });
    surface.updateInputHostPlacement({
      frameId: { value: 1 },
      activeFrameId: { value: 1 },
      caretClientRect: { x: 200, y: 120, width: 2, height: 18 },
    });

    expect(store.currentRevision).toBe(revBefore);
    expect(surface.getCompositionObservation().active).toBe(true);
    expect(helpers.readPmParagraph(p1)).toBe('hello!!!');

    await helpers.endComposition('!!!');
    expect(paragraphText(store.currentModel, p1)).toBe('hello!!!');
    expect(store.currentRevision).toBe(revBefore + 1);
    surface.destroy();
    parent.remove();
  });

  test('multiple prefix-only remote revisions merge then commit composed suffix', async () => {
    const { session, store, p1 } = editableSession('start');
    const parent = document.createElement('div');
    document.body.append(parent);
    let commits = 0;
    const { surface, helpers } = mountWithComposition(session, parent, () => (commits += 1));
    surface.syncSemanticSelection({ frameId: { value: 1 }, selection: collapsedSelection(session, p1, 5) });
    surface.focus({ frameId: { value: 1 } });

    await helpers.compose({
      updates: ['!', '!?'],
      during: () => {
        store.transact(HUMAN, (c) => c.apply({ op: 'setParagraphRuns', paragraphId: p1, runs: [{ text: 'Xstart' }] }));
        store.transact(HUMAN, (c) => c.apply({ op: 'setParagraphRuns', paragraphId: p1, runs: [{ text: 'YXstart' }] }));
      },
      final: '!?',
    });

    // Remote revisions during composition defer notification; flush emits one commit + one deferred reconcile.
    expect(commits).toBe(2);
    expect(paragraphText(store.currentModel, p1)).toBe('YXstart!?');
    expect(surface.getCompositionObservation().lastCancel).toBeNull();
    surface.destroy();
    parent.remove();
  });

  test('intersecting remote replacement cancels with observed remoteInvalidation and preserves remote text', async () => {
    const { session, store, p1 } = editableSession('compose');
    const parent = document.createElement('div');
    document.body.append(parent);
    const { surface, helpers } = mountWithComposition(session, parent);
    surface.syncSemanticSelection({ frameId: { value: 1 }, selection: collapsedSelection(session, p1, 3) });
    surface.focus({ frameId: { value: 1 } });
    const revBefore = store.currentRevision;

    await helpers.compose({
      updates: ['ing', 'ingX'],
      during: () => {
        store.transact(HUMAN, (c) => c.apply({ op: 'setParagraphRuns', paragraphId: p1, runs: [{ text: 'Xcompose' }] }));
        store.transact(HUMAN, (c) => c.apply({ op: 'setParagraphRuns', paragraphId: p1, runs: [{ text: 'remote' }] }));
      },
      final: 'ingX',
    });

    expect(store.currentRevision).toBe(revBefore + 2);
    expect(paragraphText(store.currentModel, p1)).toBe('remote');
    expect(surface.getCompositionObservation().lastCancel).toEqual({
      code: 'remoteInvalidation',
      reason: 'remote canonical change intersected the composition anchor',
    });
    surface.destroy();
    parent.remove();
  });

  test('remote append into anchored suffix region invalidates composition', async () => {
    const { session, store, p1 } = editableSession('start');
    const parent = document.createElement('div');
    document.body.append(parent);
    const { surface, helpers } = mountWithComposition(session, parent);
    surface.syncSemanticSelection({ frameId: { value: 1 }, selection: collapsedSelection(session, p1, 2) });
    surface.focus({ frameId: { value: 1 } });
    const revBefore = store.currentRevision;

    await helpers.compose({
      updates: ['XX'],
      during: () => {
        store.transact(HUMAN, (c) => c.apply({ op: 'setParagraphRuns', paragraphId: p1, runs: [{ text: 'start!' }] }));
      },
      final: 'XX',
    });

    expect(store.currentRevision).toBe(revBefore + 1);
    expect(paragraphText(store.currentModel, p1)).toBe('start!');
    expect(surface.getCompositionObservation().lastCancel?.code).toBe('remoteInvalidation');
    surface.destroy();
    parent.remove();
  });

  test('capability-boundary composition is rejected with observed capabilityBoundary outcome', async () => {
    const { session, store, pBefore } = mixedDocSession();
    const parent = document.createElement('div');
    document.body.append(parent);
    const { surface, helpers } = mountWithComposition(session, parent);
    surface.syncSemanticSelection({ frameId: { value: 1 }, selection: collapsedSelection(session, pBefore, 5) });
    surface.focus({ frameId: { value: 1 } });
    const revBefore = store.currentRevision;

    await helpers.compose({
      updates: ['!'],
      during: () => helpers.stripBlockEmbed('tbl-1'),
      final: '!',
    });

    expect(store.currentRevision).toBe(revBefore);
    expect(surface.getCompositionObservation().lastCancel?.code).toBe('capabilityBoundary');
    surface.destroy();
    parent.remove();
  });

  test('destroy during active composition does not commit or notify late', async () => {
    const { session, store, p1 } = editableSession('keep');
    const parent = document.createElement('div');
    document.body.append(parent);
    let commits = 0;
    const { surface, helpers } = mountWithComposition(session, parent, () => (commits += 1));
    surface.syncSemanticSelection({ frameId: { value: 1 }, selection: collapsedSelection(session, p1, 4) });
    surface.focus({ frameId: { value: 1 } });
    const revBefore = store.currentRevision;

    helpers.beginComposition();
    helpers.pushCompositionUpdate('lost');
    expect(surface.getCompositionObservation().active).toBe(true);
    surface.destroy();
    await flushCompositionFrames();

    expect(store.currentRevision).toBe(revBefore);
    expect(paragraphText(store.currentModel, p1)).toBe('keep');
    expect(commits).toBe(0);
    parent.remove();
  });

  test('undo groups the committed composition as one history step', async () => {
    const { session, store, p1 } = editableSession('ab');
    const parent = document.createElement('div');
    document.body.append(parent);
    const { surface, helpers } = mountWithComposition(session, parent);
    surface.syncSemanticSelection({ frameId: { value: 1 }, selection: collapsedSelection(session, p1, 2) });
    surface.focus({ frameId: { value: 1 } });

    await helpers.compose({ updates: ['c', 'cd', 'cde'], final: 'cde' });
    expect(paragraphText(store.currentModel, p1)).toBe('abcde');
    dispatchModKey(pmDom(parent), 'z');
    expect(paragraphText(store.currentModel, p1)).toBe('ab');
    surface.destroy();
    parent.remove();
  });
});
