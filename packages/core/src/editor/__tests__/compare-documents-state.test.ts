// Compare documents: the command gates and the one-step undo unit the result installs as.
//
// The engine is a stub that answers with the revised package itself, so these tests prove the
// editor's half of the contract: who may compare, and that the result is one undo step.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { collectReviewItems, readOoxmlPackage } from '@docx-editor.dev/core/store';
import type {
  CompareDocumentsDialogHost,
  CompareDocumentsEngine,
  EditorModule,
  ReviewModuleContribution,
} from '../../contracts/modules.ts';
import type { CompareDocumentsDialogSession } from '../../contracts/compare-documents.ts';
import { PRO_REVIEW_REASON } from '../opening-editing-mode.ts';
import { COMPARE_COLLABORATION_REASON } from '../compare-documents-state.ts';
import { stubCollaborationModule, stubCollaborationSession } from './collaboration-test-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(text: string, protection?: string): Uint8Array {
  const settings = protection
    ? {
        'word/settings.xml': strToU8(
          `<w:settings xmlns:w="${W}"><w:documentProtection w:edit="${protection}" w:enforcement="1"/></w:settings>`
        ),
        'word/_rels/document.xml.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>`
        ),
      }
    : {};
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (protection
          ? '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
    ),
    ...settings,
  });
}

/** Answers with the revised package, the way a compare would answer with the redline. */
const replaceWithRevised: CompareDocumentsEngine = (_original, revised) => {
  const read = readOoxmlPackage(revised);
  if (!read.ok) return { ok: false, code: 'invalid-revised', message: 'unreadable' };
  return { ok: true, package: read.package, revisionCount: 2 };
};

function reviewModule(review: Partial<ReviewModuleContribution> = {}): EditorModule {
  return {
    id: 'review',
    review: {
      displayModes: ['all-markup', 'proposed', 'original'],
      collectReviewItems,
      revisionItemsOfParagraph: () => [],
      compareDocuments: replaceWithRevised,
      createCompareDocumentsDialog: () => ({ open() {}, destroy() {} }),
      ...review,
    },
  };
}

let cleanup: () => void = () => {};
afterEach(() => cleanup());

function mount(
  modules: EditorModule[],
  options: { mode?: 'view' } = {},
  original = docx('Original text')
): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: original,
    author: 'Reviewer',
    modules,
    ...options,
  });
  cleanup = () => {
    editor.destroy();
    container.remove();
  };
  return editor;
}

const bodyText = (editor: DocxEditorInstance) => editor.surface!.session.bodyText();

describe('compare documents commands', () => {
  test('refuse with the pro reason without the review module', () => {
    const editor = mount([]);
    for (const command of [
      { type: 'openCompareDocumentsDialog' } as const,
      { type: 'compareDocuments', revised: docx('Revised') } as const,
    ]) {
      expect(editor.can(command)).toEqual({
        ok: false,
        code: 'unsupported',
        reason: PRO_REVIEW_REASON,
      });
      expect(editor.exec(command).ok).toBe(false);
    }
  });

  test('refuse with the pro reason when the module has no compare engine or dialog', () => {
    const noEngine = mount([reviewModule({ compareDocuments: undefined })]);
    expect(noEngine.can({ type: 'compareDocuments', revised: docx('x') })).toMatchObject({
      ok: false,
      reason: PRO_REVIEW_REASON,
    });
    cleanup();
    const noDialog = mount([reviewModule({ createCompareDocumentsDialog: undefined })]);
    expect(noDialog.can({ type: 'compareDocuments', revised: docx('x') }).ok).toBe(true);
    expect(noDialog.can({ type: 'openCompareDocumentsDialog' })).toMatchObject({
      ok: false,
      reason: PRO_REVIEW_REASON,
    });
  });

  test('refuse in a collaboration session with a stable reason', () => {
    const editor = mount([reviewModule(), stubCollaborationModule(stubCollaborationSession())]);
    expect(editor.surface!.collaborationSession()).not.toBeNull();
    expect(editor.can({ type: 'openCompareDocumentsDialog' })).toEqual({
      ok: false,
      code: 'unsupported',
      reason: COMPARE_COLLABORATION_REASON,
    });
    expect(editor.exec({ type: 'compareDocuments', revised: docx('Revised') })).toMatchObject({
      ok: false,
      reason: COMPARE_COLLABORATION_REASON,
    });
    expect(bodyText(editor)).toBe('Original text');
  });

  test('refuse while viewing and in a view-only editor', () => {
    const editor = mount([reviewModule()]);
    expect(editor.exec({ type: 'setEditingMode', mode: 'viewing' }).ok).toBe(true);
    expect(editor.can({ type: 'openCompareDocumentsDialog' })).toMatchObject({
      ok: false,
      code: 'locked',
    });
    cleanup();
    const viewOnly = mount([reviewModule()], { mode: 'view' });
    expect(viewOnly.can({ type: 'compareDocuments', revised: docx('x') })).toMatchObject({
      ok: false,
      code: 'locked',
    });
  });

  test('refuse under tracked-changes and comments protection', () => {
    for (const edit of ['trackedChanges', 'comments']) {
      const editor = mount([reviewModule()], {}, docx('Original text', edit));
      expect(editor.can({ type: 'compareDocuments', revised: docx('x') })).toMatchObject({
        ok: false,
        code: 'locked',
      });
      cleanup();
    }
  });

  test('installs the result as one undo step; redo reapplies it', () => {
    const editor = mount([reviewModule()]);
    expect(editor.can({ type: 'openCompareDocumentsDialog' }).ok).toBe(true);
    const revision = editor.surface!.session.packageRevision();
    const [first] = editor.surface!.session.paragraphIds();
    editor.surface!.setSelection({
      anchor: { paragraphId: first!, offset: 3 },
      head: { paragraphId: first!, offset: 8 },
    });
    const result = editor.exec({ type: 'compareDocuments', revised: docx('Revised text') });
    expect(result).toEqual({ ok: true, changed: true });
    expect(bodyText(editor)).toBe('Revised text');
    expect(editor.surface!.session.packageRevision()).toBe(revision + 1);
    // The selection still addresses a live paragraph.
    const ids = editor.surface!.session.paragraphIds();
    const selection = editor.surface!.state().selection;
    expect(ids).toContain(selection.anchor.paragraphId);
    expect(ids).toContain(selection.head.paragraphId);

    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(bodyText(editor)).toBe('Original text');
    expect(editor.surface!.session.canUndo()).toBe(false);
    expect(editor.exec({ type: 'redo' }).ok).toBe(true);
    expect(bodyText(editor)).toBe('Revised text');
  });

  test('passes the author and formatting option to the engine and reports its refusal', () => {
    const calls: unknown[] = [];
    const editor = mount([
      reviewModule({
        compareDocuments: (_original, _revised, options) => {
          calls.push(options);
          return { ok: false, code: 'invalid-revised', message: 'not a document' };
        },
      }),
    ]);
    expect(
      editor.exec({ type: 'compareDocuments', revised: docx('x'), detectFormatChanges: false })
    ).toEqual({ ok: false, code: 'invalidArgs', reason: 'not a document' });
    editor.exec({ type: 'compareDocuments', revised: docx('x'), authorName: ' Editor ' });
    expect(calls).toEqual([
      { authorName: 'Reviewer', detectFormatChanges: false },
      { authorName: 'Editor', detectFormatChanges: true },
    ]);
    expect(editor.exec({ type: 'compareDocuments', revised: new Uint8Array() })).toMatchObject({
      ok: false,
      code: 'invalidArgs',
    });
    expect(bodyText(editor)).toBe('Original text');
  });
});

describe('compare documents dialog session', () => {
  test('host chrome receives the session; apply compares once and closes it', async () => {
    const editor = mount([reviewModule()]);
    const sessions: CompareDocumentsDialogSession[] = [];
    const dispose = editor.setCompareDocumentsChrome({ onRequest: (s) => sessions.push(s) });
    expect(editor.exec({ type: 'openCompareDocumentsDialog' })).toEqual({
      ok: true,
      changed: false,
    });
    const session = sessions[0]!;
    expect(session.defaultAuthor).toBe('Reviewer');
    expect(session.canApply()).toBe(true);
    const outcome = await session.apply({ revised: docx('Revised text') });
    expect(outcome).toEqual({ ok: true, revisionCount: 2 });
    expect(session.signal.aborted).toBe(true);
    expect(bodyText(editor)).toBe('Revised text');
    dispose();
  });

  test('a refused compare keeps the session open with the message', async () => {
    const editor = mount([
      reviewModule({
        compareDocuments: () => ({ ok: false, code: 'too-large', message: 'too large' }),
      }),
    ]);
    let session: CompareDocumentsDialogSession | null = null;
    editor.setCompareDocumentsChrome({ onRequest: (s) => (session = s) });
    editor.exec({ type: 'openCompareDocumentsDialog' });
    const outcome = await session!.apply({ revised: docx('Revised') });
    expect(outcome).toEqual({ ok: false, message: 'too large' });
    expect(session!.signal.aborted).toBe(false);
    session!.cancel();
    expect(session!.signal.aborted).toBe(true);
    expect(session!.canApply()).toBe(false);
  });

  test('without host chrome the module dialog opens; detach closes it', () => {
    const hosts: CompareDocumentsDialogHost[] = [];
    let destroyed = 0;
    const editor = mount([
      reviewModule({
        createCompareDocumentsDialog: (host) => {
          hosts.push(host);
          return { open() {}, destroy: () => (destroyed += 1) };
        },
      }),
    ]);
    expect(editor.exec({ type: 'openCompareDocumentsDialog' }).ok).toBe(true);
    expect(hosts).toHaveLength(1);
    expect(hosts[0]!.container).toBeInstanceOf(HTMLElement);
    editor.detach();
    expect(hosts[0]!.signal.aborted).toBe(true);
    expect(destroyed).toBe(1);
  });
});
