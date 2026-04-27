/**
 * Formal Word JS API parity contract.
 *
 * This file declares what subset of Microsoft Word's Office.js JavaScript API
 * (https://learn.microsoft.com/en-us/javascript/api/word) we mirror, **at the
 * type level**. It is checked at compile time: `EditorBridge` must satisfy
 * `WordCompatBridge` (verified via the static assertion at the bottom).
 *
 * The assertion is the source of truth. If you change the bridge surface and
 * forget to update parity, typecheck breaks.
 *
 * ## What we mirror (✓)
 *
 * | Word JS API                         | Our equivalent                        |
 * | ----------------------------------- | ------------------------------------- |
 * | `Range` (stable handle)             | `paraId: string`                      |
 * | `body.search(text)` → Ranges        | `findText(query, opts) → FoundMatch[]`|
 * | `range.insertComment(text)`         | `addComment({paraId, text, search?})` |
 * | `comment.reply(text)`               | `replyTo(commentId, {text})`          |
 * | `comment.resolved = true`           | `resolveComment(commentId)`           |
 * | `range.insertText(text, location)`  | `proposeChange({paraId, search, replaceWith})` (3 modes via empty-string semantics) |
 * | `document.getSelection()`           | `getSelection() → SelectionInfo|null` |
 * | `range.scrollIntoView()`            | `scrollTo(paraId)`                    |
 * | `commentCollection.getItems()`      | `getComments(filter?)`                |
 * | `body.paragraphs.getItems()`        | `getContent(opts?)`                   |
 * | `document.body.text`                | `getContentAsText(opts?)`             |
 * | `revisionCollection.getItems()`     | `getChanges(filter?)`                 |
 * | `Document.onContentChanged.add(...)`| `onContentChange(listener)`           |
 * | `Document.onSelectionChanged.add()` | `onSelectionChange(listener)`         |
 *
 * ## Differences (intentional, documented)
 *
 *  - All "insertText" overloads collapse into `proposeChange` with empty-string
 *    semantics: replaceWith="" deletes; search="" inserts at paragraph end;
 *    both non-empty replaces. Word has separate `insertText(...,'Replace')`,
 *    `insertText(...,'Before')`, etc.; we found three modes were enough and
 *    serialize cleaner for LLM tool calls.
 *  - Tracked changes are always *suggestions* in our world. Word lets the
 *    range mutate directly; we always go through the tracked-change path so
 *    the human keeps the final say. (This matches the agent UX.)
 *  - Word's `Range.context.sync()` is unnecessary — every call is one PM
 *    transaction.
 *  - Word's `Range` is a stateful object. Ours is a plain `{paraId, search?}`
 *    JSON value, so it survives JSON.stringify and works for tool calls / MCP.
 *
 * ## Out of scope (gaps we deliberately don't implement)
 *
 *  - Formatting verbs (`Range.font.bold`, etc.). Out of scope for v1.
 *  - Paragraph creation (`body.insertParagraph`). Out of scope for v1.
 *  - Table mutation (insert row/col, delete cell). Read-only.
 *  - Headers / footers / sections.
 *  - `Range.getOoxml()` / `getHtml()`. Plain text only.
 *  - `customXmlParts` / `contentControls`.
 *  - Accept / reject tracked changes. Human-only by design.
 *
 * Future versions can grow these by extending this interface — typecheck
 * will then enforce the new contract.
 */

import type { EditorBridge, ContentChangeEvent, SelectionChangeEvent } from './bridge';
import type {
  ContentBlock,
  GetContentOptions,
  ReviewComment,
  ReviewChange,
  ChangeFilter,
  CommentFilter,
  AddCommentByParaIdOptions,
  ReplyOptions,
  ProposeChangeOptions,
  FoundMatch,
  SelectionInfo,
} from './types';

/**
 * The formal Word-JS-API parity surface. Each method maps to one or more
 * Word API methods (named in the JSDoc above each member).
 *
 * If you change the EditorBridge surface, this interface must change too —
 * the static assertion at the bottom of the file enforces it.
 */
export interface WordCompatBridge {
  // ── Read ────────────────────────────────────────────────────────────────

  /** Word: `document.body.text` (stringified, indexed lines). */
  getContentAsText(options?: GetContentOptions): string;

  /** Word: `body.paragraphs.getItems()`. */
  getContent(options?: GetContentOptions): ContentBlock[];

  /** Word: `commentCollection.getItems()`. */
  getComments(filter?: CommentFilter): ReviewComment[];

  /** Word: `revisionCollection.getItems()`. */
  getChanges(filter?: ChangeFilter): ReviewChange[];

  /** Word: `body.search(text)` returning Range[]. */
  findText(query: string, options?: { caseSensitive?: boolean; limit?: number }): FoundMatch[];

  /** Word: `document.getSelection()`. */
  getSelection(): SelectionInfo | null;

  // ── Mutate (always tracked-change-style suggestions) ─────────────────────

  /** Word: `range.insertComment(text)`. Anchored by paraId (Range handle). */
  addComment(options: AddCommentByParaIdOptions): number | null;

  /** Word: `comment.reply(text)`. */
  replyTo(commentId: number, options: ReplyOptions): number | null;

  /** Word: `comment.resolved = true`. */
  resolveComment(commentId: number): void;

  /**
   * Word: `range.insertText(text, location)` collapsed into one verb.
   *  - replacement: search non-empty, replaceWith non-empty
   *  - deletion:    search non-empty, replaceWith ""
   *  - insertion:   search "",        replaceWith non-empty (paragraph end)
   */
  proposeChange(options: ProposeChangeOptions): boolean;

  // ── Navigate ─────────────────────────────────────────────────────────────

  /** Word: `range.scrollIntoView()`. */
  scrollTo(paraId: string): boolean;

  // ── Events ───────────────────────────────────────────────────────────────

  /** Word: `Document.onContentChanged.add(handler)`. Returns unsubscribe. */
  onContentChange(listener: (event: ContentChangeEvent) => void): () => void;

  /** Word: `Document.onSelectionChanged.add(handler)`. Returns unsubscribe. */
  onSelectionChange(listener: (event: SelectionChangeEvent) => void): () => void;
}

// ── Compile-time enforcement ────────────────────────────────────────────────
//
// Mirrors `EditorBridge` against the parity contract in both directions:
// (a) every method declared in WordCompatBridge must exist on EditorBridge
//     with a compatible signature (forward check)
// (b) EditorBridge can have extra methods (it does — DocxReviewer-shaped APIs).
//
// If the bridge ever drops a method or changes its shape incompatibly, this
// fails to typecheck. That's the formal parity check.

type ImplementsWordCompat<T extends WordCompatBridge> = T;
/** Static assertion: EditorBridge satisfies the parity contract. Failing this
 * means the bridge dropped or changed a method that's part of the public
 * Word-API mirror. Either fix the bridge or update WordCompatBridge to
 * narrow scope deliberately. The unused-export comment keeps tsc quiet. */

export type _AssertEditorBridgeImplementsWordCompat = ImplementsWordCompat<EditorBridge>;
