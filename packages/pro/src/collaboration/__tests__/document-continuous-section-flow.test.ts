/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  layoutSemanticDocument,
} from '../../../../core/src/layout/semantic-layout.ts';
import {
  createPeerHarness,
  nodeText,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';

const harness = createPeerHarness('continuous-section-first-line', { offlineEditing: true });
afterEach(() => harness.cleanup());
const measurer = createFixedMeasurer(6, 14);
const section = (columns = 1) =>
  '<w:sectPr><w:type w:val="continuous"/><w:pgSz w:w="4000" w:h="2400"/>' +
  '<w:pgMar w:top="200" w:bottom="200" w:left="200" w:right="200" w:header="0" w:footer="0"/>' +
  `<w:cols w:num="${columns}" w:space="200"/></w:sectPr>`;
const paragraph = (text: string, height: number, sectPr = '') =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${height * 20}" w:lineRule="exact"/>` +
  `${sectPr}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const body =
  paragraph('HOST', 80) +
  paragraph('', 21, section()) +
  paragraph('', 21, section(2)) +
  paragraph('CONTENTS', 26) +
  paragraph('TAIL', 10) +
  section(2);

function titleId(peer: Peer): string {
  const matches: string[] = [];
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind === 'paragraph' && nodeText(node) === 'CONTENTS') matches.push(node.id);
  });
  expect(matches).toHaveLength(1);
  return matches[0]!;
}

function check(peer: Peer, text: string) {
  const { part, revision } = peer.store.bodyStore();
  const xml = serializeOoxmlPart(part);
  const result = layoutSemanticDocument(part, revision, { measurer });
  const matches = result.pages.flatMap((page, pageIndex) =>
    page.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph' &&
      fragment.lines.flatMap((line) => line.spans.map((span) => span.text)).join('') === text
        ? [{ pageIndex, fragment, contentHeight: page.contentBox.height }]
        : []
    )
  );
  expect(matches).toHaveLength(1);
  expect(matches[0]!.pageIndex).toBe(1);
  expect(matches[0]!.fragment.box.y).toBe(0);
  for (const line of matches[0]!.fragment.lines) {
    expect(line.box.y + line.box.height).toBeLessThanOrEqual(matches[0]!.contentHeight);
  }
  expect(result.pages).toHaveLength(2);
  expect(serializeOoxmlPart(part)).toBe(xml);
  expect((xml.match(/<w:sectPr[ >]/g) ?? []).length).toBe(3);
  const reopened = readOoxmlPart(xml, { name: part.name, contentType: part.contentType });
  if (!reopened.ok) throw new Error(reopened.reason);
  expect(layoutSemanticDocument(reopened.part, revision, { measurer }).pages).toEqual(result.pages);
  return matches.map(({ pageIndex, fragment }) => ({
    pageIndex,
    box: fragment.box,
    lines: fragment.lines,
  }));
}

test('remote edits and cold joins keep a continued first line inside its page', async () => {
  const { alice, bob, pause, resume } = await harness.pair(zipDocument(body));
  const id = titleId(alice);
  expect(check(alice, 'CONTENTS')).toEqual(check(bob, 'CONTENTS'));
  pause();
  harness.apply(alice, [{ op: 'insertText', paragraphId: id, offset: 8, text: ' A' }]);
  resume();
  harness.expectConverged(alice, bob);
  expect(check(alice, 'CONTENTS A')).toEqual(check(bob, 'CONTENTS A'));
  expect(alice.room.session.undo()).toBe(true);
  harness.expectConverged(alice, bob);
  check(bob, 'CONTENTS');
  expect(alice.room.session.redo()).toBe(true);
  harness.expectConverged(alice, bob);
  const cold = await harness.join(alice, 'cold');
  harness.expectConverged(alice, cold);
  expect(check(alice, 'CONTENTS A')).toEqual(check(cold, 'CONTENTS A'));
});
