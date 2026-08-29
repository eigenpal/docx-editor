// The save path refreshes stale REF field results inside footnote and endnote PARTS.
//
// Note stories already paint live values through the shared body context; these tests pin
// the other half: after a body edit, `editor.save()` exports the live value inside
// `word/footnotes.xml` / `word/endnotes.xml` (instruction untouched, run properties kept);
// a document whose note results are already fresh saves byte-identically with no revision
// bump and no undo entry; a note field that failed calibration keeps its cache; a
// revision-marked note result is skipped; and refresh+save+reopen digests identically
// across a second save. Fixtures mount FRESH — the calibration gate requires a field's
// computed value to reproduce its cache once before it goes live.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { semanticDigest } from '../../store/package/ooxml-digest.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

type NoteKind = 'footnote' | 'endnote';

/** One notes part: a separator note plus one normal note holding `content` in a paragraph. */
const notesXml = (kind: NoteKind, content: string) =>
  `<w:${kind}s xmlns:w="${W}">` +
  `<w:${kind} w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:${kind}>` +
  `<w:${kind} w:id="1"><w:p>${content}</w:p></w:${kind}>` +
  `</w:${kind}s>`;

function docx(body: string, notes: Partial<Record<NoteKind, string>>): Uint8Array {
  const overrides = (Object.keys(notes) as NoteKind[])
    .map(
      (kind) =>
        `<Override PartName="/word/${kind}s.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}s+xml"/>`
    )
    .join('');
  const noteRels = (Object.keys(notes) as NoteKind[])
    .map((kind) => `<Relationship Id="rId${kind}" Type="${R}/${kind}s" Target="${kind}s.xml"/>`)
    .join('');
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        overrides +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">${noteRels}</Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
  };
  for (const kind of Object.keys(notes) as NoteKind[]) {
    files[`word/${kind}s.xml`] = strToU8(notesXml(kind, notes[kind]!));
  }
  return zipSync(files);
}

const bookmarked = (name: string, text: string) =>
  `<w:bookmarkStart w:id="1" w:name="${name}"/><w:r><w:t>${text}</w:t></w:r>` +
  `<w:bookmarkEnd w:id="1"/>`;
const refField = (instr: string, result: string) =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  `<w:r><w:instrText xml:space="preserve">${instr}</w:instrText></w:r>` +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  result +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

/** Target FIRST (the edit below addresses it), one citing paragraph per note kind after. */
const bodyWithReferences = (kinds: readonly NoteKind[]) =>
  `<w:p>${bookmarked('term', 'Closing Date')}</w:p>` +
  kinds
    .map((kind) => `<w:p><w:r><w:t>cites</w:t><w:${kind}Reference w:id="1"/></w:r></w:p>`)
    .join('');

/** FRESH on load: the cache reproduces the bookmarked text, so calibration goes live. */
const freshNoteContent = (rPr = '') =>
  `<w:r><w:t xml:space="preserve">see </w:t></w:r>` +
  refField(' REF term \\h ', `<w:r>${rPr}<w:t>Closing Date</w:t></w:r>`);

function mount(bytes: Uint8Array): DocxEditorInstance {
  const container = document.createElement('div');
  const editor = createDocxEditor({ container, document: bytes });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

function firstParagraphId(editor: DocxEditorInstance): string {
  const part = editor.surface!.session.part();
  let found: string | undefined;
  const walk = (node: (typeof part)['root']): void => {
    if (found) return;
    if (node.kind === 'paragraph') {
      found = node.id;
      return;
    }
    for (const child of node.children) {
      if (child.kind !== 'textValue') walk(child);
    }
  };
  walk(part.root);
  if (!found) throw new Error('missing paragraph');
  return found;
}

/** Append one character to the bookmarked target text, so the note REF cache goes stale. */
function editTarget(editor: DocxEditorInstance): void {
  const result = editor.surface!.session.applyTreeOps([
    {
      op: 'insertText',
      paragraphId: firstParagraphId(editor),
      offset: 'Closing Date'.length,
      text: 's',
    },
  ]);
  expect(result.committed).toBe(true);
}

async function savedPartXml(editor: DocxEditorInstance, partName: string): Promise<string> {
  const bytes = new Uint8Array(await editor.save());
  return strFromU8(unzipSync(bytes)[partName]!);
}

describe('save() refreshes stale REF results inside note parts', () => {
  test('a stale footnote REF exports the live value; instruction and rPr survive', async () => {
    const editor = mount(
      docx(bodyWithReferences(['footnote']), {
        footnote: freshNoteContent('<w:rPr><w:i/></w:rPr>'),
      })
    );
    editTarget(editor);
    const xml = await savedPartXml(editor, 'word/footnotes.xml');
    expect(xml).toContain(' REF term \\h ');
    // The result run keeps its own properties and carries the live value.
    expect(xml).toContain(
      '<w:fldChar w:fldCharType="separate"/></w:r>' +
        '<w:r><w:rPr><w:i/></w:rPr><w:t>Closing Dates</w:t></w:r>'
    );
    expect(xml).not.toContain('<w:t>Closing Date</w:t>');
    editor.destroy();
  });

  test('a stale endnote REF exports the live value likewise', async () => {
    const editor = mount(docx(bodyWithReferences(['endnote']), { endnote: freshNoteContent() }));
    editTarget(editor);
    const xml = await savedPartXml(editor, 'word/endnotes.xml');
    expect(xml).toContain(' REF term \\h ');
    expect(xml).toContain(
      '<w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Closing Dates</w:t></w:r>'
    );
    editor.destroy();
  });

  test('a note REF that failed calibration is never rewritten', async () => {
    // 'Outdated' does not reproduce the bookmarked text, so the field never goes live —
    // and the refresh must not export the very value calibration suppressed.
    const editor = mount(
      docx(bodyWithReferences(['footnote']), {
        footnote:
          `<w:r><w:t xml:space="preserve">see </w:t></w:r>` +
          refField(' REF term \\h ', '<w:r><w:t>Outdated</w:t></w:r>'),
      })
    );
    editTarget(editor);
    const revisionAfterEdit = editor.getDocumentHandle().revision;
    const xml = await savedPartXml(editor, 'word/footnotes.xml');
    expect(xml).toContain('<w:t>Outdated</w:t>');
    expect(xml).not.toContain('Closing Dates');
    // No refresh transaction ran: nothing else in this document is refreshable.
    expect(editor.getDocumentHandle().revision).toBe(revisionAfterEdit);
    editor.destroy();
  });

  test('fresh note results save byte-identically, with no revision bump and no undo entry', async () => {
    const editor = mount(
      docx(bodyWithReferences(['footnote', 'endnote']), {
        footnote: freshNoteContent(),
        endnote: freshNoteContent(),
      })
    );
    const surface = editor.surface!;
    const revisionBefore = editor.getDocumentHandle().revision;
    // The oracle: a serialize with NO refresh in front of it.
    const withoutRefresh = surface.session.save();
    const withRefresh = new Uint8Array(await editor.save());
    expect(withRefresh).toEqual(withoutRefresh);
    expect(editor.getDocumentHandle().revision).toBe(revisionBefore);
    expect(surface.session.canUndo()).toBe(false);
    editor.destroy();
  });

  test('a stale note refresh is an ordinary transaction: revision bumps and it is undoable', async () => {
    const editor = mount(docx(bodyWithReferences(['footnote']), { footnote: freshNoteContent() }));
    editTarget(editor);
    const revisionAfterEdit = editor.getDocumentHandle().revision;
    await editor.save();
    expect(editor.getDocumentHandle().revision).toBeGreaterThan(revisionAfterEdit);
    expect(editor.surface!.session.canUndo()).toBe(true);
    editor.destroy();
  });

  test('a note result wrapped in revision markup is skipped and saved exactly as loaded', async () => {
    const editor = mount(
      docx(bodyWithReferences(['footnote']), {
        footnote:
          `<w:r><w:t xml:space="preserve">see </w:t></w:r>` +
          refField(
            ' REF term \\h ',
            '<w:ins w:id="9" w:author="QA" w:date="2020-01-01T00:00:00Z">' +
              '<w:r><w:t>Closing Date</w:t></w:r></w:ins>'
          ),
      })
    );
    editTarget(editor);
    const revisionAfterEdit = editor.getDocumentHandle().revision;
    const xml = await savedPartXml(editor, 'word/footnotes.xml');
    expect(xml).toContain('<w:ins');
    expect(xml).toContain('<w:t>Closing Date</w:t>');
    expect(xml).not.toContain('Closing Dates');
    expect(editor.getDocumentHandle().revision).toBe(revisionAfterEdit);
    editor.destroy();
  });

  test('refresh + save + reopen digests identically across a second save', async () => {
    const editor = mount(
      docx(bodyWithReferences(['footnote', 'endnote']), {
        footnote: freshNoteContent(),
        endnote: freshNoteContent(),
      })
    );
    editTarget(editor);
    const firstSave = new Uint8Array(await editor.save());
    expect(strFromU8(unzipSync(firstSave)['word/footnotes.xml']!)).toContain('Closing Dates');
    expect(strFromU8(unzipSync(firstSave)['word/endnotes.xml']!)).toContain('Closing Dates');
    editor.destroy();

    const reopened = mount(firstSave);
    const secondSave = new Uint8Array(await reopened.save());
    // The rewrite is a fixed point: nothing was stale on reopen, so the second save is the
    // byte-identical serialization, and the semantic digests agree.
    expect(secondSave).toEqual(firstSave);
    const digestOf = (bytes: Uint8Array) => {
      const loaded = readOoxmlPackage(bytes);
      if (!loaded.ok) throw new Error(loaded.reason);
      return semanticDigest(loaded.package.parts.values());
    };
    expect(digestOf(secondSave)).toEqual(digestOf(firstSave));
    reopened.destroy();
  });
});
