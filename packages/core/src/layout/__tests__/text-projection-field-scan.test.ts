// The projection token of a paragraph depends on document properties only through a field.
// Finding that dependency projects the paragraph's fields, so a paragraph that holds no field
// must not be projected, and one that holds a field must keep its dependency.

import { expect, test } from 'bun:test';
import {
  readOoxmlPart,
  type DocumentProperties,
  type HeadlessDocumentView,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import {
  createStoryProjectionDependencies,
  projectionDescriptorTestRecorder,
} from '../text-projection-epoch.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const PART = '/word/document.xml';

const complexField = (instruction: string) =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  `<w:r><w:instrText> ${instruction} </w:instrText></w:r>` +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

function paragraphsOf(body: string): OoxmlNode[] {
  const parsed = readOoxmlPart(`<w:body xmlns:w="${W}">${body}</w:body>`, {
    name: PART,
    contentType: 'application/xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part.root.children.filter((child) => child.kind === 'paragraph');
}

function dependencies(properties: () => DocumentProperties) {
  let revision = 1;
  const pkg = { relationships: new Map(), externalTargets: [] };
  const view = {
    packageRevision: () => revision,
    currentPackage: () => pkg,
    documentProperties: properties,
  } as unknown as HeadlessDocumentView;
  return {
    token: createStoryProjectionDependencies(view, () => () => null).tokenForParagraphForPart,
    /** A property change publishes a new package revision. */
    bump: () => {
      revision += 1;
    },
  };
}

test('paragraphs without a field are not projected to find property fields', () => {
  const plain = paragraphsOf(
    Array.from(
      { length: 50 },
      (_, index) =>
        `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Paragraph ${index}</w:t></w:r>` +
        '<w:r><w:tab/><w:t xml:space="preserve"> TITLE </w:t></w:r></w:p>'
    ).join('')
  );
  const { token } = dependencies(() => ({ title: 'A title' }));
  const recorder = projectionDescriptorTestRecorder();
  recorder.reset();
  for (const paragraph of plain) expect(token(PART, paragraph)).toBe('');
  expect(recorder.fieldProjections).toBe(0);
});

test('a property field keeps its dependency, in each field form', () => {
  const [complex, simple, cached, other, nested] = paragraphsOf(
    `<w:p>${complexField('TITLE')}</w:p>` +
      '<w:p><w:fldSimple w:instr=" AUTHOR "/></w:p>' +
      '<w:p><w:fldSimple w:instr=" TITLE "><w:r><w:t>Saved</w:t></w:r></w:fldSimple></w:p>' +
      `<w:p>${complexField('PAGE')}</w:p>` +
      `<w:p><w:ins w:id="1" w:author="a"><w:r><w:t>x</w:t></w:r>${complexField('SUBJECT')}</w:ins></w:p>`
  );
  let properties: DocumentProperties = { title: 'One', creator: 'Ann', subject: 'S' };
  const { token, bump } = dependencies(() => properties);
  const recorder = projectionDescriptorTestRecorder();
  recorder.reset();
  const before = [complex, simple, cached, other, nested].map((p) => token(PART, p!));
  // Each paragraph that holds a field is projected once; the answer is kept per node.
  expect(recorder.fieldProjections).toBe(5);
  expect(before[0]).not.toBe('');
  expect(before[1]).not.toBe('');
  expect(before[4]).not.toBe('');
  // A saved result paints as saved, and a page field reads no property: no dependency.
  expect(before[2]).toBe('');
  expect(before[3]).toBe('');

  properties = { title: 'Two', creator: 'Bob', subject: 'T' };
  bump();
  const after = [complex, simple, cached, other, nested].map((p) => token(PART, p!));
  expect(recorder.fieldProjections).toBe(5);
  expect(after[0]).not.toBe(before[0]);
  expect(after[1]).not.toBe(before[1]);
  expect(after[4]).not.toBe(before[4]);
  expect(after[2]).toBe('');
  expect(after[3]).toBe('');
});

test('a field that began in an earlier paragraph gives the later paragraphs no dependency', () => {
  // A complex field can span paragraphs. The projection reads one paragraph at a time, so
  // only the paragraph that holds the field begin can paint the property value.
  const [begin, instruction, end] = paragraphsOf(
    '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText> TITLE </w:instrText></w:r></w:p>' +
      '<w:p><w:r><w:instrText> TITLE </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r></w:p>' +
      '<w:p><w:r><w:t>result</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
  );
  const { token } = dependencies(() => ({ title: 'A title' }));
  const recorder = projectionDescriptorTestRecorder();
  recorder.reset();
  token(PART, begin!);
  expect(recorder.fieldProjections).toBe(1);
  expect(token(PART, instruction!)).toBe('');
  expect(token(PART, end!)).toBe('');
  expect(recorder.fieldProjections).toBe(1);
});

test('a property field inside a nested text box paragraph keeps the host dependency', () => {
  const V = 'urn:schemas-microsoft-com:vml';
  const [host] = paragraphsOf(
    `<w:p><w:r><w:t>host</w:t></w:r><w:r><w:pict><v:shape xmlns:v="${V}"><v:textbox>` +
      `<w:txbxContent><w:p>${complexField('TITLE')}</w:p></w:txbxContent>` +
      '</v:textbox></v:shape></w:pict></w:r></w:p>'
  );
  let properties: DocumentProperties = { title: 'One' };
  const { token, bump } = dependencies(() => properties);
  const before = token(PART, host!);
  expect(before).not.toBe('');
  properties = { title: 'Two' };
  bump();
  expect(token(PART, host!)).not.toBe(before);
});
