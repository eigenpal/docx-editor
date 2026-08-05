/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `settings.xml` states the tracking the DOCUMENT asks for, and the editor honours it.
//
// The failure this exists to prevent: a package carrying `w:trackRevisions` opening as an
// ordinary editable document, so the first keystroke is an untracked edit in a file whose
// author asked for the opposite — with the mode pill reading "Editing" the whole time.
//
// `w:documentProtection/@w:edit="trackedChanges"` says something stronger, and is honoured
// as advice rather than as enforcement: the hash is not verified and never presented as if it
// were, because the file is editable by anyone holding it. What ignoring it produces is the
// untracked edits it exists to prevent.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { readOoxmlPart, readTrackingSettings } from '@docx-editor.dev/core/store';
import { reviewModule as testReviewModule } from '../review/review-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const SETTINGS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings';
const SETTINGS_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml';

const BODY = '<w:p><w:r><w:t>alpha beta gamma</w:t></w:r></w:p>';

function docx(settings: string | null): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        (settings === null
          ? ''
          : `<Override PartName="/word/settings.xml" ContentType="${SETTINGS_CT}"/>`) +
        `</Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${BODY}</w:body></w:document>`
    ),
  };
  if (settings !== null) {
    files['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rIdS" Type="${SETTINGS_REL}" Target="settings.xml"/></Relationships>`
    );
    files['word/settings.xml'] = strToU8(`<w:settings xmlns:w="${W}">${settings}</w:settings>`);
  }
  return zipSync(files);
}

// `null` for "no author", not `undefined`: a default parameter fills in for an explicit
// `undefined`, so passing it would have silently kept the default author.
function mount(settings: string | null, author: string | null = 'Grace Hopper') {
  const container = document.createElement('div');
  const editor: DocxEditorInstance = createDocxEditor({
    container,
    document: docx(settings),
    modules: [testReviewModule()],
    ...(author === null ? {} : { author }),
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

function settingsOf(inner: string) {
  const read = readOoxmlPart(`<w:settings xmlns:w="${W}">${inner}</w:settings>`, {
    name: '/word/settings.xml',
    contentType: SETTINGS_CT,
  });
  if (!read.ok) throw new Error(read.reason);
  return readTrackingSettings(read.part.root);
}

describe('reading what the document asks for', () => {
  test('a package with no settings part asks for nothing', () => {
    expect(mount(null).getEditingMode()).toBe('editing');
  });

  test('`w:trackRevisions` reads as a request to track', () => {
    expect(settingsOf('<w:trackRevisions/>').trackRevisions).toBe(true);
  });

  test('`w:trackRevisions w:val="0"` reads as a request NOT to track', () => {
    // `ST_OnOff`: the element's presence is not the answer, its value is. Reading presence
    // alone turned a document that had explicitly turned tracking off back on.
    expect(settingsOf('<w:trackRevisions w:val="0"/>').trackRevisions).toBe(false);
    expect(settingsOf('<w:trackRevisions w:val="false"/>').trackRevisions).toBe(false);
  });

  test('the do-not-track switches read independently', () => {
    const both = settingsOf('<w:doNotTrackMoves/><w:doNotTrackFormatting/>');
    expect(both.doNotTrackMoves).toBe(true);
    expect(both.doNotTrackFormatting).toBe(true);
    expect(both.trackRevisions).toBe(false);
  });

  test('protection restricted to tracked changes reads only when enforced', () => {
    expect(
      settingsOf('<w:documentProtection w:edit="trackedChanges" w:enforcement="1"/>')
        .restrictedToTrackedChanges
    ).toBe(true);
    // A recorded but UNENFORCED protection locks nothing — Word lets the document be edited
    // freely, and honouring it would lock a document its author left open.
    expect(
      settingsOf('<w:documentProtection w:edit="trackedChanges" w:enforcement="0"/>')
        .restrictedToTrackedChanges
    ).toBe(false);
    // A different `@w:edit` restricts something else entirely.
    expect(
      settingsOf('<w:documentProtection w:edit="readOnly" w:enforcement="1"/>')
        .restrictedToTrackedChanges
    ).toBe(false);
  });
});

describe('honouring what the document asks for', () => {
  test('a document declaring `w:trackRevisions` opens in suggesting mode', () => {
    const editor = mount('<w:trackRevisions/>');
    expect(editor.getEditingMode()).toBe('suggesting');
  });

  test('the first keystroke in such a document is tracked', () => {
    const editor = mount('<w:trackRevisions/>');
    const fragment = editor.surface!.layout().pages[0]!.fragments[0]!;
    if (fragment.kind !== 'paragraph') throw new Error('expected a paragraph');
    editor.surface!.setSelection({
      anchor: { paragraphId: fragment.paragraphId, offset: 0 },
      head: { paragraphId: fragment.paragraphId, offset: 0 },
    });
    editor.surface!.type('X');
    const [card] = editor.getReviewItems();
    expect(card?.kind === 'revision' ? card.revisionKind : null).toBe('insert');
    expect(card?.author).toBe('Grace Hopper');
  });

  test('with no author the mode is not entered, and the reason is published', () => {
    const editor = mount('<w:trackRevisions/>', null);
    expect(editor.getEditingMode()).toBe('editing');
    // Suggesting refuses every edit without an author, so entering it would be a document
    // that takes no typing and says nothing about why.
    expect(editor.snapshot().lastRejection).toContain('author');
  });

  test('the reader outranks the file', () => {
    const editor = mount('<w:trackRevisions/>');
    expect(editor.setEditingMode('editing').ok).toBe(true);
    expect(editor.getEditingMode()).toBe('editing');
  });

  test('a document opened for viewing stays viewing', () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: docx('<w:trackRevisions/>'),
      author: 'Grace Hopper',
      mode: 'view',
      modules: [testReviewModule()],
    });
    expect(editor.getEditingMode()).toBe('viewing');
  });
});

describe('protection restricted to tracked changes', () => {
  const PROTECTED =
    '<w:trackRevisions/><w:documentProtection w:edit="trackedChanges" w:enforcement="1"/>';

  test('editing cannot be selected', () => {
    const editor = mount(PROTECTED);
    expect(editor.getEditingMode()).toBe('suggesting');
    const result = editor.setEditingMode('editing');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe('locked');
    expect(editor.getEditingMode()).toBe('suggesting');
  });

  test('the control reports it disabled before it is pressed', () => {
    const editor = mount(PROTECTED);
    expect(editor.can({ type: 'setEditingMode', mode: 'editing' }).ok).toBe(false);
  });

  test('viewing is still reachable', () => {
    // Reading less than the document permits is not something a protection setting has an
    // interest in refusing.
    const editor = mount(PROTECTED);
    expect(editor.setEditingMode('viewing').ok).toBe(true);
    expect(editor.getEditingMode()).toBe('viewing');
  });
});
