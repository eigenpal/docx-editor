/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// #592: formatting must never change text, including descendants of concurrent splits.
import { afterEach, describe, expect, test } from 'bun:test';
import type { StoryScope, TreeDocOp } from '@docx-editor.dev/core/store';
import {
  BODY,
  W,
  REL,
  createPeerHarness,
  nodeText,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';

const harness = createPeerHarness('repeated-run-format-room');
const TEXT = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const OTHER = 'Untouched paragraph';
const doc = () =>
  zipDocument(
    `<w:p><w:r><w:t>${TEXT}</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>${OTHER}</w:t></w:r></w:p><w:sectPr/>`
  );

afterEach(() => harness.cleanup());

function format(
  peer: Peer,
  start: number,
  end: number,
  localName: string,
  scope: StoryScope = BODY
): void {
  harness.apply(
    peer,
    [
      {
        op: 'setRunProperties',
        paragraphId: harness.paragraphIdAt(peer, 0, scope),
        start,
        end,
        properties: [{ localName }],
      },
    ],
    scope
  );
}

function expectText(peers: readonly Peer[], text = TEXT): void {
  for (const peer of peers) {
    expect(nodeText(peer.store.bodyStore().part.root)).toBe(text + OTHER);
    harness.expectConverged(peers[0]!, peer);
  }
}

async function initialRace() {
  const pair = await harness.pair(doc());
  pair.pause();
  format(pair.alice, 0, 5, 'b');
  format(pair.bob, 3, 9, 'i');
  pair.resume();
  expectText([pair.alice, pair.bob]);
  return pair;
}

function edit(
  peer: Peer,
  operation:
    | Omit<Extract<TreeDocOp, { op: 'insertText' }>, 'paragraphId'>
    | Omit<Extract<TreeDocOp, { op: 'deleteText' }>, 'paragraphId'>
): void {
  harness.apply(peer, [{ ...operation, paragraphId: harness.paragraphIdAt(peer, 0) }]);
}

describe('repeated concurrent run formatting (#592)', () => {
  test('three rounds of nested concurrent splits preserve exact text after each merge', async () => {
    const { alice, bob, pause, resume } = await harness.pair(doc());
    // Every round cuts inside the previous products regardless of which replica wins.
    for (const [aStart, aEnd, bStart, bEnd] of [
      [2, 32, 4, 30],
      [8, 26, 10, 24],
      [14, 20, 16, 18],
    ]) {
      pause();
      format(alice, aStart!, aEnd!, 'b');
      format(bob, bStart!, bEnd!, 'i');
      resume();
      expectText([alice, bob]);
    }
    const carol = await harness.join(bob, 'carol');
    expectText([alice, bob, carol]);
  });

  for (const author of ['alice', 'bob'] as const) {
    test(`sequential descendant splits by ${author} preserve text and late-join state`, async () => {
      const pair = await initialRace();
      for (const [start, end] of [
        [10, 25],
        [13, 22],
        [16, 19],
      ]) {
        format(pair[author], start!, end!, 'b');
        expectText([pair.alice, pair.bob]);
      }
      const carol = await harness.join(pair[author], 'carol');
      expectText([pair.alice, pair.bob, carol]);
      format(carol, 27, 31, 'i');
      expectText([pair.alice, pair.bob, carol]);
    });

    test(`undo and redo by ${author} after repeated splits never duplicate text`, async () => {
      const pair = await initialRace();
      format(pair[author], 10, 25, 'b');
      format(pair[author], 13, 22, 'i');
      expectText([pair.alice, pair.bob]);
      expect(pair[author].room.session.undo()).toBe(true);
      pair[author].port.flushPendingJournals();
      expectText([pair.alice, pair.bob]);
      const carol = await harness.join(pair[author], 'carol');
      expectText([pair.alice, pair.bob, carol]);
      expect(pair[author].room.session.redo()).toBe(true);
      pair[author].port.flushPendingJournals();
      expectText([pair.alice, pair.bob, carol]);
    });

    test(`typing and deletion by ${author} after repeated splits retain exact offsets`, async () => {
      const pair = await initialRace();
      format(pair[author], 10, 25, 'b');
      format(pair[author], 13, 22, 'i');
      edit(pair[author], { op: 'insertText', offset: 17, text: 'typed' });
      const inserted = TEXT.slice(0, 17) + 'typed' + TEXT.slice(17);
      expectText([pair.alice, pair.bob], inserted);
      const other = pair[author === 'alice' ? 'bob' : 'alice'];
      edit(other, { op: 'deleteText', start: 12, end: 25 });
      const deleted = inserted.slice(0, 12) + inserted.slice(25);
      expectText([pair.alice, pair.bob], deleted);
      const carol = await harness.join(other, 'carol');
      expectText([pair.alice, pair.bob, carol], deleted);
    });
  }

  test('typing concurrent with a descendant split survives once', async () => {
    const { alice, bob, pause, resume } = await initialRace();
    pause();
    format(alice, 10, 25, 'b');
    edit(bob, { op: 'insertText', offset: 17, text: 'typed' });
    resume();
    const expected = TEXT.slice(0, 17) + 'typed' + TEXT.slice(17);
    expectText([alice, bob], expected);
    const carol = await harness.join(alice, 'carol');
    expectText([alice, bob, carol], expected);
  });
});

describe('descendant split adversarial histories (#592)', () => {
  for (const author of ['alice', 'bob'] as const) {
    test(`splitting every surviving piece by ${author} cannot switch to a losing branch`, async () => {
      const pair = await initialRace();
      // Cut every initial product, including both paragraph edges. Exercise both authors
      // without assuming which branch won the initial race.
      for (let offset = 0; offset < TEXT.length; offset += 2) {
        format(pair[author], offset, offset + 1, 'i');
        expectText([pair.alice, pair.bob]);
      }
      const carol = await harness.join(pair[author], 'carol');
      expectText([pair.alice, pair.bob, carol]);
    });

    test(`deleting all text by ${author} does not reveal a suppressed branch`, async () => {
      const pair = await initialRace();
      format(pair.alice, 10, 25, 'b');
      format(pair.bob, 13, 22, 'i');
      edit(pair[author], { op: 'deleteText', start: 0, end: TEXT.length });
      expectText([pair.alice, pair.bob], '');
      const carol = await harness.join(pair[author], 'carol');
      expectText([pair.alice, pair.bob, carol], '');
      expect(pair[author].room.session.undo()).toBe(true);
      pair[author].port.flushPendingJournals();
      expectText([pair.alice, pair.bob, carol]);
      expect(pair[author].room.session.redo()).toBe(true);
      pair[author].port.flushPendingJournals();
      expectText([pair.alice, pair.bob, carol], '');
    });

    test(`undo by ${author} after the other author splits its products preserves text`, async () => {
      const pair = await initialRace();
      const other = pair[author === 'alice' ? 'bob' : 'alice'];
      format(pair[author], 10, 25, 'b');
      format(other, 13, 22, 'i');
      expectText([pair.alice, pair.bob]);
      expect(pair[author].room.session.undo()).toBe(true);
      pair[author].port.flushPendingJournals();
      expectText([pair.alice, pair.bob]);
      const carol = await harness.join(other, 'carol');
      expectText([pair.alice, pair.bob, carol]);
      expect(pair[author].room.session.redo()).toBe(true);
      pair[author].port.flushPendingJournals();
      expectText([pair.alice, pair.bob, carol]);
    });

    test(`single source insertion survives overlay splits by ${author}`, async () => {
      const pair = await harness.pair(doc());
      pair.pause();
      format(pair.alice, 10, 25, 'b');
      edit(pair.bob, { op: 'insertText', offset: 17, text: 'typed' });
      pair.resume();
      const expected = TEXT.slice(0, 17) + 'typed' + TEXT.slice(17);
      expectText([pair.alice, pair.bob], expected);
      format(pair[author], 18, 20, 'i');
      expectText([pair.alice, pair.bob], expected);
      format(pair[author], 1, 3, 'b');
      expectText([pair.alice, pair.bob], expected);
      const carol = await harness.join(pair[author], 'carol');
      expectText([pair.alice, pair.bob, carol], expected);
    });

    test(`sibling source overlay survives a split elsewhere by ${author}`, async () => {
      const pair = await harness.pair(doc());
      pair.pause();
      format(pair.alice, 10, 25, 'b');
      edit(pair.bob, { op: 'insertText', offset: 31, text: 'suffix' });
      pair.resume();
      const expected = TEXT.slice(0, 31) + 'suffix' + TEXT.slice(31);
      expectText([pair.alice, pair.bob], expected);
      format(pair[author], 1, 3, 'i');
      expectText([pair.alice, pair.bob], expected);
      const carol = await harness.join(pair[author], 'carol');
      expectText([pair.alice, pair.bob, carol], expected);
    });

    test(`source typing survives later overlay splits by ${author} and sibling edits`, async () => {
      const pair = await harness.pair(doc());
      pair.pause();
      format(pair.alice, 10, 25, 'b');
      edit(pair.bob, { op: 'insertText', offset: 17, text: 'typed' });
      // A separate source insertion in the unaffected suffix must also survive.
      edit(pair.bob, { op: 'insertText', offset: 36, text: 'suffix' });
      pair.resume();
      const inserted = TEXT.slice(0, 17) + 'typed' + TEXT.slice(17);
      const expected = inserted.slice(0, 36) + 'suffix' + inserted.slice(36);
      expectText([pair.alice, pair.bob], expected);
      format(pair[author], 18, 20, 'i');
      expectText([pair.alice, pair.bob], expected);
      format(pair[author], 1, 3, 'b');
      expectText([pair.alice, pair.bob], expected);
      const carol = await harness.join(pair[author], 'carol');
      expectText([pair.alice, pair.bob, carol], expected);
    });
  }

  for (const wrapper of ['hyperlink', 'table']) {
    test(`repeated races inside a ${wrapper} retain text and structure`, async () => {
      const paragraph = `<w:p><w:hyperlink w:anchor="target"><w:r><w:t>${TEXT}</w:t></w:r></w:hyperlink></w:p>`;
      const wrapped =
        wrapper === 'hyperlink'
          ? paragraph
          : `<w:tbl><w:tr><w:tc>${paragraph}</w:tc></w:tr></w:tbl>`;
      const { alice, bob, pause, resume } = await harness.pair(
        zipDocument(wrapped + `<w:p><w:r><w:t>${OTHER}</w:t></w:r></w:p><w:sectPr/>`)
      );
      for (const [start, end] of [
        [2, 32],
        [8, 26],
        [14, 20],
      ]) {
        pause();
        format(alice, start!, end!, 'b');
        format(bob, start! + 1, end! - 1, 'i');
        resume();
        expectText([alice, bob]);
      }
      const carol = await harness.join(bob, 'carol');
      expectText([alice, bob, carol]);
      for (const peer of [alice, bob, carol]) {
        const elements: string[] = [];
        walk(peer.store.bodyStore().part.root, (node) => {
          if (node.kind !== 'textValue') elements.push(node.localName);
        });
        expect(elements.filter((name) => name === 'hyperlink')).toHaveLength(1);
        expect(elements.filter((name) => name === 'tbl')).toHaveLength(wrapper === 'table' ? 1 : 0);
      }
    });
  }

  test('three header split races preserve body, header text, and late joins', async () => {
    const header: StoryScope = { kind: 'headerFooter', rId: 'rId7' };
    const bytes = zipDocument(
      `<w:p><w:r><w:t>${OTHER}</w:t></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="rId7"/></w:sectPr>`,
      {
        overrides:
          '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
        documentRels: `<Relationships xmlns="${REL}"><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>`,
        extraXml: {
          'word/header1.xml': `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>${TEXT}</w:t></w:r></w:p></w:hdr>`,
        },
      }
    );
    const { alice, bob, pause, resume } = await harness.pair(bytes);
    const check = (peers: readonly Peer[]) => {
      for (const peer of peers) {
        expect(nodeText(peer.store.partFor(header)!.root)).toBe(TEXT);
        expect(nodeText(peer.store.bodyStore().part.root)).toBe(OTHER);
        harness.expectConverged(alice, peer);
      }
    };
    for (const [start, end] of [
      [2, 32],
      [8, 26],
      [14, 20],
    ]) {
      pause();
      format(alice, start!, end!, 'b', header);
      format(bob, start! + 1, end! - 1, 'i', header);
      resume();
      check([alice, bob]);
    }
    const carol = await harness.join(bob, 'carol');
    check([alice, bob, carol]);
  });
});
