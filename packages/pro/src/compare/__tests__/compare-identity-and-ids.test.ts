/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Object identity is exact (a weak hash collision never hides a changed image), note reference
// attributes take part, ids with any characters survive assembly, and list merges stay linear.
import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  buildDocx,
  DEFAULT_NUMBERING,
  solidPng,
} from '../../../../../scripts/compare-corpus/docx-builder.ts';
import {
  commented,
  footnoteRef,
  inlineImage,
  listPr,
  p,
  r,
} from '../../../../../scripts/compare-corpus/xml.ts';
import { compareDocuments } from '../index.ts';

const DATE = new Date('2026-01-10T12:00:00Z');

function compared(base: Uint8Array, revised: Uint8Array) {
  const result = compareDocuments(base, revised, { authorName: 'Test', date: DATE });
  if (!result.ok) throw new Error(result.message);
  const files: Record<string, string> = {};
  const entries = Object.entries(unzipSync(result.bytes));
  for (const [name, bytes] of entries) if (!name.includes('media/')) files[name] = strFromU8(bytes);
  return { revisions: result.revisionCount, files, names: entries.map(([name]) => name) };
}

/** Two different payloads of one length with the same 32-bit FNV-1a hash. */
function fnvCollision(): [Uint8Array, Uint8Array] {
  const fnv = (bytes: Uint8Array) => {
    let hash = 0x811c9dc5;
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
    return hash;
  };
  const head = new TextEncoder().encode('\x89PNG payload ');
  const seen = new Map<number, Uint8Array>();
  for (let n = 0; ; n++) {
    const bytes = new Uint8Array(head.length + 8);
    bytes.set(head);
    new DataView(bytes.buffer).setFloat64(head.length, n * 1.000000001 + 0.5);
    const hash = fnv(bytes);
    const previous = seen.get(hash);
    if (previous && previous.join() !== bytes.join()) return [previous, bytes];
    seen.set(hash, bytes);
  }
}

test('images whose weak hashes collide still compare as different', () => {
  const [a, b] = fnvCollision();
  const body = `<w:p><w:r>${inlineImage('rIdImg', 1)}</w:r></w:p>${p('Caption')}`;
  const { revisions, files } = compared(
    buildDocx({ body, media: [{ name: 'image1.png', bytes: a, rId: 'rIdImg' }] }),
    buildDocx({ body, media: [{ name: 'image1.png', bytes: b, rId: 'rIdImg' }] })
  );
  expect(revisions).toBeGreaterThan(0);
  expect(files['word/document.xml']).toMatch(/<w:(ins|del)\b/);
}, 30_000);

test('a changed note reference attribute is recorded', () => {
  const reference = (attributes: string) =>
    `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference${attributes} w:id="1"/></w:r>`;
  const doc = (attributes: string) =>
    buildDocx({
      body: `<w:p>${r('Claim')}${reference(attributes)}</w:p>${p('End')}`,
      footnotes: { 1: 'Source' },
    });
  const { revisions } = compared(doc(''), doc(' w:customMarkFollows="1"'));
  expect(revisions).toBeGreaterThan(0);
});

test('ids that hold placeholder characters survive assembly', () => {
  const revised = buildDocx({
    body: `<w:p>${r('Alpha ')}${commented('a§b' as never, r('beta'))}${r(' gamma')}</w:p>`,
    comments: [{ id: 'a§b' as never, author: 'Rev', text: 'Why?' }],
  });
  const { files } = compared(buildDocx({ body: p('Alpha beta gamma') }), revised);
  const id = /<w:commentReference\b[^>]*w:id="([^"]+)"/.exec(files['word/document.xml']!)?.[1];
  expect(id).toBeDefined();
  expect(files['word/comments.xml']).toContain(`w:id="${id}"`);
});

test('many list instances sharing one definition merge in linear time', () => {
  const nums = (count: number) =>
    Array.from(
      { length: count },
      (_, i) => `<w:num w:numId="${i + 1}"><w:abstractNumId w:val="0"/></w:num>`
    ).join('');
  const numbering =
    '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/>' +
    `<w:lvlText w:val="%1."/></w:lvl></w:abstractNum>`;
  const doc = (text: string, count: number) =>
    buildDocx({ body: p(text), numbering: `${numbering}${nums(count)}</w:numbering>` });
  const started = performance.now();
  compared(doc('a', 40_000), doc('b', 40_000));
  expect(performance.now() - started).toBeLessThan(8_000);
  // List definitions count against the block limit, so their merge is bounded too.
  const result = compareDocuments(doc('a', 60_000), doc('b', 60_000), {
    authorName: 'Test',
    date: DATE,
  });
  expect(result.ok ? '' : result.code).toBe('too-large');
}, 60_000);

test('a revised list reference without a list never takes a copied list id', () => {
  // Revised list 2 uses another definition than the original's, so it is copied under a new id.
  const numbering = DEFAULT_NUMBERING.replace(
    '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>',
    '<w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>'
  );
  const { files } = compared(
    buildDocx({ body: p('Intro') + p('Plain') }),
    buildDocx({ body: p('Intro') + p('Item', listPr(2)) + p('Plain', listPr(5)), numbering })
  );
  const defined = [...files['word/numbering.xml']!.matchAll(/<w:num\b[^>]*w:numId="(\d+)"/g)];
  expect(defined.map((m) => m[1])).not.toContain('5');
  expect(files['word/document.xml']).toContain('w:numId w:val="5"');
});

test('a revised note reference without a note never takes a copied note id', () => {
  const notes: Record<number, string> = {};
  let refs = '';
  for (let i = 1; i <= 6; i++) {
    notes[i] = `Note ${i}`;
    refs += r(` t${i}`) + footnoteRef(i);
  }
  const { files } = compared(
    buildDocx({ body: `<w:p>${refs}</w:p>${p('End')}`, footnotes: notes }),
    buildDocx({
      body: `<w:p>${refs}${r(' new')}${footnoteRef(8)}${r(' gone')}${footnoteRef(7)}</w:p>${p('End')}`,
      footnotes: { ...notes, 8: 'Brand new note' },
    })
  );
  const refIds = [...files['word/document.xml']!.matchAll(/footnoteReference w:id="([^"]+)"/g)];
  const noteIds = [...files['word/footnotes.xml']!.matchAll(/<w:footnote\b[^>]*w:id="([^"]+)"/g)];
  expect(new Set(refIds.map((m) => m[1])).size).toBe(refIds.length);
  expect(noteIds.map((m) => m[1])).not.toContain('7');
});

test('relationships the original names but lacks stay missing', () => {
  const image = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
  const png = solidPng(4, 4, [255, 0, 0]);
  const revisedPicture = `<w:p>${inlineImage('rImg', 2)}</w:p>`;
  const media = [{ name: 'red.png', bytes: png, rId: 'rImg' }];
  // A picture naming an id no relationship defines.
  const missingId = `<w:p>${inlineImage('rIdCmp1', 1)}</w:p>`;
  const out = compared(
    buildDocx({ body: p('Intro') + missingId }),
    buildDocx({ body: p('Intro') + missingId + revisedPicture, media })
  ).files;
  expect(out['word/_rels/document.xml.rels']).not.toContain('Id="rIdCmp1"');
  // A relationship whose target part is missing.
  const files = unzipSync(
    buildDocx({ body: p('Intro') + `<w:p>${inlineImage('rBroken', 1)}</w:p>` })
  );
  files['word/_rels/document.xml.rels'] = strToU8(
    strFromU8(files['word/_rels/document.xml.rels']!).replace(
      '</Relationships>',
      `<Relationship Id="rBroken" Type="${image}" Target="media/compare1.png"/></Relationships>`
    )
  );
  const result = compared(zipSync(files), buildDocx({ body: p('Intro') + revisedPicture, media }));
  expect(result.names).not.toContain('word/media/compare1.png');
  expect(result.files['word/_rels/document.xml.rels']).toContain('Target="media/compare1.png"');
});

/** A built document with every `token` in its main story, relationships, and comments replaced. */
function withRaw(bytes: Uint8Array, token: string, raw: string): Uint8Array {
  const files = unzipSync(bytes);
  for (const name of ['word/document.xml', 'word/_rels/document.xml.rels', 'word/comments.xml'])
    if (files[name]) files[name] = strToU8(strFromU8(files[name]!).replaceAll(token, raw));
  return zipSync(files);
}

test('relationship ids written with character references keep their targets', () => {
  const doc = (bytes: Uint8Array) =>
    withRaw(
      buildDocx({
        body: `<w:p><w:r>${inlineImage('RIDX', 1)}</w:r></w:p>${p('Caption')}`,
        media: [{ name: 'image1.png', bytes, rId: 'RIDX' }],
      }),
      'RIDX',
      'r&amp;1'
    );
  const { revisions, files } = compared(
    doc(new Uint8Array([1, 1, 1, 1])),
    doc(new Uint8Array([2, 2, 2, 2]))
  );
  expect(revisions).toBeGreaterThan(0);
  const rels = files['word/_rels/document.xml.rels']!;
  const embeds = [...files['word/document.xml']!.matchAll(/:embed="([^"]*)"/g)].map((m) => m[1]!);
  expect(embeds.length).toBe(2);
  for (const id of embeds) expect(rels).toContain(`Id="${id}"`);
});

test('comment ids written with numeric character references keep their markers', () => {
  for (const raw of ['x&#9;y', 'x&#xA0;y', 'a&amp;lt;b']) {
    const revised = withRaw(
      buildDocx({
        body: `<w:p>${r('Alpha ')}${commented('CID' as never, r('beta'))}${r(' gamma')}</w:p>`,
        comments: [{ id: 'CID' as never, author: 'Rev', text: 'Why?' }],
      }),
      'CID',
      raw
    );
    const { files } = compared(buildDocx({ body: p('Alpha beta gamma') }), revised);
    const markers = [
      ...files['word/document.xml']!.matchAll(
        /<w:comment(?:Reference|RangeStart|RangeEnd)\b[^>]*w:id="([^"]*)"/g
      ),
    ].map((m) => m[1]);
    const comments = [...files['word/comments.xml']!.matchAll(/<w:comment\b[^>]*w:id="([^"]*)"/g)];
    expect(markers.length).toBe(3);
    expect(comments.length).toBe(1);
    for (const id of markers) expect(id).toBe(comments[0]![1]);
  }
});

test('note references without a note of their own keep their ids', () => {
  const refs = (xml: string) =>
    [...xml.matchAll(/<w:footnoteReference\b[^>]*w:id="([^"]*)"/g)].map((m) => m[1]);
  const cases: [string, Record<number, string> | undefined][] = [
    ['5', undefined],
    ['5', { 1: 'x' }],
    ['0', { 1: 'x' }],
    ['-1', { 1: 'x' }],
  ];
  for (const [id, footnotes] of cases) {
    const { files } = compared(
      buildDocx({ body: p('Claim') + p('End'), footnotes }),
      buildDocx({
        body: `<w:p>${r('Claim')}<w:r><w:footnoteReference w:id="${id}"/></w:r></w:p>${p('End')}`,
        footnotes,
      })
    );
    expect(refs(files['word/document.xml']!)).toEqual([id]);
    // A reference to a separator never copies the separator as a new note.
    if (footnotes)
      expect([...files['word/footnotes.xml']!.matchAll(/<w:footnote\b/g)].length).toBe(3);
  }
});

test('a relationship graph that fans in compares in linear time', () => {
  const image = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
  const make = (text: string, depth: number) => {
    const files = unzipSync(
      buildDocx({
        body: `<w:p><w:r>${inlineImage('rIdImg', 1)}</w:r></w:p>${p(text)}`,
        media: [{ name: 'image1.png', bytes: new Uint8Array([1, 2, 3]), rId: 'rIdImg' }],
      })
    );
    // Each part links the next one twice, so an identity built by concatenation doubles per level.
    const chain = ['image1.png', ...Array.from({ length: depth }, (_, i) => `x${i}.png`)];
    for (let i = 0; i < chain.length; i++) {
      files[`word/media/${chain[i]}`] ??= new Uint8Array([i & 255, 7]);
      if (i + 1 < chain.length)
        files[`word/media/_rels/${chain[i]}.rels`] = strToU8(
          '<?xml version="1.0" encoding="UTF-8"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            `<Relationship Id="r0" Type="${image}" Target="${chain[i + 1]}"/>` +
            `<Relationship Id="r1" Type="${image}" Target="${chain[i + 1]}"/></Relationships>`
        );
    }
    return zipSync(files);
  };
  // A shallow graph compares; a deep one passes the closure bound and is refused. Both are fast.
  for (const [depth, ok] of [
    [6, true],
    [40, false],
  ] as const) {
    const started = performance.now();
    const result = compareDocuments(make('Before', depth), make('After', depth), {
      authorName: 'Test',
      date: DATE,
    });
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(result.ok).toBe(ok);
  }
}, 30_000);
