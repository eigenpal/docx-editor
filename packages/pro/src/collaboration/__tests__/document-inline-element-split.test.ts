/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A line break or tab inserted inside a run splits that run's text, and typing another peer did
// at the same time in that text survives the split (issue #1129).
import { afterEach, expect, test } from 'bun:test';
import {
  canonicalOoxmlFingerprint,
  serializeOoxmlPart,
  type OoxmlNode,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';

const harness = createPeerHarness('inline-element-split', { offlineEditing: true });
afterEach(() => harness.cleanup());

const bytes = zipDocument(
  '<w:p><w:r><w:t xml:space="preserve">Acme Ltd 1 Main Street</w:t></w:r></w:p>'
);

function body(peer: Peer): string {
  return serializeOoxmlPart(peer.store.bodyStore().part).match(/<w:body>.*<\/w:body>/s)![0];
}

const element = (op: 'insertHardBreak' | 'insertTab', paragraphId: string): TreeDocOp => ({
  op,
  paragraphId,
  offset: 9,
});

for (const op of ['insertHardBreak', 'insertTab'] as const) {
  const mark = op === 'insertHardBreak' ? '<w:br/>' : '<w:tab/>';

  test(`${op} and an append to the same run made at once both survive`, async () => {
    const { alice, bob, pause, resume } = await harness.pair(bytes);
    pause();
    harness.apply(alice, [element(op, harness.paragraphIdAt(alice, 0))]);
    harness.apply(bob, [
      {
        op: 'insertText',
        paragraphId: harness.paragraphIdAt(bob, 0),
        offset: 22,
        text: ', London',
      },
    ]);
    resume();
    harness.expectConverged(alice, bob);
    expect(body(alice)).toContain(mark);
    expect(body(alice)).toContain('1 Main Street, London');
    expect(body(bob)).toBe(body(alice));
    // A participant who joins later builds the same paragraph from shared state alone.
    const carol = await harness.join(alice, 'carol');
    harness.expectConverged(alice, carol);
  });

  test(`${op} and typing before it in the same run made at once both survive`, async () => {
    const { alice, bob, pause, resume } = await harness.pair(bytes);
    pause();
    harness.apply(alice, [element(op, harness.paragraphIdAt(alice, 0))]);
    harness.apply(bob, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(bob, 0), offset: 0, text: 'To: ' },
    ]);
    resume();
    harness.expectConverged(alice, bob);
    expect(body(alice)).toContain('To: Acme Ltd ');
    expect(body(alice)).toContain(mark);
    expect(body(alice)).toContain('1 Main Street');
  });

  test(`${op} survives undo, redo, and a concurrent deletion of the run's tail`, async () => {
    const { alice, bob, pause, resume } = await harness.pair(bytes);
    pause();
    harness.apply(alice, [element(op, harness.paragraphIdAt(alice, 0))]);
    harness.apply(bob, [
      { op: 'deleteText', paragraphId: harness.paragraphIdAt(bob, 0), start: 14, end: 22 },
    ]);
    resume();
    harness.expectConverged(alice, bob);
    expect(body(alice)).toContain(mark);
    expect(body(alice)).not.toContain('Street');
    expect(alice.room.session.undo()).toBe(true);
    harness.expectConverged(alice, bob);
    expect(body(bob)).not.toContain(mark);
    expect(alice.room.session.redo()).toBe(true);
    harness.expectConverged(alice, bob);
    expect(body(bob)).toContain(mark);
    expect(body(bob)).toBe(body(alice));
  });
}

for (const offset of [1, 12, 20]) {
  test(`several splits in one transaction keep typing made at once at offset ${offset}`, async () => {
    const { alice, bob, pause, resume } = await harness.pair(bytes);
    pause();
    const paragraphId = harness.paragraphIdAt(alice, 0);
    harness.apply(alice, [
      { op: 'insertHardBreak', paragraphId, offset: 9 },
      { op: 'insertTab', paragraphId, offset: 15 },
      { op: 'insertTab', paragraphId, offset: 3 },
    ]);
    harness.apply(bob, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(bob, 0), offset, text: 'ZZ' },
    ]);
    resume();
    harness.expectConverged(alice, bob);
    expect(body(alice)).toContain('ZZ');
    expect(body(alice).match(/<w:tab\/>/g)).toHaveLength(2);
    expect(body(alice).match(/<w:br\/>/g)).toHaveLength(1);
  });
}

for (const [left, right] of [
  [9, 9],
  [9, 14],
] as const) {
  test(`two peers splitting the same text at ${left} and ${right} keep it once`, async () => {
    const { alice, bob, pause, resume } = await harness.pair(bytes);
    pause();
    harness.apply(alice, [
      { op: 'insertHardBreak', paragraphId: harness.paragraphIdAt(alice, 0), offset: left },
    ]);
    harness.apply(bob, [
      { op: 'insertTab', paragraphId: harness.paragraphIdAt(bob, 0), offset: right },
    ]);
    resume();
    harness.expectConverged(alice, bob);
    expect(body(alice).match(/Acme/g)).toHaveLength(1);
    expect(body(alice).match(/Street/g)).toHaveLength(1);
    const carol = await harness.join(alice, 'carol');
    harness.expectConverged(alice, carol);
  });
}

// A format split copies the run's text into new runs. An element another peer inserted into
// the run at the same time stays at its offset, in either order (issue #1133). A field is a run
// sequence of its own, from its begin character to its end character.
for (const op of ['insertHardBreak', 'insertTab', 'insertPageField'] as const) {
  const mark =
    op === 'insertHardBreak' ? '<w:br/>' : op === 'insertTab' ? '<w:tab/>' : 'w:fldCharType';
  const inserted = (paragraphId: string): TreeDocOp =>
    op === 'insertPageField'
      ? { op, paragraphId, offset: 9, field: 'PAGE' }
      : element(op, paragraphId);
  // The paragraph's text with the element as `|`, or a field as `[...]` around its result.
  const placed = (peer: Peer): string => {
    const out: string[] = [];
    const visit = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      if (node.localName === 't') {
        for (const child of node.children) if (child.kind === 'textValue') out.push(child.value);
        return;
      }
      if (node.localName === 'instrText') return;
      if (node.localName === 'br' || node.localName === 'tab') out.push('|');
      if (node.localName === 'fldChar') {
        const type = canonicalOoxmlFingerprint(node);
        if (type.includes('"begin"')) out.push('[');
        if (type.includes('"end"')) out.push(']');
      }
      for (const child of node.children) visit(child);
    };
    visit(peer.store.bodyStore().part.root);
    return out.join('');
  };
  for (const formatFirst of [false, true]) {
    test(`${op} and formatting of the same run made at once both survive (${formatFirst ? 'format' : 'element'} first)`, async () => {
      const { alice, bob, pause, resume } = await harness.pair(bytes);
      pause();
      const format = () =>
        harness.apply(bob, [
          {
            op: 'setRunProperties',
            paragraphId: harness.paragraphIdAt(bob, 0),
            start: 0,
            end: 4,
            properties: [{ localName: 'b' }],
          },
          // A second format over the element's offset: two generations of split runs.
          {
            op: 'setRunProperties',
            paragraphId: harness.paragraphIdAt(bob, 0),
            start: 2,
            end: 12,
            properties: [{ localName: 'i' }],
          },
        ]);
      if (formatFirst) format();
      harness.apply(alice, [inserted(harness.paragraphIdAt(alice, 0))]);
      if (!formatFirst) format();
      resume();
      harness.expectConverged(alice, bob);
      const merged = body(alice);
      expect(merged).toContain(mark);
      expect(merged).toContain('<w:b/>');
      expect(merged).toContain('<w:i/>');
      // The element still sits after "Acme Ltd ".
      expect(placed(alice)).toMatch(/^Acme Ltd (\||\[[^\]]*\])1 Main Street$/);
      expect(alice.room.session.undo()).toBe(true);
      harness.expectConverged(alice, bob);
      expect(body(alice)).not.toContain(mark);
      expect(body(alice)).toContain('<w:b/>');
      expect(alice.room.session.redo()).toBe(true);
      harness.expectConverged(alice, bob);
      expect(body(alice)).toBe(merged);
      const carol = await harness.join(alice, 'carol');
      harness.expectConverged(alice, carol);
      expect(body(carol)).toBe(merged);
    });
  }
}

// Undo by the peer whose split lost restores the original text, which supersedes every split of
// it, the other peer's included. That is the rule format splits follow, and released peers read
// the same shared state the same way, so the replicas converge with the text once.
test('undo after two splits of the same text converges with the text once', async () => {
  const { alice, bob, pause, resume } = await harness.pair(bytes);
  pause();
  harness.apply(alice, [
    { op: 'insertHardBreak', paragraphId: harness.paragraphIdAt(alice, 0), offset: 9 },
  ]);
  harness.apply(bob, [{ op: 'insertTab', paragraphId: harness.paragraphIdAt(bob, 0), offset: 14 }]);
  resume();
  harness.expectConverged(alice, bob);
  const loser = body(alice).includes('<w:tab/>') ? alice : bob;
  expect(loser.room.session.undo()).toBe(true);
  harness.expectConverged(alice, bob);
  expect(body(alice).match(/Acme/g)).toHaveLength(1);
  expect(body(alice).match(/Street/g)).toHaveLength(1);
  const carol = await harness.join(alice, 'carol');
  harness.expectConverged(alice, carol);
});
