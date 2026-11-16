/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Records that must survive a review decision: format changes in locked controls, content with
// its own default namespace, pending revisions of every kind, very long inserted links, filled
// inline controls, headers that earlier sections gain, and style definitions.
import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  applyTreeOp,
  readOoxmlPackage,
  serializeOoxmlPart,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import { REVISION_LOCAL_NAMES } from '../../../../core/src/store/store/revision-container-presence.ts';
import {
  W_NS as W,
  buildDocx,
  solidPng,
} from '../../../../../scripts/compare-corpus/docx-builder.ts';
import { inlineImage, p } from '../../../../../scripts/compare-corpus/xml.ts';
import { compareDocuments } from '../index.ts';
import { REVISION_NAMES } from '../self-check.ts';

const DATE = new Date('2026-01-10T12:00:00Z');
const compare = (base: Uint8Array, revised: Uint8Array) =>
  compareDocuments(base, revised, { authorName: 'Test', date: DATE });

function compared(base: Uint8Array, revised: Uint8Array) {
  const result = compare(base, revised);
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result;
}

function mainPart(bytes: Uint8Array) {
  const read = readOoxmlPackage(bytes);
  if (!read.ok) throw new Error('unreadable result');
  return read.package.parts.get(read.package.mainDocumentPart)!;
}

function decided(bytes: Uint8Array, op: 'acceptAllRevisions' | 'rejectAllRevisions'): string {
  const result = applyTreeOp(mainPart(bytes), { op });
  if (!result.ok) throw new Error(`${op} refused`);
  return serializeOoxmlPart(result.part);
}

function find(node: OoxmlNode, localName: string): OoxmlNode | undefined {
  if (node.kind === 'textValue') return undefined;
  if (node.localName === localName) return node;
  for (const child of node.children ?? []) {
    const hit = find(child, localName);
    if (hit) return hit;
  }
  return undefined;
}

const namespaceOf = (node: OoxmlNode | undefined) =>
  node && node.kind !== 'textValue' ? node.namespaceUri : undefined;

test('the self-check resolves every revision element the store knows', () => {
  // A decision that leaves one of these behind is undecided; a missing name would pass it.
  for (const name of REVISION_LOCAL_NAMES) expect(REVISION_NAMES.has(name)).toBe(true);
});

test('a format change inside a locked content control is refused, not recorded', () => {
  const control = (rPr: string) =>
    `<w:p><w:sdt><w:sdtPr><w:id w:val="5"/><w:lock w:val="contentLocked"/></w:sdtPr>` +
    `<w:sdtContent><w:r>${rPr}<w:t>Locked words</w:t></w:r></w:sdtContent></w:sdt></w:p>` +
    p('After.');
  const result = compare(
    buildDocx({ body: control('') }),
    buildDocx({ body: control('<w:rPr><w:b/></w:rPr>') })
  );
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe('lockedContent');
});

test('pending table exception and cell merge revisions resolve in the compare', () => {
  const rows = [
    '<w:tr><w:tblPrEx><w:jc w:val="center"/><w:tblPrExChange w:id="9" w:author="A">' +
      '<w:tblPrEx/></w:tblPrExChange></w:tblPrEx><w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc></w:tr>',
    '<w:tr><w:tc><w:tcPr><w:cellMerge w:id="8" w:author="A" w:vMerge="cont"/></w:tcPr>' +
      '<w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc></w:tr>',
  ];
  for (const row of rows) {
    const doc = buildDocx({
      body: `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>${row}</w:tbl><w:p/>`,
    });
    const result = compared(doc, doc);
    const xml = serializeOoxmlPart(mainPart(result.bytes));
    expect(result.revisionCount).toBe(0);
    expect(xml).not.toMatch(/tblPrExChange|cellMerge/);
  }
});

test('content with its own default namespace keeps it through save and reopen', () => {
  const places = [
    (text: string) => `<w:p><x xmlns="urn:example">payload</x><w:r><w:t>${text}</w:t></w:r></w:p>`,
    (text: string) => `<w:p><w:r><x xmlns="urn:example">payload</x><w:t>${text}</w:t></w:r></w:p>`,
    (text: string) => `<x xmlns="urn:example">payload</x><w:p><w:r><w:t>${text}</w:t></w:r></w:p>`,
  ];
  for (const make of places) {
    const result = compared(
      buildDocx({ body: make('Old words') }),
      buildDocx({ body: make('New words') })
    );
    expect(namespaceOf(find(mainPart(result.bytes).root, 'x'))).toBe('urn:example');
  }
});

test('a link with one very long run inserts and deletes', () => {
  const long = 'a'.repeat(200_000);
  const short = buildDocx({ body: p('Start') });
  const linked = buildDocx({
    body: `<w:p><w:r><w:t>Start</w:t></w:r><w:hyperlink w:anchor="x"><w:r><w:t>${long}</w:t></w:r></w:hyperlink></w:p>`,
  });
  expect(compared(short, linked).revisionCount).toBeGreaterThan(0);
  expect(compared(linked, short).revisionCount).toBeGreaterThan(0);
});

test('a filled-in inline control keeps one control around its old and new text', () => {
  const control = (pr: string, text: string) =>
    `<w:p><w:r><w:t xml:space="preserve">Name: </w:t></w:r><w:sdt><w:sdtPr><w:id w:val="42"/>` +
    `<w:alias w:val="Name"/>${pr}</w:sdtPr><w:sdtContent><w:r><w:t>${text}</w:t></w:r>` +
    `</w:sdtContent></w:sdt></w:p>`;
  const result = compared(
    buildDocx({ body: control('<w:showingPlcHdr/>', 'Enter a name.') }),
    buildDocx({ body: control('', 'Jane Doe') })
  );
  expect(result.revisionCount).toBe(2);
  const out = serializeOoxmlPart(mainPart(result.bytes));
  expect(out.match(/<w:sdt>/g)).toHaveLength(1);
  const sdt = (xml: string) => /<w:sdtContent>([\s\S]*?)<\/w:sdtContent>/.exec(xml)?.[1];
  expect(sdt(decided(result.bytes, 'acceptAllRevisions'))).toBe('<w:r><w:t>Jane Doe</w:t></w:r>');
  expect(sdt(decided(result.bytes, 'rejectAllRevisions'))).toBe(
    '<w:r><w:t>Enter a name.</w:t></w:r>'
  );
});

test('many changed block controls compare in linear time', () => {
  const sdt = (i: number, text: string) =>
    `<w:sdt><w:sdtPr><w:id w:val="${100000 + i}"/><w:alias w:val="F${i}"/></w:sdtPr>` +
    `<w:sdtContent><w:p><w:r><w:t>${text} ${i}</w:t></w:r></w:p></w:sdtContent></w:sdt>`;
  const make = (n: number) => {
    let base = '';
    let revised = '';
    for (let i = 0; i < n; i++) {
      base += sdt(i, 'old');
      revised += sdt(i, 'new');
    }
    return [buildDocx({ body: base + p('end') }), buildDocx({ body: revised + p('end') })] as const;
  };
  const time = ([base, revised]: readonly [Uint8Array, Uint8Array]) => {
    const started = performance.now();
    const result = compared(base, revised);
    return { ms: performance.now() - started, revisions: result.revisionCount };
  };
  const small = make(1000);
  time(small);
  const first = time(small);
  const second = time(make(4000));
  expect(second.revisions).toBe(8000);
  // Four times the controls: about four times the time when linear, sixteen when quadratic,
  // as a pairing that scans every later control was. A ratio holds on a slow machine.
  expect(second.ms / Math.max(first.ms, 1)).toBeLessThan(8);
});

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const breakAfter = (text: string, refs = '') =>
  `<w:p><w:pPr><w:sectPr>${refs}<w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr>` +
  `<w:r><w:t>${text}</w:t></w:r></w:p>`;
const finalHeader = { default: p('Final header'), first: undefined, even: undefined };

function withFiles(bytes: Uint8Array, edit: (files: Record<string, Uint8Array>) => void) {
  const files = unzipSync(bytes);
  edit(files);
  return zipSync(files);
}

function replaceIn(files: Record<string, Uint8Array>, name: string, from: string, to: string) {
  files[name] = strToU8(strFromU8(files[name]!).replace(from, to));
}

test('a header an earlier section gains is a new part, not the shared one', () => {
  const original = buildDocx({ body: breakAfter('One') + p('Two'), headers: finalHeader });
  const revised = withFiles(
    buildDocx({ body: breakAfter('One', '§REF§') + p('Two'), headers: finalHeader }),
    (files) => {
      const doc = strFromU8(files['word/document.xml']!);
      const rId = /<w:headerReference w:type="default" r:id="([^"]+)"/.exec(doc)![1]!;
      files['word/document.xml'] = strToU8(
        doc.replace('§REF§', `<w:headerReference w:type="default" r:id="${rId}"/>`)
      );
    }
  );
  const result = compared(original, revised);
  const xml = serializeOoxmlPart(mainPart(result.bytes));
  const ids = [...xml.matchAll(/<w:headerReference\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
  // The shared part holds the final section's header without a revision; reject must not
  // delete it from the final section.
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
});

test('a section that ends in an unchanged block control still gains its header', () => {
  const section = breakAfter('One');
  const first = `<w:sdt><w:sdtPr><w:id w:val="7"/></w:sdtPr><w:sdtContent>${section}</w:sdtContent></w:sdt>`;
  const original = buildDocx({
    body: first + breakAfter('Two') + p('Three'),
    headers: finalHeader,
  });
  const revised = withFiles(
    buildDocx({
      body:
        first +
        breakAfter('Two', '<w:headerReference w:type="default" r:id="rIdX9"/>') +
        p('Three'),
      headers: finalHeader,
    }),
    (files) => {
      files['word/header9.xml'] = strToU8(`<w:hdr ${NS}>${p('Section two header')}</w:hdr>`);
      replaceIn(
        files,
        'word/_rels/document.xml.rels',
        '</Relationships>',
        '<Relationship Id="rIdX9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header9.xml"/></Relationships>'
      );
      replaceIn(
        files,
        '[Content_Types].xml',
        '</Types>',
        '<Override PartName="/word/header9.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>'
      );
    }
  );
  expect(compared(original, revised).revisionCount).toBe(1);
});

/** Gives the first section its own header part, `word/header9.xml`, with `body` in it. */
function withEarlierHeader(bytes: Uint8Array, body: string): Uint8Array {
  return withFiles(bytes, (files) => {
    files['word/header9.xml'] = strToU8(`<w:hdr ${NS}>${body}</w:hdr>`);
    replaceIn(
      files,
      'word/_rels/document.xml.rels',
      '</Relationships>',
      '<Relationship Id="rIdX9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header9.xml"/></Relationships>'
    );
    replaceIn(
      files,
      '[Content_Types].xml',
      '</Types>',
      '<Override PartName="/word/header9.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>'
    );
  });
}

test('a locked change in a header only an earlier section shows is refused', () => {
  const locked = (rPr: string) =>
    `<w:p><w:sdt><w:sdtPr><w:id w:val="5"/><w:lock w:val="contentLocked"/></w:sdtPr>` +
    `<w:sdtContent><w:r>${rPr}<w:t>Locked header</w:t></w:r></w:sdtContent></w:sdt></w:p>`;
  const body = breakAfter('One', '<w:headerReference w:type="default" r:id="rIdX9"/>') + p('Two');
  const make = (rPr: string) =>
    withEarlierHeader(buildDocx({ body, headers: finalHeader }), locked(rPr));
  const result = compare(make(''), make('<w:rPr><w:b/></w:rPr>'));
  expect(result).toMatchObject({ ok: false, reason: 'lockedContent' });
});

test('two images whose relationship closures are too large never compare as equal', () => {
  const chained = (last: string) =>
    withFiles(
      buildDocx({
        body: `<w:p><w:r>${inlineImage('rIdImg', 1)}</w:r></w:p>` + p('After.'),
        media: [{ name: 'image1.png', bytes: solidPng(1, 1, [0, 0, 0]), rId: 'rIdImg' }],
      }),
      (files) => {
        let rels = '';
        for (let i = 1; i <= 300; i++) {
          rels += `<Relationship Id="rId${i}" Type="urn:example:part" Target="../extra/c${i}.bin"/>`;
          files[`word/extra/c${i}.bin`] = strToU8(i === 300 ? last : String(i));
        }
        files['word/media/_rels/image1.png.rels'] = strToU8(
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`
        );
      }
    );
  // The closures differ only past the bound, so the compare cannot prove the images equal.
  expect(compared(chained('one'), chained('two')).changed).toBe(true);
});

const STYLE = (color: string) =>
  `<w:style w:type="paragraph" w:customStyle="1" w:styleId="Mine"><w:name w:val="Mine"/>` +
  `<w:rPr><w:color w:val="${color}"/></w:rPr></w:style>`;
const UNUSED = (size: number) =>
  `<w:style w:type="paragraph" w:customStyle="1" w:styleId="Unused"><w:name w:val="Unused"/>` +
  `<w:rPr><w:sz w:val="${size}"/></w:rPr></w:style>`;
const styled = p('Styled words', '<w:pStyle w:val="Mine"/>');

function stylesOf(bytes: Uint8Array): string {
  return strFromU8(unzipSync(bytes)['word/styles.xml']!);
}

test('a style that only the definitions change takes the revised definition', () => {
  const result = compared(
    buildDocx({ body: styled, extraStyles: STYLE('FF0000') }),
    buildDocx({ body: styled, extraStyles: STYLE('0000FF') })
  );
  expect(result.changed).toBe(true);
  expect(result.revisionCount).toBe(0);
  const reopened = readOoxmlPackage(result.bytes);
  expect(reopened.ok).toBe(true);
  expect(stylesOf(result.bytes)).toContain('w:val="0000FF"');
  expect(stylesOf(result.bytes)).not.toContain('w:val="FF0000"');
});

test('rejecting every change keeps the revised style definitions', () => {
  const result = compared(
    buildDocx({ body: styled + p('Old text'), extraStyles: STYLE('FF0000') }),
    buildDocx({ body: styled + p('New text'), extraStyles: STYLE('0000FF') })
  );
  expect(result.revisionCount).toBeGreaterThan(0);
  // A decision changes only the main story; the definitions part is not a revision.
  decided(result.bytes, 'rejectAllRevisions');
  expect(stylesOf(result.bytes)).toContain('w:val="0000FF"');
});

test('a changed definition of an unused style still counts as a change', () => {
  const result = compared(
    buildDocx({ body: p('Same'), extraStyles: UNUSED(20) }),
    buildDocx({ body: p('Same'), extraStyles: UNUSED(40) })
  );
  expect(result.changed).toBe(true);
  expect(stylesOf(result.bytes)).toContain('<w:sz w:val="40"/>');
});

test('equal definitions leave the original styles part as it was', () => {
  const doc = buildDocx({ body: styled, extraStyles: STYLE('FF0000') + UNUSED(20) });
  const result = compared(doc, doc);
  expect(result.changed).toBe(false);
  expect(stylesOf(result.bytes)).toBe(stylesOf(doc));
});

test('equal definitions stay as they were when only the text changes', () => {
  const styles = STYLE('FF0000') + UNUSED(20);
  const base = buildDocx({ body: styled + p('Old words'), extraStyles: styles });
  const result = compared(base, buildDocx({ body: styled + p('New words'), extraStyles: styles }));
  // Modeled parts are written in normal form, so the parts compare as read, not as bytes.
  const stylesPart = (bytes: Uint8Array) => {
    const read = readOoxmlPackage(bytes);
    if (!read.ok) throw new Error('unreadable');
    return serializeOoxmlPart(read.package.parts.get('/word/styles.xml')!);
  };
  expect(stylesPart(result.bytes)).toBe(stylesPart(base));
});

test('a style that names a list takes the revised list, by its output id', () => {
  const listStyle =
    '<w:style w:type="paragraph" w:customStyle="1" w:styleId="Listed"><w:name w:val="Listed"/>' +
    '<w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>';
  const numbering = (format: string) =>
    `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">` +
    `<w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="%1."/></w:lvl>` +
    `</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
  const body = p('Item', '<w:pStyle w:val="Listed"/>');
  const result = compared(
    buildDocx({ body, extraStyles: listStyle, numbering: numbering('decimal') }),
    buildDocx({ body, extraStyles: listStyle, numbering: numbering('lowerLetter') })
  );
  const files = unzipSync(result.bytes);
  const numberingXml = strFromU8(files['word/numbering.xml']!);
  const id = /w:styleId="Listed"[\s\S]*?<w:numId w:val="(\d+)"/.exec(stylesOf(result.bytes))![1];
  const abstract = new RegExp(
    `<w:num\\b[^>]*w:numId="${id}"[^>]*><w:abstractNumId w:val="(\\d+)"`
  ).exec(numberingXml)![1];
  const level = new RegExp(
    `<w:abstractNum\\b[^>]*w:abstractNumId="${abstract}"[\\s\\S]*?<w:numFmt w:val="(\\w+)"`
  ).exec(numberingXml)![1];
  expect(level).toBe('lowerLetter');
});

test('a style a list of the original links to is not added, so the list keeps its meaning', () => {
  // The original's list links to style S, which it does not define.
  const numbering =
    `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0">` +
    `<w:numStyleLink w:val="S"/></w:abstractNum>` +
    `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
  const numberingStyle =
    '<w:style w:type="numbering" w:customStyle="1" w:styleId="S"><w:name w:val="S"/>' +
    '<w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>';
  const result = compared(
    buildDocx({
      body: p('Old words') + p('Item', '<w:numPr><w:numId w:val="1"/></w:numPr>'),
      numbering,
    }),
    buildDocx({
      body: p('New words') + p('Item', '<w:numPr><w:numId w:val="1"/></w:numPr>'),
      numbering,
      extraStyles: numberingStyle,
    })
  );
  expect(stylesOf(result.bytes)).not.toContain('w:styleId="S"');
});

test('a revised style keeps the namespaces its own content declares', () => {
  const declared = (uri: string) =>
    `<w:style xmlns:x="${uri}" w:type="paragraph" w:customStyle="1" w:styleId="Mine">` +
    `<w:name w:val="Mine"/><w:rPr><w:color w:val="${uri.endsWith('new') ? '0000FF' : 'FF0000'}"/>` +
    `</w:rPr><x:payload/></w:style>`;
  const result = compared(
    buildDocx({ body: styled, extraStyles: declared('urn:old') }),
    buildDocx({ body: styled, extraStyles: declared('urn:new') })
  );
  const read = readOoxmlPackage(result.bytes);
  if (!read.ok) throw new Error('unreadable result');
  const styles = [...read.package.parts.values()].find((part) => part.name === '/word/styles.xml')!;
  expect(namespaceOf(find(styles.root, 'payload'))).toBe('urn:new');
});

test('tracked-changes protection refuses every compare, tracked differences included', () => {
  const settings = '<w:documentProtection w:edit="trackedChanges" w:enforcement="1"/>';
  const control = (alias: string, words: string) =>
    `<w:sdt><w:sdtPr><w:id w:val="42"/><w:alias w:val="${alias}"/></w:sdtPr>` +
    `<w:sdtContent>${p(words)}</w:sdtContent></w:sdt>${p('After.')}`;
  const cases = [
    // Only tracked differences: text in a control.
    [{ body: control('A', 'Old words') }, { body: control('A', 'New words') }],
    // A style definition and a control property, which have no tracked form.
    [
      { body: styled, extraStyles: STYLE('FF0000') },
      { body: styled, extraStyles: STYLE('0000FF') },
    ],
    [{ body: control('A', 'Same') }, { body: control('B', 'Same') }],
  ] as const;
  for (const [base, revised] of cases) {
    expect(compare(buildDocx({ ...base, settings }), buildDocx(revised))).toMatchObject({
      ok: false,
      code: 'protected',
    });
    // Without the protection each one compares.
    expect(compared(buildDocx(base), buildDocx(revised)).changed).toBe(true);
  }
});

test('a drawing path command named like a move is not a revision', () => {
  const path =
    '<w:p><w:r><a:path xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    '<a:moveTo><a:pt x="1" y="2"/></a:moveTo></a:path></w:r></w:p>';
  const result = compared(
    buildDocx({ body: path + p('Old words') }),
    buildDocx({ body: path + p('New words') })
  );
  expect(result.revisionCount).toBe(2);
});
