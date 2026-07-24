// Accessibility projection conformance (interactive-paginated-editing 4.6).

import './dom-setup.ts';

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  mountEditSurface,
  openDocxSession,
  EditorBinding,
} from '../src/index.ts';
import {
  applyAccessibleNamePolicy,
  applyAtomAccessibilityLabels,
  markPaintedPagesPresentationOnly,
  clearPaintedPagesPresentationOnly,
  freezeAccessibilityObservation,
  PAINTED_PAGES_ASSISTIVE_MARKER,
  ATOM_EMBED_SELECTOR,
} from '../src/accessibility-projection.ts';
import { authorizeFocus, dispatchBeforeInput, pmDom } from './input-dom-helpers.ts';
import {
  DocumentStore,
  createEmptyModel,
  bodyStoryId,
  writeDocx,
  parseDocx,
  ORIGIN_IDS,
  type ParagraphRecord,
} from '@docx-editor.dev/engine-core';
import type { SemanticSelection } from '@docx-editor.dev/core-contract/interaction';

const HUMAN = ORIGIN_IDS.mutationHuman;
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function docx(bodyInner: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    'word/document.xml': strToU8(`<w:document xmlns:w="${W}"><w:body>${bodyInner}</w:body></w:document>`),
  });
}

const MIXED =
  '<w:p><w:r><w:t>before</w:t></w:r></w:p>' +
  '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
  '<w:p><w:r><w:t>after</w:t></w:r></w:p>';

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

function openMixedReadOnlySession() {
  const parsed = parseDocx(docx(MIXED));
  if (!parsed.ok) throw new Error('parse failed');
  return openDocxSession(writeDocx(parsed.model));
}

function collapsedSelection(session: ReturnType<typeof openDocxSession>, p1: string, graphemeOffset: number, frame = 1): SemanticSelection {
  const storyId = bodyStoryId(session.currentModel());
  const target = {
    kind: 'text' as const,
    scope: { kind: 'body' as const },
    identity: { storyId, blockId: p1 },
    graphemeOffset,
    affinity: 'upstream' as const,
  };
  return { frameId: { value: frame }, scope: { kind: 'body' }, anchor: target, head: target };
}

function rangeSelection(session: ReturnType<typeof openDocxSession>, p1: string, from: number, to: number, frame = 1): SemanticSelection {
  const storyId = bodyStoryId(session.currentModel());
  const anchor = {
    kind: 'text' as const,
    scope: { kind: 'body' as const },
    identity: { storyId, blockId: p1 },
    graphemeOffset: from,
    affinity: 'upstream' as const,
  };
  const head = { ...anchor, graphemeOffset: to, affinity: 'downstream' as const };
  return { frameId: { value: frame }, scope: { kind: 'body' }, anchor, head };
}

function assertDomMatchesObservation(
  parent: HTMLElement,
  obs: ReturnType<ReturnType<typeof mountEditSurface>['getAccessibilityObservation']>,
  labels?: Record<string, string>,
) {
  const mount = parent.querySelector('[data-docx-input-host-mount]') as HTMLElement;
  expect(mount).not.toBeNull();
  if (obs.editable) expect(mount.contentEditable).not.toBe('false');
  else expect(obs.editable).toBe(false);
  if (obs.name.kind === 'provided') expect(mount.getAttribute('aria-label')).toBe(obs.name.value);
  else expect(mount.hasAttribute('aria-label')).toBe(false);
  expect(mount.hasAttribute('role')).toBe(false);
  expect(mount.hasAttribute('aria-multiline')).toBe(false);

  const paragraphs = mount.querySelectorAll('p[data-sem-id]');
  const textEntries = obs.entries.filter((e) => e.role === 'editableParagraph');
  expect(paragraphs.length).toBe(textEntries.length);
  textEntries.forEach((entry, i) => {
    const p = paragraphs[i] as HTMLElement;
    expect(p.getAttribute('data-sem-id')).toBe(entry.identity.blockId);
    expect(p.textContent).toBe(entry.text);
  });

  const atoms = mount.querySelectorAll(ATOM_EMBED_SELECTOR);
  const atomEntries = obs.entries.filter((e) => e.role === 'readOnlyAtom');
  expect(atoms.length).toBe(atomEntries.length);
  atoms.forEach((node, i) => {
    const el = node as HTMLElement;
    const entry = atomEntries[i]!;
    expect(el.getAttribute('data-sem-id')).toBe(entry.identity.blockId);
    expect(el.getAttribute('data-kind')).toBe(entry.atomKind);
    expect(el.getAttribute('aria-readonly')).toBe('true');
    expect(el.textContent).toBe('');
    const label = entry.atomKind ? labels?.[entry.atomKind] : undefined;
    if (label) expect(el.getAttribute('aria-label')).toBe(label);
    else expect(el.hasAttribute('aria-label')).toBe(false);
  });
}

type EditSurface = ReturnType<typeof mountEditSurface>;

describe('observeAccessibility', () => {
  test('projects canonical body reading order with stable identities and empty paragraphs', () => {
    const { session, p1 } = editableSession('');
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountEditSurface(parent, session);
    const obs = surface.getAccessibilityObservation({ frameId: { value: 1 }, scope: { kind: 'body' } });
    expect(obs.owner).toBe('proseMirrorInputHost');
    expect(obs.paintedPagesAssistiveRole).toBe('presentation');
    expect(obs.entries).toHaveLength(1);
    expect(obs.entries[0]!.identity.blockId).toBe(p1);
    expect(obs.entries[0]!.text).toBe('');
    assertDomMatchesObservation(parent, obs);
    surface.destroy();
    parent.remove();
  });

  test('preserves Unicode paragraph text in observation entries and DOM', () => {
    const text = 'caf\u00e9 \uD83D\uDE00 combining\u0301';
    const { session, p1 } = editableSession(text);
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountEditSurface(parent, session);
    const obs = surface.getAccessibilityObservation({ frameId: { value: 1 }, scope: { kind: 'body' } });
    expect(obs.entries[0]!.text).toBe(text);
    assertDomMatchesObservation(parent, obs);
    surface.destroy();
    parent.remove();
  });

  test('includes read-only atoms without hardcoded atom text', () => {
    const session = openMixedReadOnlySession();
    const tableId = session.currentModel().stories.get(bodyStoryId(session.currentModel()))!.blocks[1]!.id;
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountEditSurface(parent, session, { readOnlyProjection: true });
    const obs = surface.getAccessibilityObservation({ frameId: { value: 1 }, scope: { kind: 'body' } });
    expect(obs.entries.map((e) => e.role)).toEqual(['editableParagraph', 'readOnlyAtom', 'editableParagraph']);
    expect(obs.entries[1]!.atomKind).toBe('table');
    expect(surface.semanticProjectionAttached).toBe(true);
    expect(surface.interactionAuthorized).toBe(false);
    assertDomMatchesObservation(parent, obs);
    const atom = parent.querySelector(ATOM_EMBED_SELECTOR) as HTMLElement;
    expect(atom.textContent).toBe('');
    expect(atom.getAttribute('data-sem-id')).toBe(tableId);
    surface.destroy();
    parent.remove();
  });

  test('applies localized atom labels only when supplied', () => {
    const session = openMixedReadOnlySession();
    const labels = { table: 'Tabla localizada', unknown: 'Estructura desconocida' };
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountEditSurface(parent, session, { accessibilityAtomLabels: labels, readOnlyProjection: true });
    const atom = parent.querySelector(ATOM_EMBED_SELECTOR) as HTMLElement;
    expect(atom.getAttribute('aria-label')).toBe('Tabla localizada');
    surface.destroy();
    const unnamed = mountEditSurface(parent, session, { readOnlyProjection: true });
    const atom2 = parent.querySelector(ATOM_EMBED_SELECTOR) as HTMLElement;
    expect(atom2.hasAttribute('aria-label')).toBe(false);
    unnamed.destroy();
    parent.remove();
  });

  test('maps semantic selection, focus, and non-collapsed range', () => {
    const { session, p1 } = editableSession('hello');
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountEditSurface(parent, session);
    authorizeFocus(surface, collapsedSelection(session, p1, 3));
    const focused = surface.getAccessibilityObservation({ frameId: { value: 1 }, scope: { kind: 'body' } });
    expect(focused.focus.focused).toBe(true);
    expect(focused.selection?.collapsed).toBe(true);

    surface.syncSemanticSelection({ frameId: { value: 1 }, selection: rangeSelection(session, p1, 1, 4) });
    const ranged = surface.getAccessibilityObservation({ frameId: { value: 1 }, scope: { kind: 'body' } });
    expect(ranged.selection?.collapsed).toBe(false);
    surface.blur();
    expect(surface.getAccessibilityObservation({ frameId: { value: 1 }, scope: { kind: 'body' } }).focus.focused).toBe(false);
    surface.destroy();
    parent.remove();
  });

  test('records provided vs absent accessible name policy without hardcoded English', () => {
    const mount = document.createElement('div');
    applyAccessibleNamePolicy(mount, { kind: 'provided', value: 'Nombre del documento' });
    expect(mount.getAttribute('aria-label')).toBe('Nombre del documento');
    applyAccessibleNamePolicy(mount, { kind: 'absent' });
    expect(mount.hasAttribute('aria-label')).toBe(false);

    const { session } = editableSession('x');
    const parent = document.createElement('div');
    document.body.append(parent);
    const named = mountEditSurface(parent, session, { accessibleName: 'Título localizado' });
    expect(named.getAccessibilityObservation({ frameId: { value: 1 }, scope: { kind: 'body' } }).name).toEqual({
      kind: 'provided',
      value: 'Título localizado',
    });
    named.destroy();
    parent.remove();
  });

  test('read-only projection mounts semantic host with editable false and rejects input', () => {
    const session = openMixedReadOnlySession();
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountEditSurface(parent, session, { readOnlyProjection: true });
    const obs = surface.getAccessibilityObservation({ frameId: { value: 1 }, scope: { kind: 'body' } });
    expect(obs.editable).toBe(false);
    expect(obs.owner).toBe('proseMirrorInputHost');
    const focus = surface.focus({ frameId: { value: 1 } });
    expect(focus.ok).toBe(true);
    expect(surface.interactionAuthorized).toBe(false);
    expect(obs.editable).toBe(false);
    surface.destroy();
    parent.remove();
  });

  test('deep-freezes observation and entries', () => {
    const { session } = editableSession('abc');
    const parent = document.createElement('div');
    document.body.append(parent);
    const surface = mountEditSurface(parent, session);
    const obs = surface.getAccessibilityObservation({ frameId: { value: 1 }, scope: { kind: 'body' } });
    expect(Object.isFrozen(obs)).toBe(true);
    expect(Object.isFrozen(obs.entries)).toBe(true);
    expect(Object.isFrozen(obs.entries[0]!)).toBe(true);
    expect(() => {
      (obs as { editable: boolean }).editable = false;
    }).toThrow();
    const again = freezeAccessibilityObservation({ ...obs, editable: !obs.editable });
    expect(again.editable).toBe(!obs.editable);
    surface.destroy();
    parent.remove();
  });
});

describe('observation lifecycle without store mutation', () => {
  test('updates on load, input commit, composition, external reconciliation, and blur', async () => {
    const { session, store, p1 } = editableSession('');
    let modelChanged = 0;
    const parent = document.createElement('div');
    document.body.append(parent);
    let helpers: {
      compose(o: { updates: readonly string[]; final?: string }): Promise<void>;
    } | undefined;
    const surface = mountEditSurface(parent, session, {
      onModelChanged: () => {
        modelChanged += 1;
      },
      testHooks: {
        onReady: (h) => {
          helpers = h;
        },
      },
    });
    const rev0 = session.revision();
    const obs0 = surface.getAccessibilityObservation({ frameId: { value: 1 }, scope: { kind: 'body' } });
    expect(obs0.modelRevision).toBe(rev0);

    authorizeFocus(surface, collapsedSelection(session, p1, 0));
    dispatchBeforeInput(pmDom(parent), 'insertText', 'hi');
    expect(modelChanged).toBe(1);
    const obs1 = surface.getAccessibilityObservation({ frameId: { value: 2 }, scope: { kind: 'body' } });
    expect(obs1.modelRevision).toBeGreaterThan(rev0);
    expect(obs1.entries[0]!.text).toBe('hi');

    await helpers!.compose({ updates: ['ñ'], final: 'ñ' });
    const obsCompose = surface.getAccessibilityObservation({ frameId: { value: 2 }, scope: { kind: 'body' } });
    expect(obsCompose.entries[0]!.text).toContain('ñ');

    const revBeforeRemote = session.revision();
    store.transact(HUMAN, (c) => c.apply({ op: 'setParagraphRuns', paragraphId: p1, runs: [{ text: 'REMOTE' }] }));
    expect(session.revision()).toBeGreaterThan(revBeforeRemote);
    const obsRemote = surface.getAccessibilityObservation({ frameId: { value: 2 }, scope: { kind: 'body' } });
    expect(obsRemote.entries[0]!.text).toBe('REMOTE');

    surface.blur();
    expect(surface.getAccessibilityObservation({ frameId: { value: 2 }, scope: { kind: 'body' } }).focus.focused).toBe(false);
    surface.destroy();
    parent.remove();
  });
});

describe('painted pages presentation ownership', () => {
  test('marks and clears presentation-only assistive attributes on shared host DOM', () => {
    const container = document.createElement('div');
    const page = document.createElement('div');
    page.className = 'layout-page';
    container.append(page);
    document.body.append(container);

    markPaintedPagesPresentationOnly(container);
    expect(container.getAttribute(PAINTED_PAGES_ASSISTIVE_MARKER)).toBe('presentation-only');
    clearPaintedPagesPresentationOnly(container);
    expect(container.hasAttribute('aria-hidden')).toBe(false);

    container.remove();
  });

  test('reapplies atom labels after manual DOM mutation', () => {
    const root = document.createElement('div');
    const atom = document.createElement('div');
    atom.className = 'docx-block-embed';
    atom.setAttribute('data-sem-id', 'tbl');
    atom.setAttribute('data-kind', 'table');
    atom.textContent = '[table]';
    root.append(atom);
    applyAtomAccessibilityLabels(root, { table: 'Mesita' });
    expect(atom.textContent).toBe('');
    expect(atom.getAttribute('aria-label')).toBe('Mesita');
  });
});
