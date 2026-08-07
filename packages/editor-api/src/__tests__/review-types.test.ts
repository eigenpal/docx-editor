/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expectTypeOf, test } from 'bun:test';
import type {
  Comment as BrowserComment,
  CommentReply as BrowserCommentReply,
  Range as BrowserRange,
  Revision as BrowserRevision,
} from '../browser.ts';
import type {
  Comment as ServerComment,
  CommentReply as ServerCommentReply,
  Range as ServerRange,
  Revision as ServerRevision,
} from '../index.ts';

test('both public entries require nullable review dates to be narrowed', () => {
  expectTypeOf<BrowserComment>().toEqualTypeOf<ServerComment>();
  expectTypeOf<BrowserCommentReply>().toEqualTypeOf<ServerCommentReply>();
  expectTypeOf<BrowserRevision>().toEqualTypeOf<ServerRevision>();
  expectTypeOf<BrowserRange['insertComment']>().toEqualTypeOf<ServerRange['insertComment']>();
  expectTypeOf<ReturnType<ServerRange['insertComment']>>().toEqualTypeOf<ServerComment>();
  expectTypeOf<ServerComment['creationDate']>().toEqualTypeOf<Date | null>();
  expectTypeOf<ServerCommentReply['creationDate']>().toEqualTypeOf<Date | null>();
  expectTypeOf<ServerRevision['date']>().toEqualTypeOf<Date | null>();
  expectTypeOf<ServerComment['delete']>().toEqualTypeOf<() => void>();
  expectTypeOf<ServerCommentReply['delete']>().toEqualTypeOf<() => void>();

  const comment = { creationDate: null } as unknown as ServerComment;
  const reply = { creationDate: null } as unknown as ServerCommentReply;
  const revision = { date: null } as unknown as ServerRevision;

  if (false) {
    // @ts-expect-error A file-authored comment date must be narrowed before Date methods are used.
    comment.creationDate.toISOString();
    // @ts-expect-error A file-authored reply date must be narrowed before Date methods are used.
    reply.creationDate.toISOString();
    // @ts-expect-error A file-authored revision date must be narrowed before Date methods are used.
    revision.date.toISOString();
  }

  const commentDate = comment.creationDate;
  const replyDate = reply.creationDate;
  const revisionDate = revision.date;
  if (commentDate) commentDate.toISOString();
  if (replyDate) replyDate.toISOString();
  if (revisionDate) revisionDate.toISOString();
});
