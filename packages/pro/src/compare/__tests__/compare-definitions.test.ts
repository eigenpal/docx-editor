/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// How a compare carries revised lists and styles into the original's definitions, and the
// protection settings it reads before it writes anything.
import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { W_NS, buildDocx } from '../../../../../scripts/compare-corpus/docx-builder.ts';
import { listPr, p } from '../../../../../scripts/compare-corpus/xml.ts';
import { compareDocuments } from '../index.ts';

const DATE = new Date('2026-01-10T12:00:00Z');
const compare = (base: Uint8Array, revised: Uint8Array, detectFormatChanges = true) =>
  compareDocuments(base, revised, { authorName: 'Test', date: DATE, detectFormatChanges });

function files(base: Uint8Array, revised: Uint8Array) {
  const result = compare(base, revised);
  if (!result.ok) throw new Error(result.message);
  const zip = unzipSync(result.bytes);
  const text: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(zip)) text[name] = strFromU8(bytes);
  return text;
}

const level = (format: string) =>
  `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="%1."/></w:lvl>`;
const abstract = (id: number, format = 'decimal', nsid = 'AAAA0000') =>
  `<w:abstractNum w:abstractNumId="${id}"><w:nsid w:val="${nsid}"/>` +
  `<w:multiLevelType w:val="hybridMultilevel"/>${level(format)}</w:abstractNum>`;
const instance = (id: number | string, abstractId: number) =>
  `<w:num w:numId="${id}"><w:abstractNumId w:val="${abstractId}"/></w:num>`;
const numbering = (inner: string) => `<w:numbering xmlns:w="${W_NS}">${inner}</w:numbering>`;
const twoLists = p('a', listPr(1)) + p('b', listPr(1)) + p('c', listPr(2)) + p('d', listPr(2));

/** The list id each paragraph holds after the compare, ignoring recorded old properties. */
function listIds(document: string): Map<string, string> {
  const ids = new Map<string, string>();
  for (const [paragraph] of document.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
    const current = paragraph.replace(/<w:pPrChange\b[\s\S]*?<\/w:pPrChange>/g, '');
    const text = [...current.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
    const id = /<w:numId w:val="(\d+)"/.exec(current)?.[1];
    if (id) ids.set(text, id);
  }
  return ids;
}

const abstractOf = (list: string, id: string) =>
  new RegExp(`<w:num\\b[^>]*w:numId="${id}"[^>]*>\\s*<w:abstractNumId w:val="(\\d+)"`).exec(
    list
  )?.[1];

test('revised lists kept apart stay apart when the original shares one definition', () => {
  const base = buildDocx({
    body: twoLists + p('Original.'),
    numbering: numbering(abstract(0) + instance(1, 0) + instance(2, 0)),
  });
  const revised = buildDocx({
    body: twoLists + p('Revised.'),
    numbering: numbering(
      abstract(0) + abstract(1, 'decimal', 'BBBB0000') + instance(1, 0) + instance(2, 1)
    ),
  });
  const out = files(base, revised);
  const ids = listIds(out['word/document.xml']!);
  const list = out['word/numbering.xml']!;
  expect(ids.get('a')).toBe(ids.get('b'));
  expect(abstractOf(list, ids.get('a')!)).toBeDefined();
  expect(abstractOf(list, ids.get('a')!)).not.toBe(abstractOf(list, ids.get('c')!));
});

test('revised lists that share one definition share it in the output', () => {
  const base = buildDocx({
    body: twoLists + p('Original.'),
    numbering: numbering(
      abstract(0) + abstract(1, 'decimal', 'BBBB0000') + instance(1, 0) + instance(2, 1)
    ),
  });
  const revised = buildDocx({
    body: twoLists + p('Revised.'),
    numbering: numbering(abstract(0) + instance(1, 0) + instance(2, 0)),
  });
  const out = files(base, revised);
  const ids = listIds(out['word/document.xml']!);
  const list = out['word/numbering.xml']!;
  expect(abstractOf(list, ids.get('a')!)).toBeDefined();
  expect(abstractOf(list, ids.get('a')!)).toBe(abstractOf(list, ids.get('c')!));
});

test('a list defined through a list style compares by the style definition', () => {
  const listStyle =
    '<w:style w:type="numbering" w:styleId="LS"><w:name w:val="LS"/>' +
    '<w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>';
  const linked = (format: string) =>
    numbering(
      '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="multilevel"/>' +
        `<w:styleLink w:val="LS"/>${level(format)}</w:abstractNum>` +
        '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="multilevel"/>' +
        '<w:numStyleLink w:val="LS"/></w:abstractNum>' +
        instance(1, 0) +
        instance(2, 1)
    );
  const body = p('a', listPr(2)) + p('b', listPr(2));
  const base = buildDocx({ body, extraStyles: listStyle, numbering: linked('bullet') });
  const revised = buildDocx({ body, extraStyles: listStyle, numbering: linked('decimal') });
  const out = files(base, revised);
  const id = listIds(out['word/document.xml']!).get('a');
  expect(id).not.toBe('2');
  const list = out['word/numbering.xml']!;
  const copy = abstractOf(list, id!);
  const definition = new RegExp(
    `<w:abstractNum\\b[^>]*w:abstractNumId="${copy}"[\\s\\S]*?</w:abstractNum>`
  ).exec(list)?.[0];
  expect(definition).toContain('w:numFmt w:val="decimal"');
  expect(definition).not.toContain('numStyleLink');
  // The same linked list in both documents keeps its id.
  expect(listIds(files(revised, revised)['word/document.xml']!).get('a')).toBe('2');
});

test('new list ids stay small when the original holds a huge id', () => {
  const huge = '9007199254740991';
  const base = buildDocx({
    body: p('x'),
    numbering: numbering(abstract(0, 'bullet') + instance(huge, 0)),
  });
  const revised = buildDocx({
    body: p('a', listPr(1)) + p('b', listPr(2)),
    numbering: numbering(
      abstract(0) + abstract(1, 'lowerLetter', 'BBBB0000') + instance(1, 0) + instance(2, 1)
    ),
  });
  const out = files(base, revised);
  const ids = listIds(out['word/document.xml']!);
  for (const id of [ids.get('a')!, ids.get('b')!]) {
    expect(Number.isSafeInteger(Number(id))).toBe(true);
    expect(id).not.toBe(huge);
    expect(abstractOf(out['word/numbering.xml']!, id)).toBeDefined();
  }
  expect(ids.get('a')).not.toBe(ids.get('b'));
});

test('a revised default style never becomes a second default', () => {
  const standard =
    '<w:style w:type="paragraph" w:default="1" w:styleId="Standard"><w:name w:val="Standard"/>' +
    '<w:rPr><w:sz w:val="40"/></w:rPr></w:style>';
  const out = files(
    buildDocx({ body: p('hello there') }),
    buildDocx({ body: p('hello there world'), extraStyles: standard })
  );
  const defaults = [...out['word/styles.xml']!.matchAll(/<w:style\b[^>]*w:default="1"[^>]*>/g)];
  const paragraphDefaults = defaults.filter((match) => match[0].includes('w:type="paragraph"'));
  expect(paragraphDefaults.map((match) => /w:styleId="([^"]+)"/.exec(match[0])?.[1])).toEqual([
    'Normal',
  ]);
});

test('tracked-changes protection refuses with and without format detection', () => {
  const protection = '<w:documentProtection w:edit="trackedChanges" w:enforcement="1"/>';
  const base = buildDocx({ body: p('hello there') + p('two'), settings: protection });
  const revised = buildDocx({
    body: p('hello there', '<w:jc w:val="center"/>', '<w:b/>') + p('two'),
  });
  for (const detect of [true, false]) {
    const result = compare(base, revised, detect);
    expect(result.ok ? '' : result.code).toBe('protected');
  }
});

test('protection is read from the settings part the main document names', () => {
  const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
  const RELS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const base = unzipSync(
    buildDocx({
      body: p('hello'),
      settings: '<w:documentProtection w:edit="readOnly" w:enforcement="1"/>',
    })
  );
  // A glossary settings part sorts first and holds no protection.
  base['word/glossary/settings.xml'] = strToU8(
    `<w:settings xmlns:w="${W_NS}"><w:defaultTabStop w:val="720"/></w:settings>`
  );
  base['word/glossary/document.xml'] = strToU8(
    `<w:glossaryDocument xmlns:w="${W_NS}"><w:docParts/></w:glossaryDocument>`
  );
  base['word/glossary/_rels/document.xml.rels'] = strToU8(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rId1" Type="${RELS}/settings" Target="settings.xml"/></Relationships>`
  );
  base['[Content_Types].xml'] = strToU8(
    strFromU8(base['[Content_Types].xml']!).replace(
      '</Types>',
      `<Override PartName="/word/glossary/settings.xml" ContentType="${WML}.settings+xml"/>` +
        `<Override PartName="/word/glossary/document.xml" ContentType="${WML}.document.glossary+xml"/></Types>`
    )
  );
  base['word/_rels/document.xml.rels'] = strToU8(
    strFromU8(base['word/_rels/document.xml.rels']!).replace(
      '</Relationships>',
      `<Relationship Id="rIdG" Type="${RELS}/glossaryDocument" Target="glossary/document.xml"/></Relationships>`
    )
  );
  const result = compare(
    zipSync(base, { mtime: new Date(2026, 0, 1) }),
    buildDocx({ body: p('hello world') })
  );
  expect(result.ok ? '' : result.message).toContain('protected against edits');
});
