// The typed-text oracle must report lost and repeated typing, and excuse removed typing.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { paragraphTextOf, type OoxmlNode, type TreeDocOp } from '@docx-editor.dev/core/store';
import { storeFrom } from './document-text.ts';
import { DEFAULT_DOCUMENT } from './scenarios.ts';
import { applyOp, type Addressed } from './scenario-plan.ts';
import { TypedTokens } from './scenario-tokens.ts';

function firstParagraph(node: OoxmlNode): string | null {
  if (node.kind === 'paragraph') return node.id;
  if (node.kind === 'textValue') return null;
  for (const child of node.children) {
    const found = firstParagraph(child);
    if (found) return found;
  }
  return null;
}

function setup() {
  const store = storeFrom(new Uint8Array(readFileSync(DEFAULT_DOCUMENT)));
  const paragraphId = firstParagraph(store.bodyStore().part.root)!;
  const tokens = new TypedTokens();
  const addressed: Addressed = {
    kind: 'paragraph',
    op: { op: 'insertText', paragraphId, offset: 0, text: 'ab' } as TreeDocOp,
    paragraphs: [0],
  };
  const tagged = tokens.tag(addressed);
  const op = tagged.addressed.op as TreeDocOp & { text: string };
  expect(op.text.length).toBe(3);
  expect(applyOp(store, op, 'replica-0').ok).toBe(true);
  tokens.typedInto(tagged.token!, 0, paragraphId);
  return { store, paragraphId, tokens };
}

function apply(store: ReturnType<typeof storeFrom>, op: TreeDocOp): void {
  expect(applyOp(store, op, 'replica-0').ok).toBe(true);
}

describe('typed-text oracle', () => {
  test('typing that shows once passes', () => {
    const { store, tokens } = setup();
    expect(tokens.check([store.currentPackage()])).toEqual([]);
  });

  test('typing removed by nobody but missing is lost', () => {
    const { store, paragraphId, tokens } = setup();
    apply(store, { op: 'deleteText', paragraphId, start: 2, end: 3 } as TreeDocOp);
    expect(tokens.check([store.currentPackage()])).toEqual([
      'typed token 0 of replica 0 is lost, while the paragraph it was typed in remains',
    ]);
  });

  test('typing a replica deleted while it showed is excused', () => {
    const { store, paragraphId, tokens } = setup();
    const op = { op: 'deleteText', paragraphId, start: 2, end: 3 } as TreeDocOp;
    const before = tokens.beforeEdit(store, op);
    apply(store, op);
    tokens.afterEdit(store, before, 0);
    expect(tokens.check([store.currentPackage()])).toEqual([]);
  });

  test('typing that shows twice is reported', () => {
    const { store, paragraphId, tokens } = setup();
    const token = paragraphTextOf(store.bodyStore().part, paragraphId)!.charAt(2);
    apply(store, { op: 'insertText', paragraphId, offset: 0, text: token } as TreeDocOp);
    expect(tokens.check([store.currentPackage()])).toEqual([
      'typed token 0 of replica 0 shows 2 times',
    ]);
  });

  test('typing a replica deleted must not show again', () => {
    const { store, paragraphId, tokens } = setup();
    const token = paragraphTextOf(store.bodyStore().part, paragraphId)!.charAt(2);
    const op = { op: 'deleteText', paragraphId, start: 2, end: 3 } as TreeDocOp;
    const before = tokens.beforeEdit(store, op);
    apply(store, op);
    tokens.afterEdit(store, before, 1);
    // A peer's copy of the deleted text, as a concurrent move leaves it.
    apply(store, { op: 'insertText', paragraphId, offset: 0, text: token } as TreeDocOp);
    expect(tokens.check([store.currentPackage()])).toEqual([
      'typed token 0 of replica 0 shows again after replica 1 deleted it',
    ]);
  });

  test('an undo excuses only the typing it took out of shared text', () => {
    const { store, paragraphId, tokens } = setup();
    const textNow = (): string => paragraphTextOf(store.bodyStore().part, paragraphId) ?? '';
    const before = textNow();
    // An undo that changes something else leaves the token unexcused.
    apply(store, { op: 'insertText', paragraphId, offset: 0, text: 'x' } as TreeDocOp);
    tokens.undoOn(0, before, textNow());
    apply(store, { op: 'deleteText', paragraphId, start: 3, end: 4 } as TreeDocOp);
    expect(tokens.check([store.currentPackage()])).toEqual([
      'typed token 0 of replica 0 is lost, while the paragraph it was typed in remains',
    ]);
  });
});
