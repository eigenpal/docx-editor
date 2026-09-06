import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import {
  createSuggestingConfigurationReporter,
  isAuthorRejection,
  PRO_REVIEW_REASON,
  SUGGESTING_AUTHOR_REASON,
  suggestingModeRefusal,
} from '../opening-editing-mode.ts';
import { toolbarCommandState } from '../toolbar-commands.ts';
import { stubReviewModule } from './review-test-module.ts';

// Issue #692: enabling suggesting without an author used to SUCCEED, and then every keystroke
// was refused with a reason nothing showed — the document took focus and typing did nothing.
// The request is a host configuration error, so it is refused with the reason, mirrored by
// `can` (and so by the toolbar's disabled state), and said once on the console for a host that
// never reads the result.

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const DOCUMENT_TRACKING_AUTHOR_REASON =
  'this document asks for tracked changes, but no author is configured';

function trackedDocx(): Uint8Array {
  const parts: Record<string, string> = {
    '[Content_Types].xml':
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>',
    '_rels/.rels': `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `<Relationships xmlns="${REL}"><Relationship Id="rIdSettings" Type="${R}/settings" Target="settings.xml"/></Relationships>`,
    'word/settings.xml': `<w:settings xmlns:w="${W}"><w:trackRevisions/></w:settings>`,
    'word/document.xml': `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>tracked</w:t></w:r></w:p></w:body></w:document>`,
  };
  return zipSync(
    Object.fromEntries(Object.entries(parts).map(([name, xml]) => [name, strToU8(xml)]))
  );
}

const errors: string[] = [];
const realError = console.error;
let editors: DocxEditorInstance[] = [];
let containers: HTMLElement[] = [];

beforeEach(() => {
  errors.length = 0;
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  };
});

afterEach(() => {
  console.error = realError;
  for (const editor of editors) editor.destroy();
  for (const container of containers) container.remove();
  editors = [];
  containers = [];
});

function mount(config: {
  author?: string;
  mode?: 'edit' | 'view' | 'suggesting';
  document?: Uint8Array;
  review?: boolean;
}): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const editor = createDocxEditor({
    container,
    document: config.document ?? 'blank',
    ...(config.author === undefined ? {} : { author: config.author }),
    ...(config.mode === undefined ? {} : { mode: config.mode }),
    modules: config.review === false ? [] : [stubReviewModule()],
  });
  editors.push(editor);
  return editor;
}

describe('the decision helpers', () => {
  test('suggestingModeRefusal asks for the module before the author', () => {
    expect(suggestingModeRefusal({ reviewEnabled: false, hasAuthor: false })).toEqual({
      ok: false,
      code: 'unsupported',
      reason: PRO_REVIEW_REASON,
    });
    expect(suggestingModeRefusal({ reviewEnabled: true, hasAuthor: false })).toEqual({
      ok: false,
      code: 'invalidArgs',
      reason: SUGGESTING_AUTHOR_REASON,
    });
    expect(suggestingModeRefusal({ reviewEnabled: true, hasAuthor: true })).toBeNull();
  });

  test('the reporter says the host error once, and only the host error', () => {
    const lines: string[] = [];
    const report = createSuggestingConfigurationReporter((message) => lines.push(message));
    report(null);
    report(PRO_REVIEW_REASON);
    report(DOCUMENT_TRACKING_AUTHOR_REASON);
    expect(lines).toEqual([]);
    report(SUGGESTING_AUTHOR_REASON);
    report(SUGGESTING_AUTHOR_REASON);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[@docx-editor.dev/core]');
    expect(lines[0]).toContain(SUGGESTING_AUTHOR_REASON);
    expect(lines[0]).toContain('setAuthor');
  });

  test('isAuthorRejection names both author rejections and nothing else', () => {
    expect(isAuthorRejection(SUGGESTING_AUTHOR_REASON)).toBe(true);
    expect(isAuthorRejection(DOCUMENT_TRACKING_AUTHOR_REASON)).toBe(true);
    expect(isAuthorRejection(PRO_REVIEW_REASON)).toBe(false);
    expect(isAuthorRejection(null)).toBe(false);
  });
});

describe('setEditingMode(suggesting) without an author', () => {
  test('is refused with the configuration reason and the mode stays editing', () => {
    const editor = mount({});
    expect(editor.setEditingMode('suggesting')).toEqual({
      ok: false,
      code: 'invalidArgs',
      reason: SUGGESTING_AUTHOR_REASON,
    });
    expect(editor.getEditingMode()).toBe('editing');
    // Editing still works, untracked: the document is not mute, it is honest about its mode.
    expect(editor.exec({ type: 'insertText', text: 'x' })).toMatchObject({
      ok: true,
      changed: true,
    });
  });

  test('can mirrors the refusal, so the toolbar pill disables with the same reason', () => {
    const editor = mount({});
    expect(editor.can({ type: 'setEditingMode', mode: 'suggesting' })).toEqual({
      ok: false,
      code: 'invalidArgs',
      reason: SUGGESTING_AUTHOR_REASON,
    });
    // The other modes stay the reader's to choose.
    expect(editor.can({ type: 'setEditingMode', mode: 'viewing' })).toEqual({ ok: true });
    const pill = toolbarCommandState(editor, 'review.editingMode');
    expect(pill.enabled).toBe(false);
    expect(pill.disabledReason).toBe(SUGGESTING_AUTHOR_REASON);
  });

  test('the module refusal still comes first', () => {
    const editor = mount({ review: false });
    expect(editor.setEditingMode('suggesting')).toEqual({
      ok: false,
      code: 'unsupported',
      reason: PRO_REVIEW_REASON,
    });
    expect(errors).toEqual([]);
  });

  test('is reported once on the console, and can does not report', () => {
    const editor = mount({});
    editor.can({ type: 'setEditingMode', mode: 'suggesting' });
    expect(errors).toEqual([]);
    editor.setEditingMode('suggesting');
    editor.setEditingMode('suggesting');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(SUGGESTING_AUTHOR_REASON);
  });

  test('a whitespace author is no author', () => {
    const editor = mount({ author: '   ' });
    expect(editor.setEditingMode('suggesting')).toMatchObject({ ok: false, code: 'invalidArgs' });
  });

  test('succeeds once an author is configured', () => {
    const editor = mount({});
    expect(editor.setEditingMode('suggesting').ok).toBe(false);
    editor.setAuthor('Grace Hopper');
    expect(editor.can({ type: 'setEditingMode', mode: 'suggesting' })).toEqual({ ok: true });
    expect(editor.setEditingMode('suggesting')).toEqual({ ok: true, changed: false });
    expect(editor.getEditingMode()).toBe('suggesting');
    expect(toolbarCommandState(editor, 'review.editingMode').enabled).toBe(true);
  });
});

describe('a host request for suggesting with no author', () => {
  test("`mode: 'suggesting'` opens editing, publishes the reason and reports it once", () => {
    const editor = mount({ mode: 'suggesting' });
    expect(editor.getEditingMode()).toBe('editing');
    expect(editor.snapshot().lastRejection).toBe(SUGGESTING_AUTHOR_REASON);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(SUGGESTING_AUTHOR_REASON);
  });

  test('setMode(suggesting) is published and reported the same way', () => {
    const editor = mount({});
    editor.setMode('suggesting');
    expect(editor.getEditingMode()).toBe('editing');
    expect(editor.snapshot().lastRejection).toBe(SUGGESTING_AUTHOR_REASON);
    expect(errors).toHaveLength(1);
  });

  test('an author arriving later enters the requested mode and clears the rejection', () => {
    const editor = mount({ mode: 'suggesting' });
    let changes = 0;
    editor.on('selectionChange', () => changes++);
    editor.setAuthor('Grace Hopper');
    expect(editor.getEditingMode()).toBe('suggesting');
    expect(editor.snapshot().lastRejection).toBeNull();
    expect(editor.snapshot().editingMode).toBe('suggesting');
    expect(changes).toBe(1);
    expect(editor.exec({ type: 'insertText', text: 'x' })).toMatchObject({ ok: true });
    expect(errors).toHaveLength(1);
  });

  test("the reader's own choice outranks the arriving author", () => {
    const editor = mount({ mode: 'suggesting' });
    expect(editor.setEditingMode('viewing').ok).toBe(true);
    editor.setAuthor('Grace Hopper');
    expect(editor.getEditingMode()).toBe('viewing');
  });

  test('an author arriving with no pending request changes nothing', () => {
    const editor = mount({});
    editor.setAuthor('Grace Hopper');
    expect(editor.getEditingMode()).toBe('editing');
    expect(editor.snapshot().lastRejection).toBeNull();
    expect(errors).toEqual([]);
  });
});

describe('a document that asks for tracking with no author', () => {
  test('opens editing with the reason published, and is NOT a console error', () => {
    const editor = mount({ document: trackedDocx() });
    expect(editor.getEditingMode()).toBe('editing');
    expect(editor.snapshot().lastRejection).toBe(DOCUMENT_TRACKING_AUTHOR_REASON);
    expect(errors).toEqual([]);
  });

  test('enters suggesting when an author arrives', () => {
    const editor = mount({ document: trackedDocx() });
    editor.setAuthor('Grace Hopper');
    expect(editor.getEditingMode()).toBe('suggesting');
    expect(editor.snapshot().lastRejection).toBeNull();
  });

  test("an explicit `mode: 'edit'` keeps editing when an author arrives", () => {
    const editor = mount({ document: trackedDocx(), mode: 'edit' });
    editor.setAuthor('Grace Hopper');
    expect(editor.getEditingMode()).toBe('editing');
  });
});
