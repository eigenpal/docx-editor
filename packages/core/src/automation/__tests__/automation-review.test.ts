// Comments and tracked changes: the two things a document holds that are ABOUT its text.
//
// Both are derived in the store lane, where the review rail already reads them, and that is the
// point of these tests. A second derivation here would eventually disagree with the pane on
// screen — a comment listed by a script and missing from the rail, a change the rail offers to
// accept and the object model cannot find — so the protocol asks the SAME question the surface
// asks, and these tests pin the answers to a real package rather than to a fixture of items.
//
// WHAT A REVISION CAN BE ASKED TO DO is narrower than what it can be asked about. A structural
// revision — a row, a cell, a section, the table grid — is one the engine refuses to resolve, and
// a decision that can only answer refusals is not handed back as an object at all.

import { describe, expect, test } from 'bun:test';
import { CONTENT_TYPES, REL_TYPES, richDocx, type SidePart } from './support/furniture.ts';
import {
  handleAt,
  handlesAt,
  open,
  refusal,
  reopen,
  roots,
  spanAt,
  textAt,
} from './support/protocol.ts';
import type { AutomationHandle, AutomationHost } from '../protocol.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';

const commentsPart = (inner: string): SidePart => ({
  name: 'word/comments.xml',
  contentType: CONTENT_TYPES.comments,
  xml: `<w:comments xmlns:w="${W}" xmlns:w14="${W14}">${inner}</w:comments>`,
});

const commentsExtendedPart = (inner: string): SidePart => ({
  name: 'word/commentsExtended.xml',
  contentType:
    'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml',
  xml: `<w15:commentsEx xmlns:w15="${W15}">${inner}</w15:commentsEx>`,
});

const comment = (id: string, author: string, paraId: string, text: string): string =>
  `<w:comment w:id="${id}" w:author="${author}" w:initials="${author[0] ?? 'x'}" ` +
  `w:date="2026-01-0${id}T10:00:00Z">` +
  `<w:p w14:paraId="${paraId}"><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:comment>`;

/** A body with one commented stretch and one tracked insertion and deletion. */
function reviewed(): AutomationHost {
  return open(
    richDocx({
      body:
        `<w:p><w:commentRangeStart w:id="1"/><w:r><w:t>reviewed</w:t></w:r>` +
        `<w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r>` +
        `<w:r><w:t xml:space="preserve"> words</w:t></w:r></w:p>` +
        `<w:p><w:ins w:id="10" w:author="Ada" w:date="2026-02-01T09:00:00Z">` +
        `<w:r><w:t>added</w:t></w:r></w:ins>` +
        `<w:del w:id="11" w:author="Grace" w:date="2026-02-02T09:00:00Z">` +
        `<w:r><w:delText>gone</w:delText></w:r></w:del></w:p>`,
      rels: [
        { id: 'rId5', type: REL_TYPES.comments, target: 'comments.xml' },
        {
          id: 'rId6',
          type: 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended',
          target: 'commentsExtended.xml',
        },
      ],
      parts: [
        commentsPart(
          comment('1', 'Ada', '11111111', 'the remark') +
            comment('2', 'Grace', '22222222', 'a reply')
        ),
        commentsExtendedPart(
          `<w15:commentEx w15:paraId="11111111" w15:done="0"/>` +
            `<w15:commentEx w15:paraId="22222222" w15:paraIdParent="11111111" w15:done="0"/>`
        ),
      ],
    })
  );
}

function commentsOf(host: AutomationHost, body: AutomationHandle): readonly AutomationHandle[] {
  return handlesAt(host.execute({ operations: [{ op: 'getComments', scope: { body } }] }), 0);
}

function flagOf(host: AutomationHost, comment: AutomationHandle): boolean {
  const response = host.execute({ operations: [{ op: 'getCommentResolved', comment }] });
  const result = response.results[0];
  if (result?.status !== 'ok' || result.value.kind !== 'flag') {
    throw new Error(`expected a flag: ${JSON.stringify(response)}`);
  }
  return result.value.value;
}

function revisionsOf(host: AutomationHost, body: AutomationHandle): readonly AutomationHandle[] {
  return handlesAt(host.execute({ operations: [{ op: 'getRevisions', body }] }), 0);
}

describe('a document holds its comments, and a script reads the same ones the rail shows', () => {
  test('a story answers its top-level comments, replies under them rather than beside them', () => {
    const host = reviewed();
    const { body } = roots(host);
    const found = commentsOf(host, body);
    expect(found.length).toBe(1);
    const [first] = found as [AutomationHandle];
    const replies = handlesAt(
      host.execute({ operations: [{ op: 'getCommentReplies', comment: first }] }),
      0
    );
    expect(replies.length).toBe(1);
    expect(
      textAt(host.execute({ operations: [{ op: 'getCommentText', comment: replies[0]! }] }), 0)
    ).toBe('a reply');
  });

  test('a comment answers who wrote it, when, and what it says', () => {
    const host = reviewed();
    const { body } = roots(host);
    const [first] = commentsOf(host, body) as [AutomationHandle];
    const response = host.execute({
      operations: [
        { op: 'getCommentAuthor', comment: first },
        { op: 'getCommentDate', comment: first },
        { op: 'getCommentText', comment: first },
      ],
    });
    // No address: `CT_Comment` records an author and initials and nothing else. Word's own
    // `authorEmail` comes from `people.xml`, which this slice does not read — see the omissions.
    expect([0, 1, 2].map((index) => textAt(response, index))).toEqual([
      'Ada',
      '2026-01-01T10:00:00Z',
      'the remark',
    ]);
  });

  test('a comment answers the words it is about', () => {
    const host = reviewed();
    const { body } = roots(host);
    const [first] = commentsOf(host, body) as [AutomationHandle];
    const span = spanAt(host.execute({ operations: [{ op: 'getCommentRange', comment: first }] }), 0);
    expect(textAt(host.execute({ operations: [{ op: 'getSpanText', span }] }), 0)).toBe('reviewed');
  });

  test('an unresolved comment says so, and resolving it survives save and reopen', () => {
    const host = reviewed();
    const { body } = roots(host);
    const [first] = commentsOf(host, body) as [AutomationHandle];
    expect(flagOf(host, first)).toBe(false);

    const response = host.execute({
      operations: [{ op: 'setCommentResolved', comment: first, resolved: true }],
    });
    expect(response.ok).toBe(true);
    expect(response.changed).toBe(true);

    const next = reopen(host);
    const [reopened] = commentsOf(next.host, next.body) as [AutomationHandle];
    expect(flagOf(next.host, reopened)).toBe(true);
    // A THREAD resolves as one, which is what resolving means in Word: the reply is not left
    // open under a closed remark.
    const replies = handlesAt(
      next.host.execute({ operations: [{ op: 'getCommentReplies', comment: reopened }] }),
      0
    );
    expect(flagOf(next.host, replies[0]!)).toBe(true);
  });

  test('reopening a resolved comment is the same operation the other way', () => {
    const host = reviewed();
    const { body } = roots(host);
    const [first] = commentsOf(host, body) as [AutomationHandle];
    expect(host.execute({ operations: [{ op: 'setCommentResolved', comment: first, resolved: true }] }).ok).toBe(true);
    const mid = reopen(host);
    const [again] = commentsOf(mid.host, mid.body) as [AutomationHandle];
    expect(mid.host.execute({ operations: [{ op: 'setCommentResolved', comment: again, resolved: false }] }).ok).toBe(true);
    const next = reopen(mid.host);
    expect(flagOf(next.host, commentsOf(next.host, next.body)[0]!)).toBe(false);
  });

  test('a reply is authored on the comment’s own range, and reads back as its reply', () => {
    const host = reviewed();
    const { body } = roots(host);
    const [first] = commentsOf(host, body) as [AutomationHandle];
    const response = host.execute({
      operations: [{ op: 'replyToComment', comment: first, text: 'agreed', author: 'Linus' }],
    });
    expect(response.ok).toBe(true);

    const next = reopen(host);
    const [reopened] = commentsOf(next.host, next.body) as [AutomationHandle];
    const replies = handlesAt(
      next.host.execute({ operations: [{ op: 'getCommentReplies', comment: reopened }] }),
      0
    );
    const texts = replies.map((reply, index) =>
      textAt(
        next.host.execute({
          operations: replies.map((each) => ({ op: 'getCommentText' as const, comment: each })),
        }),
        index
      )
    );
    expect(texts).toContain('agreed');
  });

  test('a comment answers the id the document holds it under, and a reply answers as an object', () => {
    const host = reviewed();
    const { body } = roots(host);
    const [first] = commentsOf(host, body) as [AutomationHandle];
    expect(textAt(host.execute({ operations: [{ op: 'getCommentId', comment: first }] }), 0)).toBe(
      '1'
    );
    // The reply's id is minted inside the package transaction, so the write answers the new comment
    // rather than only that it committed — otherwise a caller has to re-read the thread to find it.
    const written = host.execute({
      operations: [{ op: 'replyToComment', comment: first, text: 'noted', author: 'Linus' }],
    });
    const reply = handleAt(written, 0);
    expect(textAt(host.execute({ operations: [{ op: 'getCommentText', comment: reply }] }), 0)).toBe(
      'noted'
    );
  });

  test('a reply with no author is refused, because a comment without one is invalid XML', () => {
    const host = reviewed();
    const { body } = roots(host);
    const [first] = commentsOf(host, body) as [AutomationHandle];
    const response = host.execute({
      operations: [{ op: 'replyToComment', comment: first, text: 'x', author: '  ' }],
    });
    expect(response.ok).toBe(false);
    expect(refusal(response)).toBe('unsupported-content');
  });

  test('a forged comment handle is refused', () => {
    const host = reviewed();
    const forged = { kind: 'comment', ref: 'comment:forged:1' } as unknown as AutomationHandle;
    expect(
      refusal(host.execute({ operations: [{ op: 'getCommentAuthor', comment: forged }] }))
    ).toBe('invalid-handle');
  });

  test('a document with no comment part answers no comments rather than refusing', () => {
    const host = open(
      richDocx({ body: `<w:p><w:r><w:t>plain</w:t></w:r></w:p>` })
    );
    expect(commentsOf(host, roots(host).body)).toEqual([]);
  });
});

describe('a tracked change is a decision, and the ones offered are the ones the engine can make', () => {
  test('a story answers its pending changes, each with its author, date and kind', () => {
    const host = reviewed();
    const { body } = roots(host);
    const found = revisionsOf(host, body);
    expect(found.length).toBe(2);
    const response = host.execute({
      operations: [
        { op: 'getRevisionAuthor', revision: found[0]! },
        { op: 'getRevisionType', revision: found[0]! },
        { op: 'getRevisionDate', revision: found[0]! },
        { op: 'getRevisionAuthor', revision: found[1]! },
        { op: 'getRevisionType', revision: found[1]! },
      ],
    });
    expect(textAt(response, 0)).toBe('Ada');
    expect(textAt(response, 1)).toBe('Insert');
    expect(textAt(response, 2)).toBe('2026-02-01T09:00:00Z');
    expect(textAt(response, 3)).toBe('Grace');
    expect(textAt(response, 4)).toBe('Delete');
  });

  test('a change answers the words it covers', () => {
    const host = reviewed();
    const { body } = roots(host);
    const [insertion] = revisionsOf(host, body) as [AutomationHandle];
    const span = spanAt(
      host.execute({ operations: [{ op: 'getRevisionRange', revision: insertion }] }),
      0
    );
    expect(textAt(host.execute({ operations: [{ op: 'getSpanText', span }] }), 0)).toBe('added');
  });

  test('accepting an insertion keeps its words and removes the decision', () => {
    const host = reviewed();
    const { body } = roots(host);
    const [insertion] = revisionsOf(host, body) as [AutomationHandle];
    const response = host.execute({ operations: [{ op: 'acceptRevision', revision: insertion }] });
    expect(response.ok).toBe(true);

    const next = reopen(host);
    expect(revisionsOf(next.host, next.body).length).toBe(1);
    expect(
      textAt(next.host.execute({ operations: [{ op: 'getText', target: next.body }] }), 0)
    ).toContain('added');
  });

  test('rejecting an insertion takes its words with it', () => {
    const host = reviewed();
    const { body } = roots(host);
    const [insertion] = revisionsOf(host, body) as [AutomationHandle];
    expect(host.execute({ operations: [{ op: 'rejectRevision', revision: insertion }] }).ok).toBe(
      true
    );
    const next = reopen(host);
    expect(
      textAt(next.host.execute({ operations: [{ op: 'getText', target: next.body }] }), 0)
    ).not.toContain('added');
  });

  test('accepting every change is one decision and one transaction', () => {
    const host = reviewed();
    const { document, body } = roots(host);
    const response = host.execute({ operations: [{ op: 'acceptAllRevisions', document }] });
    expect(response.ok).toBe(true);
    const next = reopen(host);
    expect(revisionsOf(next.host, next.body)).toEqual([]);
    const text = textAt(next.host.execute({ operations: [{ op: 'getText', target: next.body }] }), 0);
    expect(text).toContain('added');
    expect(text).not.toContain('gone');
    void body;
  });

  test('rejecting every change is the same, the other way', () => {
    const host = reviewed();
    const { document } = roots(host);
    expect(host.execute({ operations: [{ op: 'rejectAllRevisions', document }] }).ok).toBe(true);
    const next = reopen(host);
    expect(revisionsOf(next.host, next.body)).toEqual([]);
    const text = textAt(next.host.execute({ operations: [{ op: 'getText', target: next.body }] }), 0);
    expect(text).not.toContain('added');
    expect(text).toContain('gone');
  });

  test('a decision the document no longer holds is refused rather than applied to nothing', () => {
    const host = reviewed();
    const { body } = roots(host);
    const [insertion] = revisionsOf(host, body) as [AutomationHandle];
    expect(host.execute({ operations: [{ op: 'acceptRevision', revision: insertion }] }).ok).toBe(
      true
    );
    const response = host.execute({ operations: [{ op: 'acceptRevision', revision: insertion }] });
    expect(response.ok).toBe(false);
    expect(refusal(response)).toBe('invalid-handle');
  });

  test('a structural change is not answered as a decision, because it cannot be resolved', () => {
    // A row insertion (`w:trPr/w:ins`) is a revision this engine refuses to accept or reject.
    const host = open(
      richDocx({
        body:
          `<w:tbl><w:tr><w:trPr><w:ins w:id="20" w:author="Ada" w:date="2026-03-01T09:00:00Z"/></w:trPr>` +
          `<w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
      })
    );
    const { body } = roots(host);
    expect(revisionsOf(host, body)).toEqual([]);
  });

  test('two decisions in one batch are one transaction', () => {
    const host = reviewed();
    const { body } = roots(host);
    const found = revisionsOf(host, body);
    const response = host.execute({
      operations: [
        { op: 'acceptRevision', revision: found[0]! },
        { op: 'acceptRevision', revision: found[1]! },
      ],
    });
    expect(response.ok).toBe(true);
    const next = reopen(host);
    expect(revisionsOf(next.host, next.body)).toEqual([]);
  });
});
