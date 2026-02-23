import { describe, expect, test } from 'bun:test';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '../../prosemirror/schema';
import type { Document } from '../../types/document';
import {
  createReviewPluginState,
  extractRevisionsFromDoc,
  findActiveRevisionId,
} from './extractor';

function createDoc(paragraphs: PMNode[]): PMNode {
  return schema.nodes.doc.create(null, paragraphs);
}

function createParagraph(children: PMNode[]): PMNode {
  return schema.nodes.paragraph.create(null, children);
}

describe('review extractor', () => {
  test('merges adjacent insertion spans with identical metadata', () => {
    const insertion = schema.marks.insertion.create({
      revisionId: 11,
      author: 'Alice',
      date: '2026-02-19T12:00:00Z',
    });

    const doc = createDoc([
      createParagraph([schema.text('Hello ', [insertion]), schema.text('World', [insertion])]),
    ]);

    const revisions = extractRevisionsFromDoc(doc);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.type).toBe('insertion');
    expect(revisions[0]?.textPreview).toBe('Hello World');
    expect(revisions[0]?.status).toBe('supported');
  });

  test('pairs moveFrom and moveTo by rangeId when unambiguous', () => {
    const moveFrom = schema.marks.moveFrom.create({
      revisionId: 21,
      author: 'Alice',
      date: '2026-02-19T12:00:00Z',
      rangeId: 90,
    });
    const moveTo = schema.marks.moveTo.create({
      revisionId: 22,
      author: 'Alice',
      date: '2026-02-19T12:00:00Z',
      rangeId: 90,
    });

    const doc = createDoc([
      createParagraph([schema.text('Old location', [moveFrom])]),
      createParagraph([schema.text('New location', [moveTo])]),
    ]);

    const revisions = extractRevisionsFromDoc(doc);
    expect(revisions).toHaveLength(2);

    const from = revisions.find((item) => item.type === 'moveFrom');
    const to = revisions.find((item) => item.type === 'moveTo');
    expect(from?.status).toBe('supported');
    expect(to?.status).toBe('supported');
    expect(from?.pairId).toBe(to?.id ?? null);
    expect(to?.pairId).toBe(from?.id ?? null);
  });

  test('pairs moveFrom and moveTo by rangeName when rangeIds differ', () => {
    const moveFrom = schema.marks.moveFrom.create({
      revisionId: 221,
      author: 'Alice',
      date: '2026-02-19T12:00:00Z',
      rangeId: 231,
      rangeName: 'move7',
    });
    const moveTo = schema.marks.moveTo.create({
      revisionId: 222,
      author: 'Alice',
      date: '2026-02-19T12:00:00Z',
      rangeId: 193,
      rangeName: 'move7',
    });

    const doc = createDoc([
      createParagraph([schema.text('Old location', [moveFrom])]),
      createParagraph([schema.text('New location', [moveTo])]),
    ]);

    const revisions = extractRevisionsFromDoc(doc);
    expect(revisions).toHaveLength(2);

    const from = revisions.find((item) => item.type === 'moveFrom');
    const to = revisions.find((item) => item.type === 'moveTo');
    expect(from?.status).toBe('supported');
    expect(to?.status).toBe('supported');
    expect(from?.pairId).toBe(to?.id ?? null);
    expect(to?.pairId).toBe(from?.id ?? null);
  });

  test('pairs moveFrom and moveTo when only rangeName is available', () => {
    const moveFrom = schema.marks.moveFrom.create({
      revisionId: 321,
      author: 'Alice',
      date: '2026-02-19T12:00:00Z',
      rangeName: 'move-name-only',
    });
    const moveTo = schema.marks.moveTo.create({
      revisionId: 322,
      author: 'Alice',
      date: '2026-02-19T12:00:00Z',
      rangeName: 'move-name-only',
    });

    const doc = createDoc([
      createParagraph([schema.text('Old location', [moveFrom])]),
      createParagraph([schema.text('New location', [moveTo])]),
    ]);

    const revisions = extractRevisionsFromDoc(doc);
    expect(revisions).toHaveLength(2);

    const from = revisions.find((item) => item.type === 'moveFrom');
    const to = revisions.find((item) => item.type === 'moveTo');
    expect(from?.status).toBe('supported');
    expect(to?.status).toBe('supported');
    expect(from?.pairId).toBe(to?.id ?? null);
    expect(to?.pairId).toBe(from?.id ?? null);
  });

  test('marks incomplete move pairs as unsupported', () => {
    const moveFrom = schema.marks.moveFrom.create({
      revisionId: 31,
      author: 'Alice',
      date: '2026-02-19T12:00:00Z',
      rangeId: 120,
    });

    const doc = createDoc([createParagraph([schema.text('Only source', [moveFrom])])]);
    const revisions = extractRevisionsFromDoc(doc);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.status).toBe('unsupported');
    expect(revisions[0]?.reason).toContain('Move revision pair');
  });

  test('marks overlapping tracked marks as unsupported', () => {
    const insertion = schema.marks.insertion.create({
      revisionId: 41,
      author: 'Alice',
      date: '2026-02-19T12:00:00Z',
    });
    const deletion = schema.marks.deletion.create({
      revisionId: 42,
      author: 'Bob',
      date: '2026-02-19T12:00:00Z',
    });

    const doc = createDoc([createParagraph([schema.text('Overlap', [insertion, deletion])])]);
    const revisions = extractRevisionsFromDoc(doc);
    expect(revisions).toHaveLength(2);
    expect(revisions.every((item) => item.status === 'unsupported')).toBe(true);
  });

  test('finds active revision id by selection range', () => {
    const insertion = schema.marks.insertion.create({
      revisionId: 51,
      author: 'Alice',
      date: '2026-02-19T12:00:00Z',
    });
    const doc = createDoc([createParagraph([schema.text('Alpha', [insertion])])]);
    const revisions = extractRevisionsFromDoc(doc);
    const activeId = findActiveRevisionId(revisions, 2, 2);
    expect(activeId).toBe(revisions[0]?.id ?? null);
  });

  test('does not keep revision active when caret is at end boundary', () => {
    const insertion = schema.marks.insertion.create({
      revisionId: 52,
      author: 'Alice',
      date: '2026-02-19T12:00:00Z',
    });
    const doc = createDoc([createParagraph([schema.text('Alpha', [insertion])])]);
    const revisions = extractRevisionsFromDoc(doc);
    const first = revisions[0];
    expect(first).toBeDefined();

    const activeId = findActiveRevisionId(revisions, first!.to, first!.to);
    expect(activeId).toBeNull();
  });

  test('extracts first-page header/footer tracked changes from document model', () => {
    const doc = createDoc([createParagraph([schema.text('Body content')])]);
    const documentModel: Document = {
      package: {
        document: {
          content: [],
          finalSectionProperties: {
            headerReferences: [{ type: 'first', rId: 'rId15' }],
            footerReferences: [],
          },
        },
        headers: new Map([
          [
            'rId15',
            {
              type: 'header',
              hdrFtrType: 'first',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'deletion',
                      info: {
                        id: 23,
                        author: 'Nosce, Nicholas',
                        date: '2026-01-26T08:38:00Z',
                      },
                      content: [
                        { type: 'run', content: [{ type: 'text', text: 'R&G Draft 6/6/24' }] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        ]),
      },
    };

    const state = createReviewPluginState(doc, 1, 1, documentModel);
    expect(state.totalCount).toBe(1);
    expect(state.supportedCount).toBe(1);
    expect(state.unsupportedCount).toBe(0);

    const revision = state.revisions[0];
    expect(revision?.location).toBe('header');
    expect(revision?.headerFooterRefType).toBe('first');
    expect(revision?.anchorPageNumber).toBe(1);
    expect(revision?.sourceRelationshipId).toBe('rId15');
    expect(revision?.sourceChangeIndex).toBe(0);
    expect(revision?.textPreview).toContain('R&G Draft 6/6/24');
  });

  test('extracts paragraph formatting change revisions from body document model', () => {
    const pmParagraph = schema.nodes.paragraph.create({ paraId: 'ABCD1234' }, [
      schema.text('Clause text'),
    ]);
    const pmDoc = createDoc([pmParagraph]);

    const documentModel: Document = {
      package: {
        document: {
          content: [
            {
              type: 'paragraph',
              paraId: 'ABCD1234',
              formatting: { styleId: 'SummaryPara' },
              paragraphPropertiesChange: {
                info: {
                  id: 857,
                  author: 'Nosce, Nicholas',
                  date: '2026-01-26T08:38:00Z',
                },
                previousFormatting: { styleId: 'BodyText1' },
              },
              paragraphMarkMoveRevisions: [
                {
                  type: 'moveTo',
                  info: {
                    id: 856,
                    author: 'Nosce, Nicholas',
                    date: '2026-01-26T08:38:00Z',
                  },
                },
              ],
              content: [{ type: 'run', content: [{ type: 'text', text: 'Clause text' }] }],
            },
          ],
        },
      },
    };

    const state = createReviewPluginState(pmDoc, 1, 1, documentModel);
    const formatChange = state.revisions.find((revision) => revision.type === 'formatChange');
    expect(formatChange).toBeDefined();
    expect(formatChange?.status).toBe('supported');
    expect(formatChange?.applyTarget).toBe('documentModel');
    expect(formatChange?.sourceParagraphId).toBe('ABCD1234');
    expect(formatChange?.sourceParagraphChangeKind).toBe('paragraphProperties');

    const paragraphMarkMove = state.revisions.find(
      (revision) => revision.type === 'moveTo' && revision.sourceParagraphId === 'ABCD1234'
    );
    expect(paragraphMarkMove).toBeDefined();
    expect(paragraphMarkMove?.status).toBe('unsupported');
    expect(paragraphMarkMove?.reason).toContain('read-only');
  });
});
