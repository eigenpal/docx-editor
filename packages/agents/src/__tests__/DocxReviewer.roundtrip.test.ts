/**
 * Headless save round-trip: a comment or tracked change made through
 * DocxReviewer must survive `toBuffer()` and a reload via `fromBuffer()`.
 *
 * Covers the gap left by the in-memory tests (which mutate a reviewer but never
 * serialize back) and the MCP integration test (which explicitly stops before
 * `toBuffer()`): nothing asserted that an edit reaches the saved bytes. This
 * matters most for the from-scratch case — the fixture has no comments part, so
 * the save path has to scaffold `comments.xml` + its content-type/rels rather
 * than patch an existing part.
 */
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import path from 'path';
import { DocxReviewer } from '../DocxReviewer';

// A small, clean fixture: a handful of paragraphs, no pre-existing comments or
// tracked changes, so post-reload counts are unambiguous.
const FIXTURE = path.resolve(__dirname, '../../../../e2e/fixtures/styled-content.docx');

function loadBuffer(): ArrayBuffer {
  const buf = readFileSync(FIXTURE);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** Mutate → serialize → reparse, returning a fresh reviewer over the saved bytes. */
async function roundTrip(reviewer: DocxReviewer): Promise<DocxReviewer> {
  return DocxReviewer.fromBuffer(await reviewer.toBuffer(), 'Reviewer');
}

describe('DocxReviewer headless save round-trip', () => {
  test('the fixture starts with no comments or changes', async () => {
    const reviewer = await DocxReviewer.fromBuffer(loadBuffer(), 'Reviewer');
    expect(reviewer.getComments()).toHaveLength(0);
    expect(reviewer.getChanges()).toHaveLength(0);
  });

  test('a comment added to a doc with none persists through save + reload', async () => {
    const reviewer = await DocxReviewer.fromBuffer(loadBuffer(), 'Reviewer');
    reviewer.addComment(0, 'Round-trip comment.');

    const reloaded = await roundTrip(reviewer);
    const comments = reloaded.getComments();
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ author: 'Reviewer', text: 'Round-trip comment.' });
  });

  test('a tracked insertion persists through save + reload', async () => {
    const reviewer = await DocxReviewer.fromBuffer(loadBuffer(), 'Reviewer');
    reviewer.proposeInsertion({ paragraphIndex: 0, insertText: ' [inserted]' });

    const reloaded = await roundTrip(reviewer);
    const changes = reloaded.getChanges();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      type: 'insertion',
      author: 'Reviewer',
      text: ' [inserted]',
    });
  });

  test('a comment and a tracked change survive together in one save', async () => {
    const reviewer = await DocxReviewer.fromBuffer(loadBuffer(), 'Reviewer');
    reviewer.addComment(0, 'Needs a citation.');
    reviewer.proposeInsertion({ paragraphIndex: 1, insertText: ' [inserted]' });

    const reloaded = await roundTrip(reviewer);
    expect(reloaded.getComments()).toHaveLength(1);
    expect(reloaded.getChanges()).toHaveLength(1);
  });
});
