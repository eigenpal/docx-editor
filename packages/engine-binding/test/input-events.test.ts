// Native beforeinput, clipboard, drag/drop, keyboard, and focus-transfer integration (interactive-paginated 4.5).

import './dom-setup.ts';

import { describe, expect, test } from 'bun:test';
import {
  mountEditSurface,
  EditorBinding,
  type EditSurface,
  INPUT_POLICY_LIMITS,
} from '../src/index.ts';
import { resolveSelection } from '../src/selection.ts';
import {
  DocumentStore,
  createEmptyModel,
  bodyStoryId,
  parseDocx,
  ORIGIN_IDS,
  paragraphText,
  type ParagraphRecord,
} from '@docx-editor.dev/engine-core';
import type { SemanticSelection } from '@docx-editor.dev/core-contract/interaction';
import { zipSync, strToU8 } from 'fflate';
import { flushCompositionFrames } from './composition-dom.ts';
import {
  authorizeFocus,
  dispatchBeforeInput,
  dispatchCut,
  dispatchCopy,
  dispatchInternalDrag,
  dispatchKey,
  dispatchModKey,
  dispatchPaste,
  patchDragEvent,
  pmDom,
  dispatchHistoryUndo,
} from './input-dom-helpers.ts';

const HUMAN = ORIGIN_IDS.mutationHuman;
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

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

function mountInputSurface(
  session: ReturnType<typeof editableSession>['session'],
  parent: HTMLElement,
  onModelChanged?: () => void,
): EditSurface {
  return mountEditSurface(parent, session, { onModelChanged });
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
    bodyBlockIds: () => blocks.map((b) => b.id),
    currentModel: () => store.currentModel,
    revision: () => store.currentRevision,
    undo: () => (store.canUndo() ? store.undo().ok : false),
    redo: () => (store.canRedo() ? store.redoLast().ok : false),
    subscribe: (fn: () => void) => store.subscribe(fn),
  };
  return { session, store, binding, pBefore, blocks };
}

describe('beforeinput through hidden ProseMirror host', () => {
  test('insertText commits canonical text exactly once via store path', () => {
    const { session, store, binding, p1 } = editableSession('ab');
    const parent = document.createElement('div');
    document.body.append(parent);
    let commits = 0;
    const surface = mountInputSurface(session, parent, () => (commits += 1));
    authorizeFocus(surface, collapsedSelection(session, p1, 2));
    const dom = pmDom(parent);
    const revBefore = store.currentRevision;
    dispatchBeforeInput(dom, 'insertText', 'X');
    expect(store.currentRevision).toBe(revBefore + 1);
    expect(commits).toBe(1);
    expect(paragraphText(store.currentModel, p1)).toBe('abX');
    expect(surface.getPmSelection().from).toBe(pmFrom(binding, p1, 3));
    surface.destroy();
    parent.remove();
  });

  test('historyUndo and historyRedo work from beforeinput without keydown', () => {
    const { session, store, p1 } = editableSession('z');
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountInputSurface(session, parent);
    authorizeFocus(surface, collapsedSelection(session, p1, 1));
    const dom = pmDom(parent);
    dispatchBeforeInput(dom, 'insertText', '!');
    dispatchBeforeInput(dom, 'historyUndo');
    expect(paragraphText(store.currentModel, p1)).toBe('z');
    dispatchBeforeInput(dom, 'historyRedo');
    expect(paragraphText(store.currentModel, p1)).toBe('z!');
    surface.destroy();
    parent.remove();
  });

  test('unsupported beforeinput types reject without canonical mutation', () => {
    const { session, store, p1 } = editableSession('safe');
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountInputSurface(session, parent);
    authorizeFocus(surface, collapsedSelection(session, p1, 4));
    const revBefore = store.currentRevision;
    dispatchBeforeInput(pmDom(parent), 'insertFromYank');
    expect(store.currentRevision).toBe(revBefore);
    expect(surface.getInputObservation().lastRejection?.code).toBe('unsupportedInputType');
    surface.destroy();
    parent.remove();
  });

  test('deleteContentBackward commits once and undo restores via beforeinput only', () => {
    const { session, store, binding, p1 } = editableSession('abc');
    const parent = document.createElement('div');
    document.body.append(parent);
    let commits = 0;
    const surface = mountInputSurface(session, parent, () => (commits += 1));
    authorizeFocus(surface, collapsedSelection(session, p1, 2));
    const dom = pmDom(parent);
    const revBefore = store.currentRevision;
    dispatchBeforeInput(dom, 'deleteContentBackward');
    expect(store.currentRevision).toBe(revBefore + 1);
    expect(commits).toBe(1);
    expect(paragraphText(store.currentModel, p1)).toBe('ac');
    expect(surface.getPmSelection().from).toBe(pmFrom(binding, p1, 1));
    dispatchHistoryUndo(dom);
    expect(paragraphText(store.currentModel, p1)).toBe('abc');
    expect(store.currentRevision).toBe(revBefore + 2);
    surface.destroy();
    parent.remove();
  });

  test('deleteContentForward commits once and undo restores via beforeinput only', () => {
    const { session, store, binding, p1 } = editableSession('abc');
    const parent = document.createElement('div');
    document.body.append(parent);
    let commits = 0;
    const surface = mountInputSurface(session, parent, () => (commits += 1));
    authorizeFocus(surface, collapsedSelection(session, p1, 1));
    const dom = pmDom(parent);
    const revBefore = store.currentRevision;
    dispatchBeforeInput(dom, 'deleteContentForward');
    expect(store.currentRevision).toBe(revBefore + 1);
    expect(commits).toBe(1);
    expect(paragraphText(store.currentModel, p1)).toBe('ac');
    expect(surface.getPmSelection().from).toBe(pmFrom(binding, p1, 1));
    dispatchHistoryUndo(dom);
    expect(paragraphText(store.currentModel, p1)).toBe('abc');
    surface.destroy();
    parent.remove();
  });

  test('insertParagraph splits canonical body once with beforeinput only', () => {
    const { session, store, binding, p1 } = editableSession('abc');
    const parent = document.createElement('div');
    document.body.append(parent);
    let commits = 0;
    const surface = mountInputSurface(session, parent, () => (commits += 1));
    authorizeFocus(surface, collapsedSelection(session, p1, 3));
    const dom = pmDom(parent);
    const revBefore = store.currentRevision;
    const blocksBefore = store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks.length;
    dispatchBeforeInput(dom, 'insertParagraph');
    expect(store.currentRevision).toBe(revBefore + 1);
    expect(commits).toBe(1);
    const blocks = store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks;
    expect(blocks.length).toBe(blocksBefore + 1);
    expect(paragraphText(store.currentModel, p1)).toBe('abc');
    const p2 = blocks[1]!.id;
    expect(paragraphText(store.currentModel, p2)).toBe('');
    dispatchHistoryUndo(dom);
    expect(store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks.length).toBe(blocksBefore);
    expect(paragraphText(store.currentModel, p1)).toBe('abc');
    expect(surface.getPmSelection().from).toBe(pmFrom(binding, p1, 3));
    surface.destroy();
    parent.remove();
  });
});

describe('clipboard through hidden ProseMirror host', () => {
  test('paste plain Unicode text commits once with store-first validation', () => {
    const { session, store, p1 } = editableSession('a');
    const parent = document.createElement('div');
    document.body.append(parent);
    let commits = 0;
    const surface = mountInputSurface(session, parent, () => (commits += 1));
    authorizeFocus(surface, collapsedSelection(session, p1, 1));
    const revBefore = store.currentRevision;
    dispatchPaste(pmDom(parent), ' café 😀');
    expect(store.currentRevision).toBe(revBefore + 1);
    expect(commits).toBe(1);
    expect(paragraphText(store.currentModel, p1)).toBe('a café 😀');
    surface.destroy();
    parent.remove();
  });

  test('rejects hostile obfuscated HTML before canonical mutation', () => {
    const { session, store, p1 } = editableSession('ok');
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountInputSurface(session, parent);
    authorizeFocus(surface, collapsedSelection(session, p1, 2));
    const revBefore = store.currentRevision;
    const blocksBefore = store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks.length;
    dispatchPaste(
      pmDom(parent),
      'fallback',
      '<a href="&#106;&#97;&#118;&#97;script:alert(1)">x</a><img src="https://x.test/y.png">',
    );
    expect(store.currentRevision).toBe(revBefore);
    expect(paragraphText(store.currentModel, p1)).toBe('ok');
    expect(store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks.length).toBe(blocksBefore);
    expect(surface.getInputObservation().lastRejection?.code).toBe('unsafeResource');
    surface.destroy();
    parent.remove();
  });

  test('rejected HTML paste cannot add an empty paragraph', () => {
    const { session, store, p1 } = editableSession('solo');
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountInputSurface(session, parent);
    authorizeFocus(surface, collapsedSelection(session, p1, 4));
    dispatchPaste(pmDom(parent), 'x', '<p></p><script>x</script>');
    expect(paragraphText(store.currentModel, p1)).toBe('solo');
    expect(store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks.length).toBe(1);
    surface.destroy();
    parent.remove();
  });

  test('cut removes selected text and groups undo as one step', () => {
    const { session, store, p1 } = editableSession('hello');
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountInputSurface(session, parent);
    authorizeFocus(surface, rangeSelection(session, p1, 1, 4));
    dispatchCut(pmDom(parent));
    expect(paragraphText(store.currentModel, p1)).toBe('ho');
    dispatchHistoryUndo(pmDom(parent));
    expect(paragraphText(store.currentModel, p1)).toBe('hello');
    surface.destroy();
    parent.remove();
  });

  test('copy selected Unicode text does not mutate canonical store or callbacks', () => {
    const selected = ' café 😀';
    const { session, store, p1 } = editableSession(`a${selected}z`);
    const parent = document.createElement('div');
    document.body.append(parent);
    let commits = 0;
    const surface = mountInputSurface(session, parent, () => (commits += 1));
    const selectedGraphemes = [...selected].length;
    authorizeFocus(surface, rangeSelection(session, p1, 1, 1 + selectedGraphemes));
    const dom = pmDom(parent);
    const revBefore = store.currentRevision;
    const blocksBefore = store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks.length;
    const event = dispatchCopy(dom);
    expect(store.currentRevision).toBe(revBefore);
    expect(commits).toBe(0);
    expect(paragraphText(store.currentModel, p1)).toBe(`a${selected}z`);
    expect(store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks.length).toBe(blocksBefore);
    expect(event.defaultPrevented).toBe(true);
    expect(event.clipboardData?.getData('text/plain')).toBe(selected);
    surface.destroy();
    parent.remove();
  });

  test('rejects HTML with inline event handlers before canonical mutation', () => {
    const { session, store, p1 } = editableSession('ok');
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountInputSurface(session, parent);
    authorizeFocus(surface, collapsedSelection(session, p1, 2));
    const revBefore = store.currentRevision;
    dispatchPaste(pmDom(parent), 'fallback', '<p onclick="alert(1)">x</p>');
    expect(store.currentRevision).toBe(revBefore);
    expect(paragraphText(store.currentModel, p1)).toBe('ok');
    expect(surface.getInputObservation().lastRejection?.code).toBe('unsafeResource');
    surface.destroy();
    parent.remove();
  });

  test('rejects HTML with foreign-namespace markup before canonical mutation', () => {
    const { session, store, p1 } = editableSession('ok');
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountInputSurface(session, parent);
    authorizeFocus(surface, collapsedSelection(session, p1, 2));
    const revBefore = store.currentRevision;
    dispatchPaste(pmDom(parent), 'fallback', '<svg><text>evil</text></svg>');
    expect(store.currentRevision).toBe(revBefore);
    expect(paragraphText(store.currentModel, p1)).toBe('ok');
    expect(surface.getInputObservation().lastRejection?.code).toBe('unsafeResource');
    surface.destroy();
    parent.remove();
  });
});

describe('internal ProseMirror drag/drop', () => {
  test('move selected text through PM dragstart/drop updates canonical text once', () => {
    const { session, store, binding, p1 } = editableSession('hello world');
    const parent = document.createElement('div');
    document.body.append(parent);
    let commits = 0;
    const surface = mountInputSurface(session, parent, () => (commits += 1));
    authorizeFocus(surface, rangeSelection(session, p1, 0, 5));
    const dom = pmDom(parent);
    const revBefore = store.currentRevision;
    dispatchInternalDrag(dom, { fromX: 10, toX: 84, copy: false });
    expect(store.currentRevision).toBe(revBefore + 1);
    expect(commits).toBe(1);
    expect(paragraphText(store.currentModel, p1)).toBe(' worldhello');
    dispatchHistoryUndo(dom);
    expect(paragraphText(store.currentModel, p1)).toBe('hello world');
    expect(surface.getPmSelection().from).toBe(pmFrom(binding, p1, 0));
    surface.destroy();
    parent.remove();
  });

  test('copy selected text with ctrl preserves source and inserts copy', () => {
    const { session, store, p1 } = editableSession('hello world');
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountInputSurface(session, parent);
    authorizeFocus(surface, rangeSelection(session, p1, 0, 5));
    const dom = pmDom(parent);
    const revBefore = store.currentRevision;
    dispatchInternalDrag(dom, { fromX: 10, toX: 84, copy: true });
    expect(store.currentRevision).toBe(revBefore + 1);
    expect(paragraphText(store.currentModel, p1)).toBe('hello worldhello');
    surface.destroy();
    parent.remove();
  });

  test('rejects file drop without partial mutation', () => {
    const { session, store, p1 } = editableSession('hold');
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountInputSurface(session, parent);
    authorizeFocus(surface, collapsedSelection(session, p1, 4));
    const revBefore = store.currentRevision;
    const dom = pmDom(parent);
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'drop.bin', { type: 'application/octet-stream' }));
    dom.dispatchEvent(patchDragEvent(new DragEvent('dragover', { bubbles: true, cancelable: true }), 100, 12, dt));
    dom.dispatchEvent(patchDragEvent(new DragEvent('drop', { bubbles: true, cancelable: true }), 100, 12, dt));
    expect(store.currentRevision).toBe(revBefore);
    expect(paragraphText(store.currentModel, p1)).toBe('hold');
    expect(surface.getInputObservation().lastRejection?.code).toBe('filePayload');
    surface.destroy();
    parent.remove();
  });
});

describe('keyboard commands through focused PM host', () => {
  test('Mod-z undo and Mod-Shift-z redo preserve selection semantics', () => {
    const { session, store, binding, p1 } = editableSession('one');
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountInputSurface(session, parent);
    authorizeFocus(surface, collapsedSelection(session, p1, 3));
    const dom = pmDom(parent);
    dispatchBeforeInput(dom, 'insertText', '!');
    dispatchModKey(dom, 'z');
    expect(paragraphText(store.currentModel, p1)).toBe('one');
    expect(surface.getPmSelection().from).toBe(pmFrom(binding, p1, 3));
    dispatchModKey(dom, 'z', true);
    expect(paragraphText(store.currentModel, p1)).toBe('one!');
    surface.destroy();
    parent.remove();
  });

  test('ArrowLeft/ArrowRight skip surrogate halves in provisional keymap navigation', () => {
    const { session, store, p1 } = editableSession('a😀b');
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountInputSurface(session, parent);
    authorizeFocus(surface, collapsedSelection(session, p1, 1));
    const dom = pmDom(parent);
    const revBefore = store.currentRevision;
    dispatchKey(dom, 'ArrowRight');
    expect(surface.getPmSelection().from).toBe(4);
    dispatchKey(dom, 'ArrowRight');
    expect(surface.getPmSelection().from).toBe(5);
    dispatchKey(dom, 'ArrowLeft');
    expect(surface.getPmSelection().from).toBe(4);
    expect(store.currentRevision).toBe(revBefore);
    surface.destroy();
    parent.remove();
  });

  test('ArrowLeft/ArrowRight and Home/End move PM selection without canonical mutation', () => {
    const { session, store, binding, p1 } = editableSession('abcde');
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountInputSurface(session, parent);
    authorizeFocus(surface, collapsedSelection(session, p1, 2));
    const dom = pmDom(parent);
    const revBefore = store.currentRevision;
    dispatchKey(dom, 'ArrowRight');
    expect(surface.getPmSelection().from).toBe(pmFrom(binding, p1, 3));
    dispatchKey(dom, 'ArrowLeft');
    expect(surface.getPmSelection().from).toBe(pmFrom(binding, p1, 2));
    dispatchKey(dom, 'Home');
    expect(surface.getPmSelection().from).toBe(pmFrom(binding, p1, 0));
    dispatchKey(dom, 'End');
    expect(surface.getPmSelection().from).toBe(pmFrom(binding, p1, 5));
    expect(store.currentRevision).toBe(revBefore);
    surface.destroy();
    parent.remove();
  });
});

describe('focus transfer and input authorization', () => {
  test('focus with sync authorizes beforeinput at exact canonical position', () => {
    const { session, store, binding, p1 } = editableSession('abc');
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountInputSurface(session, parent);
    const storyId = bodyStoryId(store.currentModel);
    const outcome = surface.focus({
      sync: {
        frameId: { value: 1 },
        selection: {
          frameId: { value: 1 },
          scope: { kind: 'body' },
          anchor: textTarget(storyId, p1, 2),
          head: textTarget(storyId, p1, 2),
        },
      },
    });
    expect(outcome.ok).toBe(true);
    expect(surface.getPmSelection().from).toBe(pmFrom(binding, p1, 2));
    dispatchBeforeInput(pmDom(parent), 'insertText', '!');
    expect(paragraphText(store.currentModel, p1)).toBe('ab!c');
    surface.destroy();
    parent.remove();
  });

  test('frameId-only focus without prior semantic sync does not authorize input', () => {
    const { session, store, p1 } = editableSession('x');
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountInputSurface(session, parent);
    const outcome = surface.focus({ frameId: { value: 1 } });
    expect(outcome.ok).toBe(true);
    const revBefore = store.currentRevision;
    dispatchBeforeInput(pmDom(parent), 'insertText', 'Z');
    expect(paragraphText(store.currentModel, p1)).toBe('x');
    expect(store.currentRevision).toBe(revBefore);
    expect(surface.getInputObservation().lastRejection?.code).toBe('inputNotAuthorized');
    surface.destroy();
    parent.remove();
  });

  test('retained sync then focus authorizes input', () => {
    const { session, store, p1 } = editableSession('ab');
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountInputSurface(session, parent);
    surface.syncSemanticSelection({ frameId: { value: 1 }, selection: collapsedSelection(session, p1, 2) });
    expect(surface.focus({ frameId: { value: 1 } }).ok).toBe(true);
    dispatchBeforeInput(pmDom(parent), 'insertText', '!');
    expect(paragraphText(store.currentModel, p1)).toBe('ab!');
    surface.destroy();
    parent.remove();
  });

  test('stale frame focus then beforeinput rejects without mutation', () => {
    const { session, store, p1 } = editableSession('keep');
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountInputSurface(session, parent);
    surface.syncSemanticSelection({ frameId: { value: 1 }, selection: collapsedSelection(session, p1, 2) });
    const outcome = surface.focus({ frameId: { value: 2 } });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected stale frame');
    expect(outcome.code).toBe('staleFrame');
    const revBefore = store.currentRevision;
    dispatchBeforeInput(pmDom(parent), 'insertText', 'Z');
    expect(paragraphText(store.currentModel, p1)).toBe('keep');
    expect(surface.getInputObservation().lastRejection?.code).toBe('inputNotAuthorized');
    expect(store.currentRevision).toBe(revBefore);
    surface.destroy();
    parent.remove();
  });

  test('invalid focus without frame identity rejects subsequent input', () => {
    const { session, store, p1 } = editableSession('x');
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountInputSurface(session, parent);
    surface.syncSemanticSelection({ frameId: { value: 1 }, selection: collapsedSelection(session, p1, 1) });
    const outcome = surface.focus();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe('invalidTarget');
    dispatchBeforeInput(pmDom(parent), 'insertText', 'Z');
    expect(surface.getInputObservation().lastRejection?.code).toBe('inputNotAuthorized');
    expect(paragraphText(store.currentModel, p1)).toBe('x');
    surface.destroy();
    parent.remove();
  });

  test('read-only session rejects focus and paste', () => {
    const model = createEmptyModel();
    const store = new DocumentStore(model);
    const p1 = (model.stories.get(bodyStoryId(model))!.blocks[0] as ParagraphRecord).id;
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p1, text: 'ro' }));
    const binding = new EditorBinding(store);
    const session = {
      editable: false,
      readOnlyReason: 'test',
      projectDoc: () => binding.projectDoc(),
      applyPmDoc: () => ({ committed: false, rejected: true, opCount: 0 }),
      bodyBlockIds: () => [],
      currentModel: () => store.currentModel,
      revision: () => store.currentRevision,
      undo: () => false,
      redo: () => false,
      subscribe: () => () => {},
    };
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountInputSurface(session, parent);
    const outcome = surface.focus({ frameId: { value: 1 } });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe('readOnly');
    surface.destroy();
    parent.remove();
  });

  test('pending layout rejects focus sync and subsequent beforeinput', () => {
    const { session, store, p1 } = editableSession('wait');
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountInputSurface(session, parent);
    authorizeFocus(surface, collapsedSelection(session, p1, 4));
    surface.updateInputHostPlacement({
      frameId: { value: 1 },
      activeFrameId: { value: 1 },
      caretClientRect: { x: 8, y: 8, width: 2, height: 18 },
      pendingLayout: true,
    });
    const storyId = bodyStoryId(store.currentModel);
    const pendingFocus = surface.focus({
      sync: {
        frameId: { value: 1 },
        selection: {
          frameId: { value: 1 },
          scope: { kind: 'body' },
          anchor: textTarget(storyId, p1, 2),
          head: textTarget(storyId, p1, 2),
        },
      },
    });
    expect(pendingFocus.ok).toBe(false);
    if (!pendingFocus.ok) expect(pendingFocus.code).toBe('pendingLayout');
    const revBefore = store.currentRevision;
    dispatchBeforeInput(pmDom(parent), 'insertText', 'X');
    expect(paragraphText(store.currentModel, p1)).toBe('wait');
    expect(store.currentRevision).toBe(revBefore);
    expect(surface.getInputObservation().lastRejection?.code).toBe('inputNotAuthorized');
    surface.updateInputHostPlacement({
      frameId: { value: 1 },
      activeFrameId: { value: 1 },
      caretClientRect: { x: 8, y: 8, width: 2, height: 18 },
    });
    authorizeFocus(surface, collapsedSelection(session, p1, 4));
    dispatchBeforeInput(pmDom(parent), 'insertText', '!');
    expect(paragraphText(store.currentModel, p1)).toBe('wait!');
    surface.destroy();
    parent.remove();
  });

  test('blur and destroy clear authorization and reject late input', () => {
    const { session, store, p1 } = editableSession('late');
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountInputSurface(session, parent);
    authorizeFocus(surface, collapsedSelection(session, p1, 4));
    const dom = pmDom(parent);
    surface.blur();
    const revBefore = store.currentRevision;
    dispatchBeforeInput(dom, 'insertText', 'X');
    expect(paragraphText(store.currentModel, p1)).toBe('late');
    expect(surface.getInputObservation().lastRejection?.code).toBe('inputNotAuthorized');
    surface.destroy();
    dispatchBeforeInput(dom, 'insertText', 'Y');
    expect(store.currentRevision).toBe(revBefore);
    parent.remove();
  });
});

describe('read-only capability boundary paste/drop on editable surface', () => {
  test('paste near table embed is rejected without canonical mutation', () => {
    const { session, store, pBefore } = mixedDocSession();
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountInputSurface(session, parent);
    authorizeFocus(surface, collapsedSelection(session, pBefore, 6));
    const revBefore = store.currentRevision;
    dispatchPaste(pmDom(parent), 'x', '<div class="docx-block-embed" data-sem-id="tbl">[table]</div>');
    expect(store.currentRevision).toBe(revBefore);
    expect(surface.getInputObservation().lastRejection?.code).toBe('capabilityBoundary');
    surface.destroy();
    parent.remove();
  });

  test('drop with hostile HTML near mixed body is rejected', () => {
    const { session, store, pBefore } = mixedDocSession();
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountInputSurface(session, parent);
    authorizeFocus(surface, collapsedSelection(session, pBefore, 6));
    const revBefore = store.currentRevision;
    const dom = pmDom(parent);
    const dt = new DataTransfer();
    dt.setData('text/html', '<img src="https://evil.test/x.png">');
    dom.dispatchEvent(patchDragEvent(new DragEvent('drop', { bubbles: true, cancelable: true }), 100, 12, dt));
    expect(store.currentRevision).toBe(revBefore);
    expect(paragraphText(store.currentModel, pBefore)).toBe('before');
    expect(surface.getInputObservation().lastRejection?.code).toBe('unsafeResource');
    surface.destroy();
    parent.remove();
  });
});

describe('composition-owned beforeinput deferral', () => {
  test('insertCompositionText does not commit before compositionend', async () => {
    const { session, store, p1 } = editableSession('hi');
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountInputSurface(session, parent);
    authorizeFocus(surface, collapsedSelection(session, p1, 2));
    const dom = pmDom(parent);
    const revBefore = store.currentRevision;
    dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
    dispatchBeforeInput(dom, 'insertCompositionText', 'X');
    expect(store.currentRevision).toBe(revBefore);
    dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }));
    await flushCompositionFrames();
    surface.destroy();
    parent.remove();
  });
});

describe('oversized paste rejection', () => {
  test('rejects oversized plain paste without partial mutation', () => {
    const { session, store, p1 } = editableSession('x');
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountInputSurface(session, parent);
    authorizeFocus(surface, collapsedSelection(session, p1, 1));
    const revBefore = store.currentRevision;
    dispatchPaste(pmDom(parent), 'z'.repeat(INPUT_POLICY_LIMITS.maxPlainTextChars + 1));
    expect(store.currentRevision).toBe(revBefore);
    expect(surface.getInputObservation().lastRejection?.code).toBe('oversizedPayload');
    surface.destroy();
    parent.remove();
  });
});
