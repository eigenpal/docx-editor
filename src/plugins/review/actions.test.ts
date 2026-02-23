import { describe, expect, test } from 'bun:test';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { schema } from '../../prosemirror/schema';
import type { Document, Paragraph, ParagraphContent } from '../../types/document';
import {
  applyBodyModelRevisionDecisionToDocument,
  applyBulkBodyModelRevisionDecisionToDocument,
  applyBulkHeaderFooterRevisionDecisionToDocument,
  applyHeaderFooterRevisionDecisionToDocument,
  canApplyBodyModelRevisionDecision,
  canApplyBulkBodyModelRevisionDecision,
  canApplyBulkHeaderFooterRevisionDecision,
  canApplyHeaderFooterRevisionDecision,
  createBulkRevisionDecisionTransaction,
  createRevisionDecisionTransaction,
} from './actions';
import { createReviewPluginState, extractRevisionsFromDoc } from './extractor';

function createParagraph(children: PMNode[]): PMNode {
  return schema.nodes.paragraph.create(null, children);
}

function createDoc(paragraphs: PMNode[]): PMNode {
  return schema.nodes.doc.create(null, paragraphs);
}

function createState(paragraphs: PMNode[]): EditorState {
  const doc = createDoc(paragraphs);
  return EditorState.create({ schema, doc });
}

function createBodyOnlyDoc(): PMNode {
  return createParagraph([schema.text('Body content')]);
}

function getFirstHeaderParagraph(document: Document): Paragraph {
  const header = document.package.headers?.get('rId1');
  if (!header) {
    throw new Error('Missing header rId1');
  }
  const paragraph = header.content[0];
  if (!paragraph || paragraph.type !== 'paragraph') {
    throw new Error('Missing header paragraph');
  }
  return paragraph;
}

function createHeaderFooterDocumentModel(): Document {
  return {
    package: {
      document: {
        content: [],
        finalSectionProperties: {
          headerReferences: [{ type: 'first', rId: 'rId1' }],
          footerReferences: [],
        },
      },
      headers: new Map([
        [
          'rId1',
          {
            type: 'header',
            hdrFtrType: 'first',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'run', content: [{ type: 'text', text: 'Start ' }] },
                  {
                    type: 'insertion',
                    info: { id: 9001, author: 'Alice', date: '2026-02-19T12:00:00Z' },
                    content: [{ type: 'run', content: [{ type: 'text', text: 'InsertMe ' }] }],
                  },
                  {
                    type: 'deletion',
                    info: { id: 9002, author: 'Alice', date: '2026-02-19T12:00:00Z' },
                    content: [{ type: 'run', content: [{ type: 'text', text: 'DeleteMe ' }] }],
                  },
                  { type: 'run', content: [{ type: 'text', text: 'End' }] },
                ] as ParagraphContent[],
              },
            ],
          },
        ],
      ]),
    },
  };
}

function createBodyFormattingRevisionDocumentModel(): Document {
  return {
    package: {
      document: {
        content: [
          {
            type: 'paragraph',
            paraId: 'ABCD1234',
            formatting: {
              styleId: 'SummaryPara',
            },
            paragraphPropertiesChange: {
              info: { id: 857, author: 'Alice', date: '2026-02-19T12:00:00Z' },
              previousFormatting: {
                styleId: 'BodyText1',
              },
            },
            content: [{ type: 'run', content: [{ type: 'text', text: 'Clause text' }] }],
          },
        ],
      },
    },
  };
}

function hasTrackedMark(state: EditorState, markName: string): boolean {
  let found = false;
  state.doc.descendants((node) => {
    if (!node.isText) return true;
    if (node.marks.some((mark) => mark.type.name === markName)) {
      found = true;
      return false;
    }
    return true;
  });
  return found;
}

describe('review actions', () => {
  test('accepting insertion removes insertion mark and keeps text', () => {
    const insertion = schema.marks.insertion.create({
      revisionId: 101,
      author: 'Alice',
      date: '2026-02-19T12:00:00Z',
    });
    const state = createState([createParagraph([schema.text('Added', [insertion])])]);

    const revisions = extractRevisionsFromDoc(state.doc);
    const revisionId = revisions[0]?.id;
    expect(revisionId).toBeDefined();

    const tr = createRevisionDecisionTransaction(state, revisions, revisionId!, 'accept');
    expect(tr).toBeTruthy();

    const next = state.apply(tr!);
    expect(next.doc.textContent).toBe('Added');
    expect(hasTrackedMark(next, 'insertion')).toBe(false);
  });

  test('rejecting insertion deletes inserted text', () => {
    const insertion = schema.marks.insertion.create({
      revisionId: 102,
      author: 'Alice',
      date: '2026-02-19T12:00:00Z',
    });
    const state = createState([createParagraph([schema.text('Added', [insertion])])]);
    const revisions = extractRevisionsFromDoc(state.doc);

    const tr = createRevisionDecisionTransaction(state, revisions, revisions[0]!.id, 'reject');
    expect(tr).toBeTruthy();

    const next = state.apply(tr!);
    expect(next.doc.textContent).toBe('');
  });

  test('accepting deletion removes deleted text from document', () => {
    const deletion = schema.marks.deletion.create({
      revisionId: 103,
      author: 'Alice',
      date: '2026-02-19T12:00:00Z',
    });
    const state = createState([createParagraph([schema.text('Removed', [deletion])])]);
    const revisions = extractRevisionsFromDoc(state.doc);

    const tr = createRevisionDecisionTransaction(state, revisions, revisions[0]!.id, 'accept');
    expect(tr).toBeTruthy();

    const next = state.apply(tr!);
    expect(next.doc.textContent).toBe('');
  });

  test('rejecting deletion keeps text and removes deletion mark', () => {
    const deletion = schema.marks.deletion.create({
      revisionId: 104,
      author: 'Alice',
      date: '2026-02-19T12:00:00Z',
    });
    const state = createState([createParagraph([schema.text('Removed', [deletion])])]);
    const revisions = extractRevisionsFromDoc(state.doc);

    const tr = createRevisionDecisionTransaction(state, revisions, revisions[0]!.id, 'reject');
    expect(tr).toBeTruthy();

    const next = state.apply(tr!);
    expect(next.doc.textContent).toBe('Removed');
    expect(hasTrackedMark(next, 'deletion')).toBe(false);
  });

  test('accepting move removes source and keeps destination without move mark', () => {
    const moveFrom = schema.marks.moveFrom.create({
      revisionId: 105,
      author: 'Alice',
      date: '2026-02-19T12:00:00Z',
      rangeId: 700,
    });
    const moveTo = schema.marks.moveTo.create({
      revisionId: 106,
      author: 'Alice',
      date: '2026-02-19T12:00:00Z',
      rangeId: 700,
    });
    const state = createState([
      createParagraph([schema.text('Moved text', [moveFrom])]),
      createParagraph([schema.text('Moved text', [moveTo])]),
    ]);
    const revisions = extractRevisionsFromDoc(state.doc);
    const moveRevision = revisions.find((item) => item.type === 'moveFrom');
    expect(moveRevision).toBeTruthy();

    const tr = createRevisionDecisionTransaction(state, revisions, moveRevision!.id, 'accept');
    expect(tr).toBeTruthy();

    const next = state.apply(tr!);
    expect(next.doc.textContent).toBe('Moved text');
    expect(hasTrackedMark(next, 'moveTo')).toBe(false);
    expect(hasTrackedMark(next, 'moveFrom')).toBe(false);
  });

  test('bulk reject applies only supported revisions', () => {
    const insertion = schema.marks.insertion.create({
      revisionId: 107,
      author: 'Alice',
      date: '2026-02-19T12:00:00Z',
    });
    const deletion = schema.marks.deletion.create({
      revisionId: 108,
      author: 'Bob',
      date: '2026-02-19T12:00:00Z',
    });

    const state = createState([
      createParagraph([
        schema.text('Base '),
        schema.text('Add', [insertion]),
        schema.text(' Remove', [deletion]),
      ]),
    ]);
    const revisions = extractRevisionsFromDoc(state.doc);

    const tr = createBulkRevisionDecisionTransaction(state, revisions, 'reject');
    expect(tr).toBeTruthy();

    const next = state.apply(tr!);
    expect(next.doc.textContent).toBe('Base  Remove');
    expect(hasTrackedMark(next, 'insertion')).toBe(false);
    expect(hasTrackedMark(next, 'deletion')).toBe(false);
  });

  test('applies single header/footer revision decision to document model', () => {
    const pmDoc = createDoc([createBodyOnlyDoc()]);
    const documentModel = createHeaderFooterDocumentModel();
    const pluginState = createReviewPluginState(pmDoc, 1, 1, documentModel);
    const insertionRevision = pluginState.revisions.find(
      (revision) => revision.location === 'header' && revision.type === 'insertion'
    );
    expect(insertionRevision).toBeDefined();
    expect(canApplyHeaderFooterRevisionDecision(pluginState.revisions, insertionRevision!.id)).toBe(
      true
    );

    const updated = applyHeaderFooterRevisionDecisionToDocument(
      documentModel,
      pluginState.revisions,
      insertionRevision!.id,
      'reject'
    );

    expect(updated).toBeTruthy();
    const paragraph = getFirstHeaderParagraph(updated!);
    expect(paragraph.content.some((item) => item.type === 'insertion')).toBe(false);
    expect(paragraph.content.some((item) => item.type === 'deletion')).toBe(true);
  });

  test('applies bulk header/footer decisions to document model', () => {
    const pmDoc = createDoc([createBodyOnlyDoc()]);
    const documentModel = createHeaderFooterDocumentModel();
    const pluginState = createReviewPluginState(pmDoc, 1, 1, documentModel);
    expect(canApplyBulkHeaderFooterRevisionDecision(pluginState.revisions)).toBe(true);

    const updated = applyBulkHeaderFooterRevisionDecisionToDocument(
      documentModel,
      pluginState.revisions,
      'accept'
    );

    expect(updated).toBeTruthy();
    const paragraph = getFirstHeaderParagraph(updated!);
    expect(paragraph.content.some((item) => item.type === 'insertion')).toBe(false);
    expect(paragraph.content.some((item) => item.type === 'deletion')).toBe(false);
    expect(paragraph.content.some((item) => item.type === 'run')).toBe(true);
  });

  test('applies single body formatting revision decision to document model', () => {
    const pmDoc = createDoc([
      schema.nodes.paragraph.create({ paraId: 'ABCD1234' }, [schema.text('x')]),
    ]);
    const documentModel = createBodyFormattingRevisionDocumentModel();
    const pluginState = createReviewPluginState(pmDoc, 1, 1, documentModel);
    const formatRevision = pluginState.revisions.find(
      (revision) => revision.type === 'formatChange'
    );
    expect(formatRevision).toBeDefined();
    expect(canApplyBodyModelRevisionDecision(pluginState.revisions, formatRevision!.id)).toBe(true);

    const accepted = applyBodyModelRevisionDecisionToDocument(
      documentModel,
      pluginState.revisions,
      formatRevision!.id,
      'accept'
    );
    expect(accepted).toBeTruthy();
    const acceptedParagraph = accepted!.package.document.content[0];
    expect(acceptedParagraph?.type).toBe('paragraph');
    if (acceptedParagraph?.type !== 'paragraph') return;
    expect(acceptedParagraph.paragraphPropertiesChange).toBeUndefined();

    const rejected = applyBodyModelRevisionDecisionToDocument(
      documentModel,
      pluginState.revisions,
      formatRevision!.id,
      'reject'
    );
    expect(rejected).toBeTruthy();
    const rejectedParagraph = rejected!.package.document.content[0];
    expect(rejectedParagraph?.type).toBe('paragraph');
    if (rejectedParagraph?.type !== 'paragraph') return;
    expect(rejectedParagraph.paragraphPropertiesChange).toBeUndefined();
    expect(rejectedParagraph.formatting?.styleId).toBe('BodyText1');
  });

  test('applies bulk body formatting decisions to document model', () => {
    const pmDoc = createDoc([
      schema.nodes.paragraph.create({ paraId: 'ABCD1234' }, [schema.text('x')]),
    ]);
    const documentModel = createBodyFormattingRevisionDocumentModel();
    const pluginState = createReviewPluginState(pmDoc, 1, 1, documentModel);

    expect(canApplyBulkBodyModelRevisionDecision(pluginState.revisions)).toBe(true);
    const updated = applyBulkBodyModelRevisionDecisionToDocument(
      documentModel,
      pluginState.revisions,
      'accept'
    );
    expect(updated).toBeTruthy();
    const paragraph = updated!.package.document.content[0];
    expect(paragraph?.type).toBe('paragraph');
    if (paragraph?.type !== 'paragraph') return;
    expect(paragraph.paragraphPropertiesChange).toBeUndefined();
  });
});
