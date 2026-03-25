import { describe, test, expect } from 'bun:test';
import type { Comment } from '../../types/content';
import { serializeComments } from './commentSerializer';

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 1,
    author: 'Alice',
    date: '2024-01-01T00:00:00Z',
    content: [
      { type: 'paragraph', content: [{ type: 'run', content: [{ type: 'text', text: 'Test' }] }] },
    ],
    ...overrides,
  };
}

describe('commentSerializer', () => {
  describe('w:done (resolved state) — #216', () => {
    test('serializes w:done="1" when comment is resolved', () => {
      const xml = serializeComments([makeComment({ done: true })]);
      expect(xml).toContain('w:done="1"');
    });

    test('omits w:done when comment is not resolved', () => {
      const xml = serializeComments([makeComment({ done: false })]);
      expect(xml).not.toContain('w:done');
    });

    test('omits w:done when done is undefined', () => {
      const xml = serializeComments([makeComment()]);
      expect(xml).not.toContain('w:done');
    });
  });

  describe('w16cid:parentId (reply threading) — #217', () => {
    test('serializes parentId for replies', () => {
      const xml = serializeComments([makeComment({ id: 1 }), makeComment({ id: 2, parentId: 1 })]);
      expect(xml).toContain('w16cid:parentId="1"');
    });

    test('omits parentId for top-level comments', () => {
      const xml = serializeComments([makeComment({ id: 1 })]);
      expect(xml).not.toContain('parentId');
    });

    test('includes w16cid namespace declaration', () => {
      const xml = serializeComments([makeComment({ id: 1 }), makeComment({ id: 2, parentId: 1 })]);
      expect(xml).toContain('xmlns:w16cid=');
    });

    test('serializes top-level comments before replies', () => {
      const xml = serializeComments([makeComment({ id: 2, parentId: 1 }), makeComment({ id: 1 })]);
      const topPos = xml.indexOf('w:id="1"');
      const replyPos = xml.indexOf('w:id="2"');
      expect(topPos).toBeLessThan(replyPos);
    });
  });
});
