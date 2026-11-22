// Every insert command at every edge of a generated table of contents. A command is either
// refused by `can` and `exec` alike, leaving the document as it was, or it writes outside the
// field: the field stays well formed, and a refresh of every TOC keeps what was inserted.
//
// The edges are where one offset names both sides of a zero-width `w:fldChar`: the begin edge
// (before `w:fldChar w:fldCharType="begin"`, which is also the separator's edge when the field
// code ends its paragraph), the end edge (after `w:fldChar w:fldCharType="end"`), and ranges
// that start or stop there.

import { afterEach, expect, test } from 'bun:test';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { docx } from './paginated-surface-fixtures.ts';
import { detectBodyTocs, serializeOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import type { EditorCommand, ExecResult } from '../../contracts/editor.ts';
import type { SemanticSelection } from '../../layout/semantic-interaction.ts';
import { stubReviewModule } from './review-test-module.ts';
import { reviewModule } from './replace-accepted-text-fixture.ts';
import { validateRasterHeader, type ImageDecodePort } from '../../store/package/image-resources.ts';
import { tocParagraphRanges } from '../surface-toc-ranges.ts';

const run = (s: string) => `<w:r><w:t>${s}</w:t></w:r>`;
const begin =
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>TOC \\o "1-1" \\h</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>';
const end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const p = (...content: string[]) => `<w:p>${content.join('')}</w:p>`;
const heading = '<w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:r><w:t>Heading</w:t></w:r></w:p>';
const ins = (...content: string[]) =>
  `<w:ins w:id="90" w:author="B" w:date="2026-01-01T00:00:00Z">${content.join('')}</w:ins>`;
const deleted = (s: string) =>
  `<w:del w:id="91" w:author="B" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>${s}</w:delText></w:r></w:del>`;
const link = (anchor: string, ...content: string[]) =>
  `<w:hyperlink w:anchor="${anchor}">${content.join('')}</w:hyperlink>`;
const mark = (name: string) =>
  `<w:bookmarkStart w:id="80" w:name="${name}"/><w:bookmarkEnd w:id="80"/>`;
const control = (content: string) =>
  `<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/></w:docPartObj></w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;

/** TOC shapes: [label, body]. Each has text before and after, and a heading to refresh from. */
const SHAPES: readonly (readonly [string, string])[] = [
  ['block', p(run('Before')) + p(begin, run('Entry 1')) + p(run('Entry 2')) + p(end) + heading],
  ['field code alone', p(run('Before')) + p(begin) + p(run('Entry 1')) + p(end) + heading],
  [
    'mid-paragraph',
    p(run('Before'), begin, run('Entry 1')) + p(run('Pg'), end, run('Tail')) + heading,
  ],
  [
    'joined closing line',
    p(run('Before')) + p(begin, run('Entry 1')) + p(end, run('Tail')) + heading,
  ],
  [
    'closing line in a heading',
    p(run('Before')) +
      p(begin, run('Entry 1')) +
      `<w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr>${end}${run('Tail')}</w:p>` +
      heading,
  ],
  [
    'field characters sharing runs with text',
    p(
      '<w:r><w:t>Before</w:t><w:fldChar w:fldCharType="begin"/></w:r>',
      '<w:r><w:instrText>TOC \\o "1-1" \\h</w:instrText></w:r>',
      '<w:r><w:fldChar w:fldCharType="separate"/><w:t>Entry 1</w:t></w:r>'
    ) +
      p('<w:r><w:t>Pg</w:t><w:fldChar w:fldCharType="end"/><w:t>Tail</w:t></w:r>') +
      heading,
  ],
  [
    'linked row before the end mark',
    p(begin, run('Entry 1')) +
      p('<w:hyperlink w:anchor="_Toc1">', run('Row'), '</w:hyperlink>', end, run('Tail')) +
      heading,
  ],
  [
    'tracked insertion holding the end mark and text after it',
    p(begin, run('Entry 1')) + p(ins(run('Pg'), end, run('Tail'))) + heading,
  ],
  [
    'tracked insertion holding the end mark beside a tracked deletion',
    p(begin, run('Entry 1')) + p(ins(end, run('Tail')), deleted('Gone'), run('After')) + heading,
  ],
  [
    'tracked insertion holding text and the begin mark',
    p(ins(run('Before'), begin)) + p(run('Entry 1')) + p(end) + heading,
  ],
  [
    'link holding the end mark and text after it',
    p(mark('Top'), begin, run('Entry 1')) + p(link('Top', run('Row'), end, run('Tail'))) + heading,
  ],
  [
    'link holding text and the begin mark',
    p(mark('Top'), link('Top', run('Before'), begin), run('Entry 1')) + p(end) + heading,
  ],
  [
    'smart tag holding the end mark and text after it',
    p(begin, run('Entry 1')) +
      p(
        '<w:smartTag w:uri="urn:x" w:element="place">',
        run('Pg'),
        end,
        run('Tail'),
        '</w:smartTag>'
      ) +
      heading,
  ],
  ['content control', p(run('Before')) + control(p(begin) + p(run('Entry 1')) + p(end)) + heading],
  [
    'adjacent',
    p(run('Before')) + p(begin, run('A 1')) + p(end) + p(begin, run('B 1')) + p(end) + heading,
  ],
  [
    'adjacent in one paragraph',
    p(run('Before')) +
      p(begin, run('A 1')) +
      p(run('Pg'), end, begin, run('B 1')) +
      p(end) +
      heading,
  ],
];

const png = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (character) => character.charCodeAt(0)
);
const imageDecodePort: ImageDecodePort = {
  async decode(bytes, mime) {
    const header = validateRasterHeader(bytes, mime);
    if (!header) throw new Error('invalid image');
    return { pixelWidth: header.pixelWidth, pixelHeight: header.pixelHeight, dpiX: 96, dpiY: 96 };
  },
};
const PICTURE = {
  type: 'insertImage',
  data: png,
  mime: 'image/png',
  widthPoints: 9,
  heightPoints: 9,
};

const count = (pattern: RegExp) => (xml: string) => xml.match(pattern)?.length ?? 0;

/** Each insert command, with a count of what it writes into the body. */
const COMMANDS: readonly (readonly [EditorCommand, (xml: string) => number])[] = [
  [{ type: 'insertText', text: 'ZQ' }, count(/ZQ/g)],
  [{ type: 'insertBreak', kind: 'line' } as EditorCommand, count(/<w:br\/>/g)],
  [{ type: 'insertBreak', kind: 'page' } as EditorCommand, count(/<w:br w:type="page"\/>/g)],
  [{ type: 'splitParagraph' } as EditorCommand, count(/<w:p[ >]/g)],
  [{ type: 'paste', text: 'PZ' }, count(/PZ/g)],
  [{ type: 'pasteWithoutFormatting', text: 'WZ' }, count(/WZ/g)],
  [{ type: 'proposeInsertion', text: 'RZ', author: 'A' } as EditorCommand, count(/RZ/g)],
  [{ type: 'insertNote', noteKind: 'footnote' }, count(/<w:footnoteReference /g)],
  [{ type: 'insertBookmark', name: 'edge' }, count(/<w:bookmarkStart [^>]*w:name="edge"/g)],
  [
    { type: 'insertHyperlink', href: 'https://example.com/' } as EditorCommand,
    count(/<w:hyperlink [^>]*r:id=/g),
  ],
  [{ type: 'insertContentControl', subtype: 'plainText' } as EditorCommand, count(/<w:text\/>/g)],
  [
    { type: 'addComment', text: 'Note', author: 'A' } as EditorCommand,
    count(/<w:commentRangeStart /g),
  ],
  [{ type: 'insertChart', chartType: 'columnClustered' } as EditorCommand, count(/<c:chart /g)],
  [PICTURE as unknown as EditorCommand, count(/<pic:pic[ >]/g)],
  [{ type: 'insertTable', rows: 1, cols: 1 } as EditorCommand, count(/<w:tbl>/g)],
  [{ type: 'insertTextBox' }, count(/<w:txbxContent[ >]/g)],
  [{ type: 'insertToc' }, count(/w:fldCharType="begin"/g)],
];

/** Commands whose writes a refresh may legitimately renumber (paragraph count). */
const COUNT_CHANGES_ON_REFRESH = new Set(['splitParagraph']);

/**
 * Commands that divide an insertion anywhere, not only at a field edge: a paragraph split, a
 * proposed insertion (another change between the halves), and a link (which cannot sit in a
 * `w:ins`, so each half of the insertion keeps its own wrapper).
 */
const DIVIDES_INSERTIONS = new Set([
  'splitParagraph',
  'insertTable',
  'insertToc',
  'proposeInsertion',
  'insertHyperlink',
]);

const editors: DocxEditorInstance[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

/** Suggesting mode needs a review module that tracks changes; editing mode needs comments. */
function mount(body: string, mode: 'editing' | 'suggesting' = 'editing'): DocxEditorInstance {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: docx(body),
    author: 'A',
    imageDecodePort,
    modules: [mode === 'suggesting' ? reviewModule() : stubReviewModule()],
  });
  editors.push(editor);
  return editor;
}

/** The edge selections of every TOC in a part: carets at each edge and ranges beside them. */
function edgeSelections(part: OoxmlPart): readonly (readonly [string, SemanticSelection])[] {
  const out: (readonly [string, SemanticSelection])[] = [];
  const at = (paragraphId: string, a: number, h = a): SemanticSelection => ({
    anchor: { paragraphId, offset: a },
    head: { paragraphId, offset: h },
  });
  for (const [index, r] of tocParagraphRanges(part).entries()) {
    const name = `toc ${r.toc.id}`;
    if (r.startsHere) {
      const edge = r.start === r.length ? 'separator edge' : 'begin edge';
      out.push([`${name} ${edge}`, at(r.paragraphId, r.start)]);
      if (r.start >= 2)
        out.push([`${name} range up to the ${edge}`, at(r.paragraphId, r.start - 2, r.start)]);
    }
    if (r.endsHere) {
      out.push([`${name} end edge`, at(r.paragraphId, r.end)]);
      if (r.length >= r.end + 2)
        out.push([`${name} range from the end edge`, at(r.paragraphId, r.end, r.end + 2)]);
    }
    if (!r.startsHere && !r.endsHere && r.length > 1)
      out.push([`row ${index}`, at(r.paragraphId, 1)]);
  }
  return out;
}

/** Whether every `w:fldChar` pairs up: begin, an optional separate, then end. */
function fieldsWellFormed(xml: string): boolean {
  const stack: ('begin' | 'separate')[] = [];
  for (const [, type] of xml.matchAll(/w:fldCharType="(begin|separate|end)"/g)) {
    if (type === 'begin') stack.push('begin');
    else if (type === 'separate') {
      if (stack.at(-1) !== 'begin') return false;
      stack[stack.length - 1] = 'separate';
    } else if (stack.pop() === undefined) return false;
  }
  return stack.length === 0;
}

/** The wrappers around each `w:fldChar`, so a link or control placed across one shows up. */
function fieldCharWrappers(xml: string): string {
  const wrappers = new Set(['w:hyperlink', 'w:sdt', 'w:ins', 'w:del', 'w:smartTag']);
  const stack: string[] = [];
  const found: string[] = [];
  for (const [tag, close, name, selfClose] of xml.matchAll(/<(\/?)([\w:]+)[^>]*?(\/?)>/g)) {
    if (name === 'w:fldChar') found.push(stack.filter((open) => wrappers.has(open)).join('>'));
    if (close) stack.pop();
    else if (!selfClose && !tag.endsWith('/>')) stack.push(name!);
  }
  return found.sort().join('|');
}

async function attempt(editor: DocxEditorInstance, command: EditorCommand) {
  if (command.type === 'insertImage') {
    const image = command as unknown as Parameters<DocxEditorInstance['executeImageCommand']>[0];
    return {
      can: editor.canExecuteImageCommand(image),
      result: await editor.executeImageCommand(image),
    };
  }
  return { can: editor.can(command), result: editor.exec(command) as ExecResult };
}

const bodyXml = (editor: DocxEditorInstance) => serializeOoxmlPart(editor.surface!.session.part());

for (const [shape, body] of SHAPES) {
  test(`${shape}: the TOC is detected`, () => {
    const editor = mount(body);
    const expected = shape.startsWith('adjacent') ? 2 : 1;
    expect(detectBodyTocs(editor.surface!.session.part())).toHaveLength(expected);
  });

  for (const [command, probe] of COMMANDS)
    for (const mode of ['editing', 'suggesting'] as const) {
      test(`${shape}: ${command.type} at every edge stays outside the field (${mode})`, async () => {
        const places = edgeSelections(mount(body).surface!.session.part());
        expect(places.length).toBeGreaterThan(0);
        const failures: string[] = [];
        for (const [place, selection] of places) {
          // A picture over selected text is refused anywhere (it replaces a selected drawing),
          // so only carets ask where a picture goes.
          const caret = selection.anchor.offset === selection.head.offset;
          if (command.type === 'insertImage' && !caret) continue;
          // Chart insertion is unavailable in suggesting mode anywhere, so it asks nothing here.
          if (command.type === 'insertChart' && mode === 'suggesting') continue;
          const editor = mount(body, mode);
          const surface = editor.surface!;
          if (mode === 'suggesting') expect(editor.setEditingMode('suggesting').ok).toBe(true);
          surface.setSelection(selection);
          const before = bodyXml(editor);
          const tocs = detectBodyTocs(surface.session.part()).length;
          const { can, result } = await attempt(editor, command);
          const fail = (why: string) => failures.push(`${place}: ${why}`);
          if (!result.ok) {
            if (can.ok) fail(`can ok, exec refused (${'reason' in result ? result.reason : ''})`);
            if (bodyXml(editor) !== before) fail('a refusal changed the document');
            continue;
          }
          if (!can.ok) fail(`exec ok, can refused (${can.reason})`);
          const written = bodyXml(editor);
          const added = command.type === 'insertToc' ? 1 : 0;
          if (!fieldsWellFormed(written)) fail('field characters no longer pair up');
          if (added === 0 && fieldCharWrappers(written) !== fieldCharWrappers(before)) {
            fail('a wrapper now holds a field character');
          }
          if (detectBodyTocs(surface.session.part()).length !== tocs + added)
            fail('TOC count changed');
          const inserted = probe(written);
          const start = written.indexOf('<w:bookmarkStart w:id="');
          if (command.type === 'insertBookmark' && start > written.indexOf('<w:bookmarkEnd')) {
            fail('the bookmark end comes before its start');
          }
          if (inserted <= probe(before)) fail('nothing was inserted');
          for (const toc of detectBodyTocs(surface.session.part())) {
            const refreshed = editor.exec({ type: 'refreshToc', tocId: toc.id });
            if (!refreshed.ok) fail(`refresh refused (${refreshed.reason})`);
          }
          const after = bodyXml(editor);
          if (!fieldsWellFormed(after)) fail('field characters no longer pair up after a refresh');
          for (const [, anchor] of after.matchAll(/<w:hyperlink [^>]*w:anchor="([^"]+)"/g)) {
            if (!after.includes(`w:name="${anchor}"`)) fail(`a refresh left a link to ${anchor}`);
          }
          if (!COUNT_CHANGES_ON_REFRESH.has(command.type) && probe(after) !== inserted) {
            fail(`a refresh dropped the insert (${inserted} -> ${probe(after)})`);
          }
        }
        expect(failures).toEqual([]);
      });
    }
}

// An insertion holding a field character is divided to place content at the edge. Untracked
// content placed there joins the insertion again, as typing inside an insertion extends it, so
// the review pane still shows one change and the change is still decided by its id.
const revisionItems = (editor: DocxEditorInstance) =>
  editor.getReviewItems().filter((item) => item.id.includes('\u000090\u0000')).length;
for (const [shape, body] of SHAPES.filter(([label]) => label.startsWith('tracked insertion')))
  test(`${shape}: an insert at an edge keeps the insertion one change (editing)`, async () => {
    const failures: string[] = [];
    for (const [command] of COMMANDS) {
      if (DIVIDES_INSERTIONS.has(command.type)) continue;
      for (const [place, selection] of edgeSelections(mount(body).surface!.session.part())) {
        // The tracking review module decides changes; the editor stays in editing mode.
        const editor = mount(body, 'suggesting');
        editor.surface!.setSelection(selection);
        const before = revisionItems(editor);
        const { result } = await attempt(editor, command);
        if (!result.ok) continue;
        const after = revisionItems(editor);
        if (after !== before) failures.push(`${command.type} ${place}: ${before} -> ${after}`);
        const accepted = editor.exec({ type: 'acceptRevision', id: 90 } as EditorCommand);
        if (!accepted.ok) failures.push(`${command.type} ${place}: accept by id refused`);
      }
    }
    expect(failures).toEqual([]);
  });

// Tracked typing at an edge inside the author's own insertion of this moment extends it.
test('tracked typing at an edge inside your own insertion extends it (suggesting)', () => {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const own = (...content: string[]) =>
    `<w:ins w:id="90" w:author="A" w:date="${now}">${content.join('')}</w:ins>`;
  const failures: string[] = [];
  // [body, the edge whose field character the insertion holds]
  for (const [body, edge] of [
    [p(begin, run('Entry 1')) + p(own(run('Pg'), end, run('Tail'))) + heading, 'end edge'],
    [p(own(run('Before'), begin)) + p(run('Entry 1')) + p(end) + heading, 'separator edge'],
  ] as const)
    for (const [place, selection] of edgeSelections(mount(body).surface!.session.part())) {
      if (!place.endsWith(edge)) continue;
      const editor = mount(body, 'suggesting');
      expect(editor.setEditingMode('suggesting').ok).toBe(true);
      editor.surface!.setSelection(selection);
      const typed = editor.exec({ type: 'insertText', text: 'ZQ' });
      if (!typed.ok) failures.push(`${place}: refused ${JSON.stringify(typed)}`);
      if (!typed.ok) continue;
      const written = bodyXml(editor);
      if (!fieldsWellFormed(written)) failures.push(`${place}: field characters no longer pair up`);
      if ((written.match(/<w:ins /g) ?? []).length !== 1) failures.push(`${place}: ${written}`);
      for (const toc of detectBodyTocs(editor.surface!.session.part())) {
        expect(editor.exec({ type: 'refreshToc', tocId: toc.id }).ok).toBe(true);
      }
      if (!bodyXml(editor).includes('ZQ')) failures.push(`${place}: a refresh dropped the text`);
    }
  expect(failures).toEqual([]);
});

// Any field whose characters span paragraphs follows the same rule as a TOC: text typed at its
// end edge goes after the end character, and a link that holds the end character and text past
// it divides there, so the typed text lands between the two parts of the link.
test('plain typing at the end edge of another field inside a link lands outside the field', () => {
  const quote =
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>QUOTE "x"</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>';
  const body =
    p(mark('Top'), run('Before'), quote, run('Line 1')) +
    p(link('Top', run('Pg'), end, run('Tail')));
  const editor = mount(body);
  const paragraphId = editor.surface!.session.part().root.children[0]!.children[1]!.id;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: 2 },
    head: { paragraphId, offset: 2 },
  });
  expect(editor.exec({ type: 'insertText', text: 'ZQ' }).ok).toBe(true);
  const written = bodyXml(editor);
  expect(fieldsWellFormed(written)).toBe(true);
  const closing = written.slice(written.lastIndexOf('<w:p '));
  const at = (needle: string) => closing.indexOf(needle);
  expect(at('ZQ')).toBeGreaterThan(at('w:fldCharType="end"'));
  expect(at('ZQ')).toBeLessThan(at('Tail'));
  // The link divides at the edge: one part keeps the end character, the other the text after it.
  expect(closing.match(/<w:hyperlink w:anchor="Top">/g)?.length).toBe(2);
  expect(closing.slice(at('w:fldCharType="end"'), at('ZQ'))).toContain('</w:hyperlink>');
  expect(closing.slice(at('ZQ'), at('Tail'))).toContain('<w:hyperlink w:anchor="Top">');
});
