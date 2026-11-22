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
import { validateRasterHeader, type ImageDecodePort } from '../../store/package/image-resources.ts';
import { tocParagraphRanges } from '../surface-toc-ranges.ts';

const run = (s: string) => `<w:r><w:t>${s}</w:t></w:r>`;
const begin =
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>TOC \\o "1-1" \\h</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>';
const end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const p = (...content: string[]) => `<w:p>${content.join('')}</w:p>`;
const heading = '<w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:r><w:t>Heading</w:t></w:r></w:p>';
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
    count(/<w:hyperlink /g),
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

const editors: DocxEditorInstance[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function mount(body: string): DocxEditorInstance {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: docx(body),
    author: 'A',
    imageDecodePort,
    modules: [stubReviewModule()],
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

  for (const [command, probe] of COMMANDS) {
    test(`${shape}: ${command.type} at every edge stays outside the field`, async () => {
      const places = edgeSelections(mount(body).surface!.session.part());
      expect(places.length).toBeGreaterThan(0);
      const failures: string[] = [];
      for (const [place, selection] of places) {
        // A picture over selected text is refused anywhere (it replaces a selected drawing),
        // so only carets ask where a picture goes.
        const caret = selection.anchor.offset === selection.head.offset;
        if (command.type === 'insertImage' && !caret) continue;
        const editor = mount(body);
        const surface = editor.surface!;
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
