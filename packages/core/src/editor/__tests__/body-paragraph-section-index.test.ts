import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '../../store/package/ooxml-tree.ts';
import {
  bodyParagraphSectionIndexForSession,
  bodySectionIndexTestRecorder,
  buildBodyParagraphSectionIndex,
} from '../body-paragraph-section-index.ts';
import { mountPaginatedSurface } from '../paginated-surface.ts';
import { bodySectionIndexOf } from '../section-scope.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const WARM_SIZES = [320, 2_560, 12_700] as const;

const para = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const sect = (w: string, type?: string) =>
  `<w:sectPr>${type ? `<w:type w:val="${type}"/>` : ''}<w:pgSz w:w="${w}" w:h="16838"/></w:sectPr>`;
const breakPara = (w: string, type?: string) => `<w:p><w:pPr>${sect(w, type)}</w:pPr></w:p>`;

function docxFromBody(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function middleParagraphId(part: OoxmlPart): string {
  const paragraphs: string[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'paragraph') {
      paragraphs.push(node.id);
      return;
    }
    if (node.kind === 'textValue') return;
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  return paragraphs[Math.floor(paragraphs.length / 2)]!;
}

function loadScaleDocument(paragraphCount: number): Uint8Array {
  const body = Array.from({ length: paragraphCount }, (_, index) =>
    para(`paragraph ${index}`)
  ).join('');
  return docxFromBody(body);
}

describe('body paragraph section index parity', () => {
  test('matches the walk oracle on multi-section fixtures', () => {
    const body = `${para('s0-a')}${breakPara('12240')}${para('s1-a')}${breakPara('15840')}${para('s2-a')}`;
    const part = load(body);
    const oracle = buildBodyParagraphSectionIndex(part);
    const opened = mountPaginatedSurface(document.createElement('div'), docxFromBody(body), {
      scale: 1,
    });
    if (!opened.ok) throw new Error(opened.reason);
    for (const [paragraphId, sectionIndex] of oracle) {
      expect(bodyParagraphSectionIndexForSession(opened.surface.session, part, paragraphId)).toBe(
        sectionIndex
      );
    }
  });

  test('returns null for non-body ids without rebuilding on every lookup', () => {
    const part = load(`${para('one')}${para('two')}`);
    const opened = mountPaginatedSurface(
      document.createElement('div'),
      docxFromBody(`${para('one')}${para('two')}`),
      { scale: 1 }
    );
    if (!opened.ok) throw new Error(opened.reason);
    const recorder = bodySectionIndexTestRecorder();
    recorder.reset();
    expect(
      bodyParagraphSectionIndexForSession(opened.surface.session, part, '/word/header1.xml#missing')
    ).toBeNull();
    expect(
      bodyParagraphSectionIndexForSession(opened.surface.session, part, '/word/footer2.xml#missing')
    ).toBeNull();
    expect(recorder.rebuilds).toBe(0);
    expect(recorder.traversalVisits).toBe(0);
  });

  for (const size of WARM_SIZES) {
    test(`${size} paragraphs: warm text edits perform zero rebuilds and zero traversals`, () => {
      const recorder = bodySectionIndexTestRecorder();
      recorder.reset();
      const bytes = loadScaleDocument(size);
      const container = document.createElement('div');
      const opened = mountPaginatedSurface(container, bytes, { scale: 1 });
      if (!opened.ok) throw new Error(opened.reason);
      const surface = opened.surface;
      const paragraphId = middleParagraphId(surface.session.part());
      bodySectionIndexOf(surface.session, paragraphId);
      expect(recorder.rebuilds).toBe(1);
      expect(recorder.traversalVisits).toBe(1);
      for (let index = 0; index < 3; index += 1) {
        surface.session.applyTreeOps([{ op: 'insertText', paragraphId, offset: 0, text: 'w' }]);
        bodySectionIndexOf(surface.session, paragraphId);
      }
      expect(recorder.rebuilds).toBe(1);
      expect(recorder.traversalVisits).toBe(1);
    });
  }

  test('structural insert invalidates the cached map', () => {
    const recorder = bodySectionIndexTestRecorder();
    recorder.reset();
    const bytes = loadScaleDocument(4);
    const container = document.createElement('div');
    const opened = mountPaginatedSurface(container, bytes, { scale: 1 });
    if (!opened.ok) throw new Error(opened.reason);
    const surface = opened.surface;
    const paragraphId = surface.session.paragraphIds()[0]!;
    bodySectionIndexOf(surface.session, paragraphId);
    surface.session.applyTreeOps([{ op: 'splitParagraph', paragraphId, offset: 1 }]);
    bodySectionIndexOf(surface.session, paragraphId);
    expect(recorder.rebuilds).toBe(2);
  });
});
