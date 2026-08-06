// The review queue, derived in the STORE lane.
//
// The queue used to live in the layout lane, which meant anything that could not import layout —
// the automation lane, a headless host — had no way to answer "what comments does this document
// hold" without deriving it a second time. Two derivations of a reviewer's queue is how a comment
// comes to be listed by one surface and not the other, so the derivation moved here.
//
// These tests verify that the store barrel answers and that a comment inside a note — a story the
// old layout reader never reached through this path — is anchored rather than dropped.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  addComment,
  collectReviewItems,
  commentBodyText,
  commentPartNameOf,
  commentsExtendedPartNameOf,
  locateSites,
  readOoxmlPackage,
  readOoxmlPart,
  revisionItemsOf,
  TreeDocumentStore,
  type OoxmlPackage,
  type OoxmlPart,
} from '../index.ts';

const FIXTURE = resolve(
  import.meta.dir,
  '../../../../../e2e/fixtures/comprehensive-word-element-test.docx'
);

function fixture(): OoxmlPackage {
  const pkg = readOoxmlPackage(new Uint8Array(readFileSync(FIXTURE)));
  if (!pkg.ok) throw new Error(pkg.reason);
  return pkg.package;
}

function open(): TreeDocumentStore {
  const pkg = fixture();
  return new TreeDocumentStore(pkg, pkg.mainDocumentPart);
}

function paragraphWithText(story: OoxmlPart, length: number): string {
  const body = story.root.children.find((child) => child.kind === 'body');
  if (!body || body.kind === 'textValue') throw new Error('no body');
  for (const block of body.children) {
    if (block.kind !== 'paragraph') continue;
    let text = '';
    const visit = (node: { kind: string; children?: readonly unknown[]; value?: string }): void => {
      if (node.kind === 'textValue') text += node.value ?? '';
      for (const child of (node.children ?? []) as (typeof node)[]) visit(child);
    };
    visit(block as never);
    if (text.length >= length) return block.id;
  }
  throw new Error('no paragraph long enough');
}

describe('the store lane answers the review queue', () => {
  test('a comment written through the store is read back through the store', () => {
    const store = open();
    const paragraphId = paragraphWithText(store.part, 10);
    const added = addComment(store, {
      anchor: { paragraphId, start: 0, end: 5 },
      author: 'QA Reviewer',
      initials: 'QR',
      date: '2026-08-05T10:00:00Z',
      text: 'Check this claim.',
    });
    expect(added.ok).toBe(true);

    const pkg = store.package;
    const commentsPart = pkg.parts.get(commentPartNameOf(pkg, store.part.name));
    const items = collectReviewItems({
      storyPart: store.part,
      commentsPart,
      commentsExtendedPart: pkg.parts.get(commentsExtendedPartNameOf(pkg, store.part.name)),
    });
    const comment = items.find(
      (item) => item.kind === 'comment' && item.comment.author === 'QA Reviewer'
    );
    expect(comment).toBeDefined();
    if (comment?.kind !== 'comment') throw new Error('not a comment');
    expect(commentBodyText(comment.comment)).toBe('Check this claim.');
    expect(comment.resolved).toBe(false);
    expect(comment.orphaned).toBe(false);
    expect(comment.range?.start).toEqual({ paragraphId, offset: 0 });
    expect(comment.range?.end).toEqual({ paragraphId, offset: 5 });
  });
});

describe('tracked rows inside a textbox keep their anchors', () => {
  // A paragraph CAN hold table rows: a textbox in a run carries block content, tables
  // included. The site walk memoizes paragraph subtrees rather than pruning them — a
  // prune here silently turned the row's card rangeless (no band, no local patch).
  test('a tracked row deletion in a textbox table gets a range', () => {
    const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const result = readOoxmlPart(
      `<w:document xmlns:w="${W_NS}" xmlns:v="urn:schemas-microsoft-com:vml"><w:body>` +
        `<w:p><w:r><w:pict><v:textbox><w:txbxContent>` +
        `<w:tbl><w:tr>` +
        `<w:trPr><w:del w:id="9" w:author="Ada Reviewer" w:date="2026-01-01T00:00:00Z"/></w:trPr>` +
        `<w:tc><w:tcPr><w:cellDel w:id="9" w:author="Ada Reviewer" w:date="2026-01-01T00:00:00Z"/></w:tcPr>` +
        `<w:p><w:r><w:t>in the box</w:t></w:r></w:p></w:tc>` +
        `</w:tr></w:tbl>` +
        `</w:txbxContent></v:textbox></w:pict></w:r></w:p>` +
        `</w:body></w:document>`,
      {
        name: '/word/document.xml',
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
      }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    const part = result.part;

    const boxParagraphId = (() => {
      let inCell: string | null = null;
      const visit = (node: (typeof part)['root'], insideCell: boolean): void => {
        if (node.kind === 'textValue') return;
        if (node.kind === 'paragraph' && insideCell && inCell === null) {
          inCell = node.id;
          return;
        }
        for (const child of node.children) visit(child, insideCell || node.kind === 'tableCell');
      };
      visit(part.root, false);
      if (inCell === null) throw new Error('no textbox cell paragraph');
      return inCell;
    })();

    const located = locateSites(part);
    const cards = revisionItemsOf(part);
    const card = cards.find((item) => item.revisionKind === 'structural');
    expect(card).toBeDefined();
    expect(card!.ranges.length).toBeGreaterThan(0);
    expect(card!.ranges[0]!.start.paragraphId).toBe(boxParagraphId);
    // The memoized index answers repeat reads with the same instance.
    expect(locateSites(part)).toBe(located);
  });
});

describe('the revision-card memo is keyed on the part, not just its root', () => {
  test('two parts sharing one root under different names each get their own part name', () => {
    const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const result = readOoxmlPart(
      `<w:document xmlns:w="${W_NS}"><w:body>` +
        `<w:p><w:ins w:id="1" w:author="QA" w:date="2024-01-01T00:00:00Z">` +
        `<w:r><w:t>alpha</w:t></w:r></w:ins></w:p>` +
        `</w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!result.ok) throw new Error(result.reason);
    const part = result.part;
    // The items embed `ranges[*].partName`; a root-only cache key would hand the second
    // part the first part's stamped ranges.
    const first = revisionItemsOf(part);
    expect(first[0]!.ranges[0]!.partName).toBe('/word/document.xml');
    const renamed = revisionItemsOf({ ...part, name: '/word/header1.xml' });
    expect(renamed[0]!.ranges[0]!.partName).toBe('/word/header1.xml');
    // And the original still answers with its own name (recomputed or re-cached — either
    // way, never the other part's).
    expect(revisionItemsOf(part)[0]!.ranges[0]!.partName).toBe('/word/document.xml');
  });
});
