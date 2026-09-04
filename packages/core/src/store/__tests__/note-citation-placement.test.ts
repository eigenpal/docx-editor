// Where a note citation lands when the caret sits inside a nested inline container.
//
// Split out of `note-lifecycle.test.ts`: these all ask one question — which wrapper keeps
// the citation, and which one it must escape — and they share one fixture shape.
import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8, unzipSync } from 'fflate';
import {
  applyNoteLifecycleOp,
  canonicalOoxmlFingerprint,
  collectNoteReferences,
  collectPackageNoteReferences,
  createNoteReferenceScanBudget,
  diagnoseNoteReferences,
  findNoteById,
  isNormalNote,
  MAX_NOTE_REFERENCE_PARTS,
  noteIdOf,
  noteKindOf,
  noteReferenceKindOf,
  readOoxmlPackage,
  readOoxmlPart,
  resolveNotesPart,
  serializeOoxmlPart,
  writeOoxmlPackage,
  type OoxmlPackage,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/index.ts';
import { diffSemanticDigests, semanticDigest } from '../package/ooxml-digest.ts';
import { TreePackageStore } from '../store/tree-package-store.ts';
import { paragraphTextOf } from '../store/tree-ops.ts';
import {
  authoredDocumentFootnoteProperties,
  resolveFootnoteProperties,
  settingsPartOf,
} from '../package/note-properties.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = `${R}/officeDocument`;

function build(options: {
  readonly body?: string;
  readonly footnotes?: string;
  readonly endnotes?: string;
  readonly settings?: string;
  readonly rels?: string;
  readonly overrides?: string;
}): Uint8Array {
  const hasFn = options.footnotes !== undefined;
  const hasEn = options.endnotes !== undefined;
  const rels =
    options.rels ??
    [
      hasFn ? `<Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/>` : '',
      hasEn ? `<Relationship Id="rIdEn" Type="${R}/endnotes" Target="endnotes.xml"/>` : '',
      options.settings
        ? `<Relationship Id="rIdSet" Type="${R}/settings" Target="settings.xml"/>`
        : '',
    ].join('');
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (hasFn
          ? '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>'
          : '') +
        (hasEn
          ? '<Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/>'
          : '') +
        (options.settings
          ? '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
          : '') +
        (options.overrides ?? '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        (options.body ?? '<w:p><w:r><w:t>Hello</w:t></w:r></w:p><w:sectPr/>') +
        (options.body?.includes('sectPr') ? '' : '<w:sectPr/>') +
        '</w:body></w:document>'
    ),
  };
  if (rels) {
    entries['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}">${rels}</Relationships>`
    );
  }
  if (hasFn) {
    entries['word/footnotes.xml'] = strToU8(
      `<w:footnotes xmlns:w="${W}">${options.footnotes}</w:footnotes>`
    );
  }
  if (hasEn) {
    entries['word/endnotes.xml'] = strToU8(
      `<w:endnotes xmlns:w="${W}">${options.endnotes}</w:endnotes>`
    );
  }
  if (options.settings) entries['word/settings.xml'] = strToU8(options.settings);
  return zipSync(entries);
}

function load(bytes: Uint8Array): OoxmlPackage {
  const result = readOoxmlPackage(bytes);
  if (!result.ok) throw new Error(result.reason);
  return result.package;
}

function openStore(bytes: Uint8Array): TreePackageStore {
  const pkg = load(bytes);
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) throw new Error('no main');
  return new TreePackageStore(pkg, main);
}

function mainPartOf(pkg: OoxmlPackage): OoxmlPart {
  return pkg.parts.get(pkg.mainDocumentPart)!;
}

function firstParagraphId(pkg: OoxmlPackage): string {
  const main = mainPartOf(pkg);
  const body = main.root.children.find((child) => child.kind === 'body')!;
  const p = body.children.find((child) => child.kind === 'paragraph')!;
  return p.id;
}

const seededNotes =
  `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
  `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
  `<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t>one</w:t></w:r></w:p></w:footnote>` +
  `<w:footnote w:id="3"><w:p><w:r><w:t>three</w:t></w:r></w:p></w:footnote>`;

/** The ancestors of the first footnote citation under `root`, or null when there is none. */
function citationAncestors(root: OoxmlNode): OoxmlNode[] | null {
  const path: OoxmlNode[] = [];
  const visit = (node: OoxmlNode, ancestors: OoxmlNode[]): boolean => {
    if (node.kind === 'textValue') return false;
    if (node.localName === 'footnoteReference') {
      for (const ancestor of ancestors) path.push(ancestor);
      return true;
    }
    ancestors.push(node);
    for (const child of node.children) if (visit(child, ancestors)) return true;
    ancestors.pop();
    return false;
  };
  return visit(root, []) ? path : null;
}

describe('note citation placement in nested containers', () => {
  test('a citation escapes only the revision inside each neutral outer wrapper', () => {
    const runs = '<w:r><w:t>A</w:t></w:r><w:r><w:t>B</w:t></w:r>';
    const revision = `<w:ins w:id="1" w:author="A">${runs}</w:ins>`;
    const cases = [
      { outer: 'hyperlink', xml: `<w:hyperlink w:anchor="mark">${revision}</w:hyperlink>` },
      { outer: 'smartTag', xml: `<w:smartTag>${revision}</w:smartTag>` },
      {
        outer: 'sdt',
        xml: `<w:sdt><w:sdtPr><w:id w:val="7"/></w:sdtPr><w:sdtContent>${revision}</w:sdtContent></w:sdt>`,
      },
    ];
    for (const sample of cases) {
      const store = openStore(build({ body: `<w:p>${sample.xml}</w:p>` }));
      const paragraphId = firstParagraphId(store.currentPackage());
      expect(
        store.applyLifecycleOp({ op: 'insertNote', noteKind: 'footnote', paragraphId, offset: 1 })
          .ok
      ).toBe(true);
      const main = mainPartOf(store.currentPackage());
      const path = citationAncestors(main.root);
      expect(path).not.toBeNull();
      expect(path!.some((node) => node.localName === sample.outer)).toBe(true);
      expect(path!.some((node) => node.kind === 'revisionInsert')).toBe(false);
      expect(paragraphTextOf(main, paragraphId)).toBe('A\u{fffc}B');
    }
  });

  // The caret sits INSIDE one `w:t` under a wrapper, not at a segment boundary, so the run
  // hosting the split is not a direct paragraph child. That used to refuse a rendered offset.
  for (const outer of ['hyperlink', 'smartTag'] as const) {
    test(`a citation lands mid-word inside a ${outer}`, () => {
      const run = '<w:r><w:t>Word</w:t></w:r>';
      const inner = outer === 'hyperlink' ? `w:anchor="mark"` : '';
      const store = openStore(
        build({ body: `<w:p><w:${outer} ${inner}>${run}</w:${outer}></w:p>` })
      );
      const paragraphId = firstParagraphId(store.currentPackage());
      const op = { op: 'insertNote', noteKind: 'footnote', paragraphId, offset: 2 } as const;
      expect(store.applyLifecycleOp(op).ok).toBe(true);
      const main = mainPartOf(store.currentPackage());
      expect(citationAncestors(main.root)?.some((node) => node.localName === outer)).toBe(true);
      expect(paragraphTextOf(main, paragraphId)).toBe('Wo\u{fffc}rd');
    });
  }

  test('a citation splits one revised run at its actual child boundary', () => {
    const store = openStore(
      build({
        body:
          '<w:p><w:ins w:id="1" w:author="A"><w:r>' +
          '<w:t>A</w:t><w:t>B</w:t></w:r></w:ins></w:p>',
      })
    );
    const paragraphId = firstParagraphId(store.currentPackage());
    const result = store.applyLifecycleOp({
      op: 'insertNote',
      noteKind: 'footnote',
      paragraphId,
      offset: 1,
    });
    expect(result.ok).toBe(true);

    const main = store.currentPackage().parts.get(store.currentPackage().mainDocumentPart)!;
    expect(paragraphTextOf(main, paragraphId)).toBe('A\u{fffc}B');
    const xml = serializeOoxmlPart(main);
    const firstRevision = xml.indexOf('<w:ins');
    const firstRevisionEnd = xml.indexOf('</w:ins>', firstRevision);
    const citation = xml.indexOf('<w:footnoteReference');
    const secondRevision = xml.indexOf('<w:ins', firstRevision + 1);
    expect(firstRevisionEnd).toBeLessThan(citation);
    expect(citation).toBeLessThan(secondRevision);
    expect(xml.slice(firstRevision, firstRevisionEnd)).toContain('>A<');
    expect(xml.slice(secondRevision)).toContain('>B<');
  });

  test('a control inside a revision moves whole to the citation boundary', () => {
    const store = openStore(
      build({
        body:
          '<w:p><w:ins w:id="1" w:author="A"><w:sdt>' +
          '<w:sdtPr><w:id w:val="7"/><w:lock w:val="sdtLocked"/></w:sdtPr>' +
          '<w:sdtContent><w:r><w:t>A</w:t></w:r><w:r><w:t>B</w:t></w:r>' +
          '</w:sdtContent></w:sdt></w:ins></w:p>',
      })
    );
    const paragraphId = firstParagraphId(store.currentPackage());
    const result = store.applyLifecycleOp({
      op: 'insertNote',
      noteKind: 'footnote',
      paragraphId,
      offset: 1,
    });
    expect(result.ok).toBe(true);
    const main = store.currentPackage().parts.get(store.currentPackage().mainDocumentPart)!;
    const controls: OoxmlNode[] = [];
    const collect = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      if (node.kind === 'contentControl') controls.push(node);
      for (const child of node.children) collect(child);
    };
    collect(main.root);
    expect(controls).toHaveLength(1);
    for (const control of controls) {
      expect(
        control.kind !== 'textValue' &&
          control.children.some((child) => child.kind === 'contentControlProperties')
      ).toBe(true);
    }
  });
});
