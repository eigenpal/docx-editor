/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, describe, expect, test } from 'bun:test';
import { paragraphTextOf, type TreeDocOp } from '@docx-editor.dev/core/store';
import {
  createPeerHarness,
  nodeText,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';

const harness = createPeerHarness('split-source-adversarial');
afterEach(() => harness.cleanup());
const TEXT = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;
function mark(peer: Peer, start: number, end: number, localName: string): TreeDocOp {
  return {
    op: 'setRunProperties',
    paragraphId: harness.paragraphIdAt(peer, 0),
    start,
    end,
    properties: [{ localName }],
  };
}
function insert(peer: Peer, offset: number, text: string): TreeDocOp {
  return { op: 'insertText', paragraphId: harness.paragraphIdAt(peer, 0), offset, text };
}
function check(peers: readonly Peer[], expected: string) {
  for (const peer of peers) {
    expect(nodeText(peer.store.bodyStore().part.root)).toBe(expected);
    harness.expectConverged(peers[0]!, peer);
  }
}
function count(peer: Peer, localName: string): number {
  let found = 0;
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind !== 'textValue' && node.localName === localName) found += 1;
  });
  return found;
}

const cases = [
  {
    name: 'multiple text containers',
    body: '<w:r><w:t>ABCDEFGH</w:t><w:t>IJKLMNOP</w:t><w:t>QRSTUVWXYZ</w:t></w:r>',
    expected: TEXT,
    atoms: [],
  },
  {
    name: 'tab and break in the same run',
    body: '<w:r><w:t>ABCDEFGH</w:t><w:tab/><w:t>IJKLMNOP</w:t><w:br/><w:t>QRSTUVWXYZ</w:t></w:r>',
    expected: TEXT,
    atoms: ['tab', 'br'],
  },
  {
    name: 'nested inline control and hyperlink',
    body: `<w:sdt><w:sdtPr><w:tag w:val="nested"/></w:sdtPr><w:sdtContent><w:hyperlink w:anchor="target">${run(TEXT)}</w:hyperlink></w:sdtContent></w:sdt>`,
    expected: TEXT,
    atoms: ['sdt', 'hyperlink'],
  },
  {
    name: 'simple field between ordinary runs',
    body: `${run('ABCDEFGHIJKL')}<w:fldSimple w:instr="PAGE"><w:r><w:rPr><w:color w:val="123456"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple>${run('MNOPQRSTUVWXYZ')}`,
    expected: 'ABCDEFGHIJKL1MNOPQRSTUVWXYZ',
    atoms: ['fldSimple'],
  },
] as const;

describe('split-source registration with mixed content', () => {
  for (const fixture of cases) {
    test(`${fixture.name}: three formatting races preserve text and atoms`, async () => {
      const { alice, bob, pause, resume } = await harness.pair(
        zipDocument(`<w:p>${fixture.body}</w:p><w:sectPr/>`)
      );
      for (const [start, end] of [
        [2, 24],
        [4, 22],
        [6, 20],
      ]) {
        pause();
        harness.apply(alice, [mark(alice, start!, end!, 'b')]);
        harness.apply(bob, [mark(bob, start! + 1, end! - 1, 'i')]);
        resume();
        check([alice, bob], fixture.expected);
        for (const atom of fixture.atoms) expect(count(alice, atom)).toBe(1);
        if (fixture.name === 'tab and break in the same run') {
          expect(
            paragraphTextOf(alice.store.bodyStore().part, harness.paragraphIdAt(alice, 0))
          ).toBe('ABCDEFGH\tIJKLMNOP\nQRSTUVWXYZ');
        }
        if (fixture.name === 'simple field between ordinary runs') {
          walk(alice.store.bodyStore().part.root, (node) => {
            if (node.kind === 'textValue' || node.localName !== 'fldSimple') return;
            expect(
              node.attributes.find((attribute) => attribute.localName === 'instr')?.value
            ).toBe('PAGE');
            expect(nodeText(node)).toBe('1');
            expect(node.children.filter((child) => child.kind === 'run')).toHaveLength(1);
          });
        }
      }
      const carol = await harness.join(bob, 'carol');
      check([alice, bob, carol], fixture.expected);
      for (const atom of fixture.atoms) expect(count(carol, atom)).toBe(1);
    });
  }

  test('typing in a later original text container survives descendant formatting', async () => {
    const { alice, bob, pause, resume } = await harness.pair(
      zipDocument(`<w:p>${cases[0].body}</w:p><w:sectPr/>`)
    );
    pause();
    harness.apply(alice, [mark(alice, 2, 23, 'b')]);
    harness.apply(bob, [insert(bob, 20, '!')]);
    resume();
    const expected = TEXT.slice(0, 20) + '!' + TEXT.slice(20);
    check([alice, bob], expected);
    harness.apply(bob, [mark(bob, 18, 23, 'i')]);
    check([alice, bob], expected);
    const carol = await harness.join(alice, 'carol');
    check([alice, bob, carol], expected);
  });

  for (const order of ['format-first', 'type-first'] as const) {
    test(`compound ${order} journal merges both authors' text once`, async () => {
      const { alice, bob, pause, resume } = await harness.pair(
        zipDocument(`<w:p>${run(TEXT)}</w:p><w:sectPr/>`)
      );
      pause();
      const formatting = mark(alice, 2, 24, 'b');
      const typing = insert(alice, 7, 'a');
      harness.apply(alice, order === 'format-first' ? [formatting, typing] : [typing, formatting]);
      harness.apply(bob, [insert(bob, 20, 'b')]);
      resume();
      const expected = TEXT.slice(0, 7) + 'a' + TEXT.slice(7, 20) + 'b' + TEXT.slice(20);
      check([alice, bob], expected);
      harness.apply(bob, [mark(bob, 10, 18, 'i')]);
      check([alice, bob], expected);
      const carol = await harness.join(alice, 'carol');
      check([alice, bob, carol], expected);
    });
  }
});
