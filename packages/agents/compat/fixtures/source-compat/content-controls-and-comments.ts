/**
 * Adapted from representative Word JavaScript API samples ("read/write a
 * content control's text", "add a comment to a range"), namespace-rewritten
 * `Word` -> `DocxEditor`. See `insert-text.ts` for why the trailing
 * `context.sync()` call is included.
 */
import { DocxEditor } from '../../docxeditor/declarations';

export async function fillFirstPlainTextContentControl(newText: string): Promise<void> {
  await DocxEditor.run(async (context) => {
    const contentControls = context.document.contentControls;
    await context.sync();
    const first = contentControls.items[0];
    if (!first.cannotEdit) {
      first.insertText(newText, 'Replace');
    }
    await context.sync();
  });
}

export async function replyToFirstUnresolvedComment(replyText: string): Promise<DocxEditor.CommentReply | undefined> {
  // NOTE: `Word.Comment`'s constructor path in real Office.js is
  // `range.insertComment(...)` (WordApiOnline 1.1) — not part of this
  // task's frozen `commentsAndRevisions` subset (only reading/replying to
  // existing comments is selected; see compat/manifest.json). This example
  // instead demonstrates the selected read/reply shape.
  let reply: DocxEditor.CommentReply | undefined;
  await DocxEditor.run(async (context) => {
    const comments = context.document.comments;
    await context.sync();
    const unresolved = comments.items.find((comment) => !comment.resolved);
    if (unresolved) {
      reply = unresolved.reply(replyText);
    }
    await context.sync();
  });
  return reply;
}

export async function resolveAllComments(): Promise<void> {
  await DocxEditor.run(async (context) => {
    const comments = context.document.comments;
    await context.sync();
    for (const comment of comments.items) {
      comment.resolved = true;
    }
    await context.sync();
  });
}
