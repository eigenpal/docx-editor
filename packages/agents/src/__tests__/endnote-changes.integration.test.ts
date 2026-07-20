import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import path from 'path';
import { DocxReviewer } from '../DocxReviewer';

const FIXTURE = path.resolve(__dirname, '../../../../e2e/fixtures/endnotes-tracked-changes.docx');

function loadBuffer(): ArrayBuffer {
  const buf = readFileSync(FIXTURE);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

describe('getChanges with a real endnote document (integration)', () => {
  test('does not report endnote changes unless opted in', async () => {
    const reviewer = await DocxReviewer.fromBuffer(loadBuffer());
    expect(reviewer.getChanges()).toHaveLength(0);
  });

  test('surfaces the tracked insertion inside the endnote when opted in', async () => {
    const reviewer = await DocxReviewer.fromBuffer(loadBuffer());
    const changes = reviewer.getChanges({ includeEndnotes: true });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      id: 100,
      type: 'insertion',
      author: 'Reviewer',
      text: 'tracked insertion',
      noteType: 'endnote',
      noteId: 2,
    });
  });
});
