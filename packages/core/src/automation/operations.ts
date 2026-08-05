// The typed operation vocabulary.
//
// Small on purpose, and it grows by KIND of crossing rather than by convenience. Every
// operation here is either a read derived from one canonical package snapshot, or a command
// that turns into `TreeDocOp`s and commits through the single transaction path. Nothing in
// between exists: there is no "read after write in the same batch", because a batch is one
// atomic transaction and a query that answered post-commit state would describe a document
// nobody had published yet.
//
// ADDRESSING IS ONE VOCABULARY: a stable paragraph handle plus a UTF-16 model offset
// (`AutomationEndpoint`). A position may also be given as a story EDGE — the start or the end
// of a body — because an object model that wants "append to the document" would otherwise have
// to list every paragraph first just to find the last one, and the host already knows.
//
// WHERE A HANDLE IS RESOLVED matters for what a command can answer. A read names objects that
// already exist, so its answer is available while the batch is being planned. A command that
// CREATES a paragraph cannot name it in advance — the canonical node does not exist yet — so
// those operations answer after the commit, from the state they made. See `plan.ts`.

import type { AutomationFontWrite, AutomationParagraphFormatWrite } from './formatting.ts';
import type { AutomationEndpoint, AutomationHandle } from './protocol.ts';
import type { AutomationPageSetupWrite } from './sections.ts';
import type { HeaderFooterVariant } from '../store/package/hf-references.ts';
import type { NoteKind } from '../store/package/note-nodes.ts';

/**
 * A position in a story.
 *
 * Either exact, or an EDGE of something the host can measure: a story, or one paragraph.
 * `{ body, at: 'end' }` is the position after the last character of the last paragraph, which is
 * what "append to the document" means; `{ paragraph, at: 'end' }` is the same for one paragraph.
 *
 * The edges are not sugar. A caller has no way to know a paragraph's length without reading it
 * first, so "insert at the end of this paragraph" would otherwise cost a round trip and then
 * carry an offset that a concurrent edit could have invalidated. The host knows the length at
 * the moment it plans, so the edge is both shorter and correct.
 */
export type AutomationPoint =
  | AutomationEndpoint
  | { readonly paragraph: AutomationHandle; readonly at: 'start' | 'end' }
  | { readonly body: AutomationHandle; readonly at: 'start' | 'end' };

/**
 * A stretch of a story to read, replace, or select.
 *
 * `{ body }` is the whole story — every paragraph, first offset to last — and `{ paragraph }` is
 * the whole of one paragraph. Spelling both as their own shapes rather than making the caller
 * find the edges keeps "replace the body" and "clear this paragraph" single operations, which is
 * what makes each of them one transaction.
 */
export type AutomationSpanRef =
  | { readonly start: AutomationPoint; readonly end: AutomationPoint }
  | { readonly paragraph: AutomationHandle }
  | { readonly body: AutomationHandle };

/**
 * Which paragraph a structural command is anchored at.
 *
 * A story edge resolves to its first or last paragraph. An empty story has neither, and the
 * command is refused rather than inventing a block: creating a paragraph in a story that holds
 * none is a different operation than inserting beside one, and this protocol has only the
 * second (see the object model's recorded omissions).
 */
export type AutomationParagraphRef =
  | { readonly paragraph: AutomationHandle }
  | { readonly body: AutomationHandle; readonly at: 'first' | 'last' };

/**
 * How a story search is narrowed.
 *
 * Every flag is either honoured or REFUSED — never accepted and ignored. A search that quietly
 * dropped `matchWildcards` would answer plain-text matches to a caller who asked for pattern
 * ones, which is worse than saying no.
 */
export interface AutomationSearchOptions {
  readonly matchCase?: boolean;
  readonly matchWholeWord?: boolean;
  /** Not supported; `true` is refused. Punctuation-insensitive matching is not implemented. */
  readonly ignorePunct?: boolean;
  /** Not supported; `true` is refused. Whitespace-insensitive matching is not implemented. */
  readonly ignoreSpace?: boolean;
  /** Not supported; `true` is refused. There is no wildcard grammar behind this protocol. */
  readonly matchWildcards?: boolean;
  /** Tighten the result cap. Clamped to the engine's own limit; never raised past it. */
  readonly limit?: number;
}

/** Where a selection lands. `start`/`end` collapse it to one edge of the span. */
export type AutomationSelectionMode = 'select' | 'start' | 'end';

export type AutomationOperation =
  /** The document itself — the root every other handle is reached through. */
  | { readonly op: 'getDocument' }
  /** The main story of a document. */
  | { readonly op: 'getBody'; readonly document: AutomationHandle }
  /**
   * A story's paragraphs, in reading order.
   *
   * Includes paragraphs inside tables — descending through rows, cells and nested tables — and
   * inside block-level content controls, because those are ordinary editable paragraphs and
   * Word's own paragraph collection contains them. A story with no paragraphs answers none.
   */
  | { readonly op: 'getParagraphs'; readonly body: AutomationHandle }
  /** The paragraphs a span covers, in reading order. */
  | { readonly op: 'getSpanParagraphs'; readonly span: AutomationSpanRef }
  /**
   * Text of a body or a paragraph.
   *
   * A story reads as its paragraphs joined by a carriage return — one paragraph mark, one
   * `\r` — which is the separator Word's own text property uses.
   */
  | { readonly op: 'getText'; readonly target: AutomationHandle }
  /** Text between two endpoints, with a carriage return at every paragraph mark crossed. */
  | { readonly op: 'getSpanText'; readonly span: AutomationSpanRef }
  /**
   * A paragraph's own identity as the DOCUMENT writes it (`w14:paraId`).
   *
   * Not an index and not a handle ref: it survives paragraphs being inserted or deleted around
   * it, and it is the same value a file written by Word carries.
   */
  | { readonly op: 'getParagraphId'; readonly paragraph: AutomationHandle }
  /**
   * Every occurrence of `text` inside a scope, in reading order, as spans.
   *
   * The scope is a span, so `{ body }` searches a whole story and a pair of endpoints searches
   * part of one. There is no "search the whole document" — a document is several stories, and
   * answering one story's matches to that request would be a claim about the others.
   */
  | {
      readonly op: 'search';
      readonly scope: AutomationSpanRef;
      readonly text: string;
      readonly options?: AutomationSearchOptions;
    }
  /**
   * Insert text at a position. Answers the span the inserted text occupies.
   *
   * Offsets in one batch are validated against the state at the START of the batch, and the
   * commands apply in order INSIDE one transaction — so two insertions into the same paragraph
   * shift each other exactly as two sequential edits would, and the second answer's offsets are
   * the ones it was planned with. Addressing distinct paragraphs keeps a batch
   * order-independent.
   */
  | { readonly op: 'insertText'; readonly at: AutomationPoint; readonly text: string }
  /**
   * Replace a span with text, which may be empty — that is how a deletion is spelled.
   *
   * A span that crosses paragraph marks removes the paragraphs between its endpoints and joins
   * what is left, because that is what deleting a stretch of a document means. A join across a
   * table-cell boundary is refused by the canonical mutation path, and the whole batch is then
   * refused: half a deletion is not an outcome this protocol offers.
   */
  | { readonly op: 'replaceSpan'; readonly span: AutomationSpanRef; readonly text: string }
  /**
   * Insert a paragraph beside another one. Answers the NEW paragraph's handle.
   *
   * Resolved after the commit, because the paragraph it names does not exist until then.
   */
  | {
      readonly op: 'insertParagraph';
      readonly anchor: AutomationParagraphRef;
      readonly where: 'before' | 'after';
      readonly text: string;
    }
  /**
   * Split a paragraph at every occurrence of any delimiter. Answers a span per resulting
   * paragraph, in reading order, including the one that keeps the original identity.
   */
  | {
      readonly op: 'splitParagraph';
      readonly paragraph: AutomationHandle;
      readonly delimiters: readonly string[];
      /** Drop the delimiter characters themselves. */
      readonly trimDelimiters?: boolean;
      /** Drop leading and trailing whitespace from each resulting paragraph. */
      readonly trimSpacing?: boolean;
    }
  /**
   * What the characters a span covers AGREE about their formatting.
   *
   * Not "what does this text look like": a value inherited from `styles.xml` reads as no agreed
   * value, because this lane reads what the document authors and a write merges against the
   * same thing. See `formatting.ts`.
   */
  | { readonly op: 'getFont'; readonly span: AutomationSpanRef }
  /**
   * Author run properties over a span. Only the fields present are written.
   *
   * A span covering a WHOLE paragraph also writes the paragraph MARK's own `w:rPr`, which is
   * what Word does — the pilcrow carries the formatting a list marker inherits its face from,
   * so sizing a bulleted paragraph without it leaves the bullet at the old size.
   */
  | { readonly op: 'setFont'; readonly span: AutomationSpanRef; readonly font: AutomationFontWrite }
  /**
   * The paragraph style NAME every paragraph a span covers agrees on.
   *
   * The name a reader sees (`heading 1`), not the internal `w:styleId` (`Heading1`) — the two are
   * routinely different, and the id is not the vocabulary an object model talks in.
   */
  | { readonly op: 'getStyle'; readonly span: AutomationSpanRef }
  /**
   * Apply a paragraph style, by name, to every paragraph a span covers.
   *
   * A name the document does not already define is REFUSED. Minting the definition would report a
   * style applied for one with no formatting in it — the paragraph unchanged on screen, styled when
   * read back — and would turn a caller's string into a new part.
   */
  | { readonly op: 'setStyle'; readonly span: AutomationSpanRef; readonly name: string }
  /** One paragraph's own paragraph properties, in points. */
  | { readonly op: 'getParagraphFormat'; readonly paragraph: AutomationParagraphRef }
  /** Author paragraph properties. Only the fields present are written. */
  | {
      readonly op: 'setParagraphFormat';
      readonly paragraph: AutomationParagraphRef;
      readonly format: AutomationParagraphFormatWrite;
    }
  /** Remove a paragraph and everything in it. */
  | { readonly op: 'deleteParagraph'; readonly paragraph: AutomationHandle }
  /**
   * The document's sections, in document order.
   *
   * A document nobody sectioned still has one: the body-level `w:sectPr` Word writes even for a
   * file that has never been sectioned. The index a section answers to is the one the furniture
   * lifecycle ops take, so a read here and a header written afterwards agree about which section
   * is which.
   */
  | { readonly op: 'getSections'; readonly document: AutomationHandle }
  /** One section's page geometry, in points. */
  | { readonly op: 'getPageSetup'; readonly section: AutomationHandle }
  /**
   * Author page geometry on ONE section — Word's "Apply to: This section".
   *
   * Only the fields present are written; the rest of that `w:sectPr` is left exactly as authored.
   * `orientation` without dimensions swaps the section's own, so a document of mixed paper sizes
   * survives a flip. A dimension outside what a page can be is refused rather than clamped.
   */
  | {
      readonly op: 'setPageSetup';
      readonly section: AutomationHandle;
      readonly setup: AutomationPageSetupWrite;
    }
  /**
   * The header or footer story a section declares or inherits, as a BODY.
   *
   * A variant the document has neither declared nor inherited is refused: minting the part would
   * make a read write, and a header that exists only because it was asked about is a header the
   * document did not have.
   */
  | {
      readonly op: 'getFurniture';
      readonly section: AutomationHandle;
      readonly kind: 'header' | 'footer';
      readonly variant: HeaderFooterVariant;
    }
  /**
   * Every footnote or endnote the document holds, in the order its notes part writes them.
   *
   * The reserved separator and continuation-separator notes (`w:id` -1 and 0) are not notes a
   * caller can reach: reporting them would say the document has two more footnotes than it has.
   */
  | { readonly op: 'getNotes'; readonly document: AutomationHandle; readonly noteKind: NoteKind }
  /** One note's story, as a BODY. Two notes in one part are two stories. */
  | { readonly op: 'getNoteBody'; readonly note: AutomationHandle }
  /** Whether a note is a footnote or an endnote. */
  | { readonly op: 'getNoteKind'; readonly note: AutomationHandle }
  /**
   * Delete a note: its body in the notes part and every reference that reached it.
   *
   * A PACKAGE-level transaction, so it shares its batch with nothing — see
   * `AUTOMATION_SOLITARY_OPERATIONS`.
   */
  | { readonly op: 'deleteNote'; readonly note: AutomationHandle }
  /**
   * Put the reader's selection on a span. Requires the `selection` capability, so a headless
   * host refuses it rather than pretending to have a caret.
   */
  | {
      readonly op: 'selectSpan';
      readonly span: AutomationSpanRef;
      readonly mode: AutomationSelectionMode;
    };

export type AutomationOperationKind = AutomationOperation['op'];

/** Operations that read. They never open a transaction. */
export const AUTOMATION_QUERY_OPERATIONS = [
  'getDocument',
  'getBody',
  'getParagraphs',
  'getSpanParagraphs',
  'getText',
  'getSpanText',
  'getParagraphId',
  'search',
  'getFont',
  'getParagraphFormat',
  'getStyle',
  'getSections',
  'getPageSetup',
  'getFurniture',
  'getNotes',
  'getNoteBody',
  'getNoteKind',
] as const satisfies readonly AutomationOperationKind[];

/** Operations that write. Every one of these goes through the single transaction path. */
export const AUTOMATION_COMMAND_OPERATIONS = [
  'insertText',
  'replaceSpan',
  'insertParagraph',
  'splitParagraph',
  'deleteParagraph',
  'selectSpan',
  'setFont',
  'setParagraphFormat',
  'setStyle',
  'setPageSetup',
  'deleteNote',
] as const satisfies readonly AutomationOperationKind[];

/**
 * Commands that commit as a PACKAGE transaction and therefore share a batch with nothing.
 *
 * A note's lifecycle rewrites several parts at once — the notes part, the references in every
 * story that cited it, the relationship and the content-type override — and the store publishes
 * that as its own undo unit rather than as ops inside a story transaction. Two of them, or one
 * beside a story command, would be two commits: two revisions, and a moment where half the
 * caller's batch is published. Refused while planning instead.
 */
export const AUTOMATION_SOLITARY_OPERATIONS = [
  'deleteNote',
] as const satisfies readonly AutomationOperationKind[];

const SOLITARY: ReadonlySet<string> = new Set(AUTOMATION_SOLITARY_OPERATIONS);

/** Whether an operation must be the only one in its batch. */
export function isSolitaryAutomationCommand(operation: AutomationOperation): boolean {
  return SOLITARY.has(operation.op);
}

// Compile-time exhaustiveness: a new operation must be classified as a query or a command, or
// this fails to typecheck. Without it a new operation would default to "not a command" and
// silently skip the transaction path.
type _Unclassified = Exclude<
  AutomationOperationKind,
  (typeof AUTOMATION_QUERY_OPERATIONS)[number] | (typeof AUTOMATION_COMMAND_OPERATIONS)[number]
>;
const _operationsClassified: _Unclassified extends never ? true : ['unclassified', _Unclassified] =
  true;
void _operationsClassified;

const COMMANDS: ReadonlySet<string> = new Set(AUTOMATION_COMMAND_OPERATIONS);

/** Whether an operation writes. Drives the query/command split inside one batch. */
export function isAutomationCommand(operation: AutomationOperation): boolean {
  return COMMANDS.has(operation.op);
}
