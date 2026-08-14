'use client';

/**
 * The browser half of the catalog: runs the calls the model makes against the
 * editor the reader is looking at.
 *
 * The document work goes through `@docx-editor.dev/editor-api/browser`, whose
 * runtime borrows an editor the host already created. `run(context => ...)` is
 * the Office.js batch shape: queue loads, `sync()`, read what came back.
 *
 * One exception, and it is not incidental: editor-api can read, reply to and
 * resolve comments but cannot CREATE one. So `add_comment` selects the phrase
 * through editor-api and then lands the comment through `@docx-editor.dev/pro`'s
 * review API, which comments on the current selection. Both halves drive the
 * same editor, so the selection one makes is the selection the other sees.
 */

import { DocxEditor as EditorApi } from '@docx-editor.dev/editor-api/browser';
import type { DocxEditorRuntime } from '@docx-editor.dev/editor-api/browser';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import type { AgentContextSnapshot } from './tools';

/** What a tool call answers. The string reaches the model verbatim. */
export interface ToolResult {
  success: boolean;
  output: string;
}

function ok(data: unknown): ToolResult {
  return { success: true, output: typeof data === 'string' ? data : JSON.stringify(data) };
}

function fail(message: string): ToolResult {
  return { success: false, output: message };
}

/** Comments on the current selection. Supplied by pro's `useReviewOf` at the call site. */
export type CommentOnSelection = (text: string, author?: string) => boolean;

interface ParagraphRecord {
  id: string;
  text: string;
}

async function readParagraphs(runtime: DocxEditorRuntime): Promise<ParagraphRecord[]> {
  return runtime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    // TWO PHASES, and the first is not optional. `text` and `uniqueLocalId` are
    // properties of a Paragraph, not of the collection, so asking the collection
    // for them throws InvalidArgument ("document.body.paragraphs.text").
    // Materialise the collection, then load each item.
    paragraphs.load();
    await context.sync();

    for (const paragraph of paragraphs.items) {
      paragraph.load(['text', 'uniqueLocalId']);
    }
    await context.sync();

    return paragraphs.items
      .map((p) => ({ id: p.uniqueLocalId, text: p.text.trim() }))
      .filter((p) => p.text.length > 0);
  });
}

/**
 * Locate a phrase and say which paragraph each hit sits in.
 *
 * Two syncs, and they cannot be collapsed into one: the search has to answer
 * before there are ranges whose owning paragraph can be asked for. Searching the
 * whole body rather than one paragraph is deliberate too, because `Paragraph`
 * has no `search` (only `Body` and `Range` do), so the owner is filtered after.
 */
async function locatePhrase(
  runtime: DocxEditorRuntime,
  phrase: string,
  matchCase: boolean
): Promise<Array<{ index: number; paragraphId: string; text: string }>> {
  return runtime.run(async (context) => {
    const hits = context.document.body.search(phrase, { matchCase });
    // Same two-phase rule as readParagraphs: `text` belongs to a Range, not to
    // the RangeCollection the search returns.
    hits.load();
    await context.sync();

    if (hits.items.length === 0) return [];

    // `hit.paragraphs.getFirst()` does NOT survive here: it mints a promised
    // object whose path is already released, and the run dies with
    // InvalidObjectPath. Materialising each range's paragraph collection works.
    // Both loads are queued before one sync so this stays three round trips
    // rather than one per hit.
    for (const hit of hits.items) hit.load('text');
    const ownerLists = hits.items.map((hit) => hit.paragraphs);
    for (const list of ownerLists) list.load();
    await context.sync();

    const owners = ownerLists.map((list) => list.items[0]);
    for (const owner of owners) owner.load('uniqueLocalId');
    await context.sync();

    return hits.items.map((hit, index) => ({
      index,
      paragraphId: owners[index].uniqueLocalId,
      text: hit.text,
    }));
  });
}

/**
 * How much of the document one `read_document` may hand the model.
 *
 * A tool result stays in the message history, so it is re-sent on EVERY later
 * turn. Handing over a whole long document means uploading and re-billing it
 * once per step, which is most of what makes an agent feel slow.
 *
 * Truncation is reported to the model rather than hidden, so it can search for
 * what it needs instead of assuming it has seen everything.
 */
const MAX_PARAGRAPHS = 400;
const MAX_CHARS = 24_000;

function capForModel(paragraphs: ParagraphRecord[]): ParagraphRecord[] {
  const out: ParagraphRecord[] = [];
  let budget = MAX_CHARS;
  for (const p of paragraphs) {
    if (out.length >= MAX_PARAGRAPHS || budget - p.text.length < 0) break;
    budget -= p.text.length;
    out.push(p);
  }
  return out;
}

export interface RunToolOptions {
  /** The editor the reader has open. */
  runtime: DocxEditorRuntime;
  /** Lands a comment on the current selection (from pro's `useReviewOf`). */
  commentOnSelection: CommentOnSelection;
  /** Author attributed to the comments the agent leaves. */
  author: string;
}

export async function runAgentTool(
  { runtime, commentOnSelection, author }: RunToolOptions,
  name: string,
  input: Record<string, unknown>
): Promise<ToolResult> {
  try {
    switch (name) {
      case 'read_document':
        return readDocument(runtime);
      case 'find_text':
        return findText(runtime, input);
      case 'add_comment':
        return addComment(runtime, commentOnSelection, author, input);
      case 'read_comments':
        return readComments(runtime);
      case 'reply_comment':
        return replyComment(runtime, input);
      case 'resolve_comment':
        return resolveComment(runtime, input);
      default:
        return fail(`Unknown tool: ${name}`);
    }
  } catch (error) {
    // Surface the refusal to the model rather than killing the run. editor-api
    // errors carry a code and a message that name what was refused, which is
    // usually enough for the model to retry differently.
    return fail(error instanceof Error ? error.message : String(error));
  }
}

async function readDocument(runtime: DocxEditorRuntime): Promise<ToolResult> {
  const all = await readParagraphs(runtime);
  if (all.length === 0) return ok('The document is empty.');
  const paragraphs = capForModel(all);
  if (paragraphs.length === all.length) return ok(paragraphs);
  // Say so. A model that thinks it has the whole document will claim it
  // reviewed all of it. Directive, not apologetic: worded as a limit to
  // explain, the model spends its whole turn explaining the limit.
  return ok({
    paragraphs,
    truncated: true,
    note: `This slice is what you have to work with: paragraphs 1-${paragraphs.length} of ${all.length}. Act on it now rather than describing the limit, and call find_text if you need a phrase from further down.`,
  });
}

async function findText(
  runtime: DocxEditorRuntime,
  input: Record<string, unknown>
): Promise<ToolResult> {
  const query = String(input.query ?? '');
  if (!query) return fail('query is required.');
  const hits = await locatePhrase(runtime, query, Boolean(input.matchCase));
  if (hits.length === 0) return ok(`No match for "${query}".`);
  return ok(hits.map(({ paragraphId, text }) => ({ paragraphId, text })));
}

async function addComment(
  runtime: DocxEditorRuntime,
  commentOnSelection: CommentOnSelection,
  author: string,
  input: Record<string, unknown>
): Promise<ToolResult> {
  const paragraphId = String(input.paragraphId ?? '');
  const search = String(input.search ?? '');
  const comment = String(input.comment ?? '');
  if (!paragraphId || !search || !comment)
    return fail('paragraphId, search and comment are all required.');

  // Case-sensitive on purpose: the model is told to copy the phrase verbatim out
  // of read_document, and a case-insensitive match would silently anchor to a
  // different occurrence than the one it meant.
  const hits = await locatePhrase(runtime, search, true);
  if (hits.length === 0)
    return fail(
      `The phrase "${search}" was not found. Copy it verbatim from read_document and try again.`
    );

  const inParagraph = hits.filter((h) => h.paragraphId === paragraphId);
  if (inParagraph.length === 0)
    return fail(
      `The phrase "${search}" does not occur in paragraph ${paragraphId}. It was found in ${hits.length} other place(s). Use a phrase from that paragraph.`
    );
  if (inParagraph.length > 1)
    return fail(
      `The phrase "${search}" occurs ${inParagraph.length} times in that paragraph, so the comment would be ambiguous. Use a longer, more distinctive phrase.`
    );

  const target = inParagraph[0].index;
  await runtime.run(async (context) => {
    // `load('text')` on the collection is the same InvalidArgument trap as
    // elsewhere, and `text` is not needed here at all. Materialising the
    // collection is enough to index into it and select the hit.
    const ranges = context.document.body.search(search, { matchCase: true });
    ranges.load();
    await context.sync();

    const range = ranges.items[target];
    if (!range) throw new Error('the phrase moved before it was selected');
    range.select('Select');
    await context.sync();
  });

  // The selection is now on the phrase, so pro's review API anchors the comment
  // to it. It REPORTS rather than throws: a document open for viewing refuses
  // every comment, and the model needs to hear that.
  const landed = commentOnSelection(comment, author);
  if (!landed) return fail('The editor refused the comment. The document may be read-only.');
  return ok(`Commented on "${inParagraph[0].text}".`);
}

async function readComments(runtime: DocxEditorRuntime): Promise<ToolResult> {
  const comments = await runtime.run(async (context) => {
    const collection = context.document.comments;
    // Two-phase, as everywhere else: these are Comment properties, not
    // properties of the collection.
    collection.load();
    await context.sync();
    for (const c of collection.items) c.load(['id', 'text', 'authorName', 'resolved']);
    await context.sync();
    return collection.items.map((c) => ({
      id: c.id,
      text: c.text,
      author: c.authorName,
      resolved: c.resolved,
    }));
  });
  if (comments.length === 0) return ok('The document has no comments.');
  return ok(comments);
}

async function replyComment(
  runtime: DocxEditorRuntime,
  input: Record<string, unknown>
): Promise<ToolResult> {
  const commentId = String(input.commentId ?? '');
  const reply = String(input.reply ?? '');
  if (!commentId || !reply) return fail('commentId and reply are both required.');
  const done = await runtime.run(async (context) => {
    const collection = context.document.comments;
    collection.load();
    await context.sync();
    for (const c of collection.items) c.load('id');
    await context.sync();
    const match = collection.items.find((c) => c.id === commentId);
    if (!match) return false;
    match.reply(reply);
    await context.sync();
    return true;
  });
  return done ? ok('Replied.') : fail(`No comment with id ${commentId}.`);
}

async function resolveComment(
  runtime: DocxEditorRuntime,
  input: Record<string, unknown>
): Promise<ToolResult> {
  const commentId = String(input.commentId ?? '');
  if (!commentId) return fail('commentId is required.');
  const done = await runtime.run(async (context) => {
    const collection = context.document.comments;
    collection.load();
    await context.sync();
    for (const c of collection.items) c.load('id');
    await context.sync();
    const match = collection.items.find((c) => c.id === commentId);
    if (!match) return false;
    match.resolved = true;
    await context.sync();
    return true;
  });
  return done ? ok('Resolved.') : fail(`No comment with id ${commentId}.`);
}

/** Advisory context sent with each prompt. Cheap: one batch, no document text. */
export async function readAgentContext(runtime: DocxEditorRuntime): Promise<AgentContextSnapshot> {
  try {
    const paragraphs = await readParagraphs(runtime);
    return { paragraphCount: paragraphs.length };
  } catch {
    return {};
  }
}

/**
 * Creates the editor-api runtime for an editor the host already has open.
 *
 * Takes a `DocxEditorInstance` (what `useDocxEditor()` answers), not the
 * narrower `Editor` that `<DocxEditor onReady>` hands over. `createBrowser`
 * needs the instance.
 */
export function createBrowserRuntime(editor: DocxEditorInstance): DocxEditorRuntime {
  return EditorApi.createBrowser(editor);
}
