// Every saved revision annotation gets its own valid `@w:id`, across all parts, while the live
// tree and its review grouping keep the ids they had.

import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import {
  readOoxmlPackage,
  writeOoxmlPackage,
  type OoxmlPackage,
} from '../package/ooxml-package.ts';
import { serializeOoxmlPart } from '../package/ooxml-tree.ts';
import { uniqueRevisionIdExportPackage } from '../package/revision-id-export.ts';
import { reviewItemKey } from '../store/review-items.ts';
import { revisionItemsOf } from '../store/review-reads.ts';
import { planRevisionBatch } from '../store/revision-batch.ts';
import { applyTreeOp } from '../store/tree-op-apply.ts';
import {
  firstParagraphId,
  openStore,
  R,
  transactBody,
  W,
  zipDoc,
} from './canonical-primitive-journal-coverage-support.ts';

const OTHER = 'w:author="Other" w:date="2020-01-01T00:00:00Z"';
const ME = { author: 'Me', date: '2021-01-01T00:00:00Z' };
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const HEADER_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';
const FOOTNOTES_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml';

function load(bytes: Uint8Array): OoxmlPackage {
  const read = readOoxmlPackage(bytes);
  if (!read.ok) throw new Error(read.reason);
  return read.package;
}

function savedPart(bytes: Uint8Array, name: string): string {
  return strFromU8(unzipSync(bytes)[name]!);
}

/** `name:id` for each revision-space element, in document order. */
function revisionIds(xml: string): string[] {
  const found: string[] = [];
  const pattern =
    /<w:(ins|del|moveFrom|moveTo|rPrChange|pPrChange|(?:moveFrom|moveTo|customXmlIns|customXmlDel)Range(?:Start|End))\b[^>]*?\bw:id="([^"]*)"/g;
  for (const match of xml.matchAll(pattern)) found.push(`${match[1]}:${match[2]}`);
  return found;
}

const idsOnly = (entries: readonly string[]) => entries.map((entry) => entry.split(':')[1]!);

function typeInsideOtherInsertion() {
  const store = openStore(
    zipDoc({ body: `<w:p><w:ins w:id="1" ${OTHER}><w:r><w:t>abcdef</w:t></w:r></w:ins></w:p>` })
  );
  const typed = transactBody(store, {
    op: 'insertText',
    paragraphId: firstParagraphId(store),
    offset: 3,
    text: 'XY',
    revision: ME,
  });
  expect(typed.ok).toBe(true);
  return store;
}

describe('saved revision ids', () => {
  test('typing inside another author insertion saves three distinct ids', () => {
    const store = typeInsideOtherInsertion();
    const live = store.currentPackage();
    const body = live.parts.get(live.mainDocumentPart)!;
    // The live tree keeps the split pieces under one id.
    expect(revisionIds(serializeOoxmlPart(body))).toEqual(['ins:1', 'ins:2', 'ins:1']);
    const items = revisionItemsOf(body).map(reviewItemKey);

    const saved = writeOoxmlPackage(live);
    expect(revisionIds(savedPart(saved, 'word/document.xml'))).toEqual(['ins:1', 'ins:2', 'ins:3']);
    // Saving leaves the live tree as it was.
    expect(store.currentPackage()).toBe(live);
    expect(revisionIds(serializeOoxmlPart(body))).toEqual(['ins:1', 'ins:2', 'ins:1']);
    // Review items in the open editor do not change either.
    expect(revisionItemsOf(body).map(reviewItemKey)).toEqual(items);
  });

  test('after reopen, each split piece is its own review item and decides alone', () => {
    const saved = writeOoxmlPackage(typeInsideOtherInsertion().currentPackage());
    const reopened = load(saved);
    const body = reopened.parts.get(reopened.mainDocumentPart)!;
    const items = revisionItemsOf(body);
    // Expected: the saved file has nothing that joins the two pieces, so each piece is its
    // own review item, and each decision covers one piece.
    expect(items.map((item) => item.author)).toEqual(['Other', 'Me', 'Other']);

    const rejectTail = planRevisionBatch(body, 'reject', [reviewItemKey(items[2]!)]);
    expect(rejectTail.ops).toHaveLength(1);
    const rejected = applyTreeOp(body, rejectTail.ops[0]!);
    if (!rejected.ok) throw new Error(rejected.reason);
    const afterReject = serializeOoxmlPart(rejected.part);
    expect(afterReject).toContain('abc');
    expect(afterReject).toContain('XY');
    expect(afterReject).not.toContain('def');

    const acceptHead = planRevisionBatch(body, 'accept', [reviewItemKey(items[0]!)]);
    const accepted = applyTreeOp(body, acceptHead.ops[0]!);
    if (!accepted.ok) throw new Error(accepted.reason);
    expect(revisionItemsOf(accepted.part).map((item) => item.author)).toEqual(['Me', 'Other']);
  });

  test('ids are unique across body, header and footnotes', () => {
    const ins = (id: string, text: string) =>
      `<w:p><w:ins w:id="${id}" ${OTHER}><w:r><w:t>${text}</w:t></w:r></w:ins></w:p>`;
    const bytes = zipDoc({
      body: ins('1', 'body') + ins('4', 'body two'),
      overrides:
        `<Override PartName="/word/header1.xml" ContentType="${HEADER_TYPE}"/>` +
        `<Override PartName="/word/footnotes.xml" ContentType="${FOOTNOTES_TYPE}"/>`,
      rels:
        `<Relationship Id="rId10" Type="${R}/header" Target="header1.xml"/>` +
        `<Relationship Id="rId11" Type="${R}/footnotes" Target="footnotes.xml"/>`,
      extraXml: {
        'word/header1.xml': `<w:hdr xmlns:w="${W}">${ins('1', 'header')}</w:hdr>`,
        'word/footnotes.xml':
          `<w:footnotes xmlns:w="${W}"><w:footnote w:id="1">` +
          `${ins('1', 'note')}${ins('4', 'note two')}</w:footnote></w:footnotes>`,
      },
    });
    const saved = writeOoxmlPackage(load(bytes));
    const body = idsOnly(revisionIds(savedPart(saved, 'word/document.xml')));
    const header = idsOnly(revisionIds(savedPart(saved, 'word/header1.xml')));
    const notes = idsOnly(revisionIds(savedPart(saved, 'word/footnotes.xml')));
    // The main document keeps its ids; other parts renumber from one past the highest.
    expect(body).toEqual(['1', '4']);
    const all = [...body, ...header, ...notes];
    expect(new Set(all).size).toBe(all.length);
    expect(all.every((id) => Number(id) >= 0 && Number(id) <= 2147483647)).toBe(true);
    // The footnote's own id is a different id space and keeps its value.
    expect(savedPart(saved, 'word/footnotes.xml')).toContain('<w:footnote w:id="1">');
  });

  test('ids outside the 32-bit signed range or not integers get new ids', () => {
    const ins = (id: string) => `<w:ins w:id="${id}" ${OTHER}><w:r><w:t>t${id}</w:t></w:r></w:ins>`;
    const body = `<w:p>${ins('5')}${ins('3000000000')}${ins('99999999999999999999')}${ins('x')}${ins('007')}</w:p>`;
    const saved = writeOoxmlPackage(load(zipDoc({ body })));
    expect(revisionIds(savedPart(saved, 'word/document.xml'))).toEqual([
      'ins:5',
      'ins:8',
      'ins:9',
      'ins:10',
      'ins:007',
    ]);
  });

  test('at the ceiling, new ids take the lowest free value', () => {
    const ins = (id: string) => `<w:ins w:id="${id}" ${OTHER}><w:r><w:t>t</w:t></w:r></w:ins>`;
    const body = `<w:p>${ins('0')}${ins('2147483647')}${ins('2147483647')}${ins('0')}</w:p>`;
    const saved = writeOoxmlPackage(load(zipDoc({ body })));
    expect(revisionIds(savedPart(saved, 'word/document.xml'))).toEqual([
      'ins:0',
      'ins:2147483647',
      'ins:1',
      'ins:2',
    ]);
  });

  test('a move range keeps its start and end on one id, across paragraphs', () => {
    const move = (kind: 'From' | 'To', id: string) =>
      `<w:move${kind}RangeStart w:id="${id}" w:name="move1" ${OTHER}/>`;
    const body =
      `<w:p>${move('From', '1')}<w:moveFrom w:id="2" ${OTHER}><w:r><w:t>moved</w:t></w:r></w:moveFrom>` +
      `<w:moveFromRangeEnd w:id="1"/></w:p>` +
      `<w:p>${move('To', '1')}<w:moveTo w:id="2" ${OTHER}><w:r><w:t>mov</w:t></w:r></w:moveTo></w:p>` +
      `<w:p><w:moveTo w:id="3" ${OTHER}><w:r><w:t>ed</w:t></w:r></w:moveTo><w:moveToRangeEnd w:id="1"/></w:p>`;
    const saved = writeOoxmlPackage(load(zipDoc({ body })));
    expect(revisionIds(savedPart(saved, 'word/document.xml'))).toEqual([
      'moveFromRangeStart:1',
      'moveFrom:2',
      'moveFromRangeEnd:1',
      'moveToRangeStart:4',
      'moveTo:5',
      'moveTo:3',
      'moveToRangeEnd:4',
    ]);
  });

  test('a custom XML range keeps its start and end on one id', () => {
    const body =
      `<w:p><w:ins w:id="1" ${OTHER}><w:r><w:t>a</w:t></w:r></w:ins>` +
      `<w:customXmlInsRangeStart w:id="1" ${OTHER}/><w:r><w:t>b</w:t></w:r>` +
      `<w:customXmlInsRangeEnd w:id="1"/>` +
      `<w:customXmlDelRangeStart w:id="1" ${OTHER}/><w:customXmlDelRangeEnd w:id="1"/></w:p>`;
    const saved = writeOoxmlPackage(load(zipDoc({ body })));
    expect(revisionIds(savedPart(saved, 'word/document.xml'))).toEqual([
      'ins:1',
      'customXmlInsRangeStart:2',
      'customXmlInsRangeEnd:2',
      'customXmlDelRangeStart:3',
      'customXmlDelRangeEnd:3',
    ]);
  });

  test('alternate content branches keep one id for one annotation', () => {
    const insertion = `<w:ins w:id="1" ${OTHER}><w:r><w:t>box</w:t></w:r></w:ins>`;
    const body =
      `<w:p>${insertion}</w:p>` +
      `<w:p><mc:AlternateContent><mc:Choice Requires="w14"><w:p>${insertion}</w:p></mc:Choice>` +
      `<mc:Fallback><w:p>${insertion}</w:p></mc:Fallback></mc:AlternateContent></w:p>`;
    const pkg = load(zipDoc({ body, extraXmlns: `xmlns:mc="${MC}"` }));
    const saved = writeOoxmlPackage(pkg);
    const ids = revisionIds(savedPart(saved, 'word/document.xml'));
    // The body's insertion keeps its id; both branches of the copy share the next one.
    expect(ids).toEqual(['ins:1', 'ins:2', 'ins:2']);
  });

  test('comment and bookmark ids are separate spaces and stay as they are', () => {
    const body =
      `<w:p><w:bookmarkStart w:id="1" w:name="b"/><w:commentRangeStart w:id="1"/>` +
      `<w:ins w:id="1" ${OTHER}><w:r><w:t>a</w:t></w:r></w:ins>` +
      `<w:commentRangeEnd w:id="1"/><w:bookmarkEnd w:id="1"/></w:p>`;
    const pkg = load(zipDoc({ body }));
    expect(uniqueRevisionIdExportPackage(pkg)).toBe(pkg);
  });

  test('a package without duplicates is returned as is and saves byte-identical', () => {
    const body =
      `<w:p><w:ins w:id="1" ${OTHER}><w:r><w:t>a</w:t></w:r></w:ins>` +
      `<w:del w:id="2" ${OTHER}><w:r><w:delText>b</w:delText></w:r></w:del>` +
      `<w:r><w:rPr><w:b/><w:rPrChange w:id="3" ${OTHER}><w:rPr/></w:rPrChange></w:rPr><w:t>c</w:t></w:r></w:p>`;
    const pkg = load(zipDoc({ body }));
    expect(uniqueRevisionIdExportPackage(pkg)).toBe(pkg);
    const saved = writeOoxmlPackage(pkg);
    const main = pkg.parts.get(pkg.mainDocumentPart)!;
    expect(savedPart(saved, 'word/document.xml')).toBe(serializeOoxmlPart(main));
    expect(writeOoxmlPackage(pkg)).toEqual(saved);
  });

  test('a repeated save reuses the rebuilt blocks', () => {
    const pkg = typeInsideOtherInsertion().currentPackage();
    const first = uniqueRevisionIdExportPackage(pkg);
    const second = uniqueRevisionIdExportPackage(pkg);
    expect(first).not.toBe(pkg);
    const paragraph = (value: OoxmlPackage) => {
      const root = value.parts.get(value.mainDocumentPart)!.root;
      const bodyNode = root.children.find((node) => node.kind === 'body');
      return bodyNode && bodyNode.kind !== 'textValue' ? bodyNode.children[0] : undefined;
    };
    expect(paragraph(second)).toBe(paragraph(first));
  });
});
