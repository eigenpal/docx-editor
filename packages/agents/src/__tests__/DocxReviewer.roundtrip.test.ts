/**
 * Headless save round-trip: a comment or tracked change made through
 * DocxReviewer must survive `toBuffer()` and a reload via `fromBuffer()`.
 *
 * Covers the gap left by the in-memory tests (which mutate a reviewer but never
 * serialize back) and the MCP integration test (which explicitly stops before
 * `toBuffer()`): nothing asserted that an edit reaches the saved bytes. This
 * matters most for the from-scratch case — the fixture has no comments part, so
 * the save path has to scaffold `comments.xml` + its content-type/rels rather
 * than patch an existing part. The final test inspects the saved zip directly
 * to confirm that wiring, since the reload path finds `comments.xml` by
 * hardcoded path and would pass even if the part were left unregistered.
 */
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { DocxReviewer } from '../DocxReviewer';

// Word-facing wiring for a freshly-scaffolded comments part. A reload via
// fromBuffer() only proves comments.xml parses (it's located by hardcoded
// path), so these constants let us assert the part is actually registered the
// way Word requires before it will open the file.
const COMMENTS_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml';
const COMMENTS_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';

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

  // The reload above proves comments.xml is parseable, but the part is located
  // by hardcoded path — it would still pass if the save dropped the
  // content-type Override and the document.xml.rels relationship, producing a
  // file Word refuses to open. These assert the part is actually wired up.
  test('scaffolds comments.xml content-type + relationship for a doc with none', async () => {
    const reviewer = await DocxReviewer.fromBuffer(loadBuffer(), 'Reviewer');
    reviewer.addComment(0, 'Round-trip comment.');

    const zip = await JSZip.loadAsync(await reviewer.toBuffer());

    // The part itself exists.
    expect(zip.file('word/comments.xml')).not.toBeNull();

    // [Content_Types].xml registers an Override for the part.
    const contentTypes = await zip.file('[Content_Types].xml')!.async('text');
    expect(contentTypes).toContain('PartName="/word/comments.xml"');
    expect(contentTypes).toContain(COMMENTS_CONTENT_TYPE);

    // document.xml.rels points the body at the comments part.
    const rels = await zip.file('word/_rels/document.xml.rels')!.async('text');
    expect(rels).toContain(COMMENTS_REL_TYPE);
    expect(rels).toMatch(/Target="comments\.xml"/);
  });
});
