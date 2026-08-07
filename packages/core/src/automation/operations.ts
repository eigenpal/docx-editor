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
 * Where to look for content controls: a whole story, or inside one control.
 *
 * A control's own scope is how nesting is expressed. Listing every control of a story flat
 * would answer a form field and the group wrapping it as siblings, which is not what either of
 * them is.
 */
export type AutomationContentControlScope =
  | { readonly body: AutomationHandle }
  | { readonly contentControl: AutomationHandle };

/** The value a control accepts, by what kind of control it is. */
export type AutomationContentControlValue =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'listItem'; readonly value: string }
  | { readonly kind: 'checkbox'; readonly checked: boolean }
  | { readonly kind: 'date'; readonly iso: string };

/** The `ST_Lock` values an author may write. */
export type AutomationContentControlLock =
  | 'unlocked'
  | 'sdtLocked'
  | 'contentLocked'
  | 'sdtContentLocked';

/**
 * Which part of a control a range read answers.
 *
 * `whole` and `content` are the same stretch, and `before`/`after` are the content's own edges:
 * a control's boundary marks occupy no offset in the text a caller addresses, so there is no
 * position between a mark and the first character to answer with.
 */
export type AutomationContentControlRangeLocation =
  | 'whole'
  | 'content'
  | 'start'
  | 'end'
  | 'before'
  | 'after';

/** The control types an insertion may author. Picture and repeating section are deferred. */
export type AutomationContentControlSubtype =
  | 'richText'
  | 'plainText'
  | 'dropDownList'
  | 'comboBox'
  | 'date';

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

/**
 * Every operation a host answers: the whole read-and-write vocabulary, as one discriminated
 * union keyed on `op`.
 *
 * Reads never open a transaction; commands in one batch commit together. Handles are NAMES the
 * host minted, never pointers, so an operation is plain transport data.
 */
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
   * Every list one story holds, in the order its numbers first appear.
   *
   * A list is the paragraphs that share a `w:numId`, so this is derived rather than walked: there
   * is no list element in a `.docx` to enumerate. Two stories that number with the same value are
   * still two lists, because the paragraphs are not in the same story.
   */
  | { readonly op: 'getLists'; readonly body: AutomationHandle }
  /** A list's `w:numId`, as the number the file states. */
  | { readonly op: 'getListId'; readonly list: AutomationHandle }
  /**
   * One story's list by the `w:numId` its paragraphs share, refused where none does.
   *
   * Refused rather than answered for an unused number: a `w:numId` with no paragraph names a
   * numbering DEFINITION, and a list handle for it would answer no paragraphs forever.
   */
  | { readonly op: 'getListById'; readonly body: AutomationHandle; readonly id: number }
  /**
   * A list's paragraphs in reading order, or only the ones at one level.
   *
   * `level` is `w:ilvl` — 0-8. A level the list has no paragraphs at answers none, which is not an
   * error: a list is free to skip a level.
   */
  | { readonly op: 'getListParagraphs'; readonly list: AutomationHandle; readonly level?: number }
  /**
   * The list a paragraph is in.
   *
   * A paragraph in none is REFUSED rather than answered an empty list of its own: "this paragraph
   * is not a list item" is a different fact from "this list has one paragraph", and a caller that
   * cannot tell them apart will indent prose.
   */
  | { readonly op: 'getParagraphList'; readonly paragraph: AutomationHandle }
  /** A list item's `w:ilvl`. Refused for a paragraph that is in no list. */
  | { readonly op: 'getListLevel'; readonly paragraph: AutomationHandle }
  /**
   * Move a list item to another level — Increase/Decrease Indent on a list.
   *
   * The level selects the format out of `numbering.xml`, so the marker changes with it. A level
   * outside 0-8 is refused rather than clamped: nothing defines a format there.
   */
  | { readonly op: 'setListLevel'; readonly paragraph: AutomationHandle; readonly level: number }
  /**
   * Add a paragraph to a list, at one of its edges. Answers the NEW paragraph.
   *
   * The new paragraph is numbered with the list it joins, at the level of the item it is inserted
   * beside — which is what continuing a list means, and what Word does when the caret is at the
   * end of one and Enter is pressed.
   */
  | {
      readonly op: 'insertListParagraph';
      readonly list: AutomationHandle;
      readonly where: 'start' | 'end';
      readonly text: string;
    }
  /**
   * Where a span points: an absolute URL, `#anchor`, or empty for text in no link.
   *
   * Empty rather than an error, because "this text is not a link" is an ordinary fact about a
   * document. Also empty when no SINGLE link covers the whole span — a span half in and half out
   * of a link is not that link's, and answering its target would tell a caller the words they
   * measured are all linked when some of them are not.
   *
   * The answer is the SANITIZED target. A file may carry `javascript:`; nothing reads it back out
   * of this protocol as a target, because a caller handed one would put it in front of a reader.
   */
  | { readonly op: 'getHyperlink'; readonly span: AutomationSpanRef }
  /**
   * Make a span a link, re-aim the link it already is, or unlink it.
   *
   * `''` unlinks: the `w:hyperlink` element goes and its runs stay exactly as they were, which is
   * what Word's Remove Hyperlink does. `#name` points at a bookmark THIS document declares — an
   * anchor nothing declares is refused rather than written as a jump to nowhere. Anything else is
   * an external address, and it is authored only if the engine would open it: a refused scheme
   * never reaches the package, and nothing is written at all.
   */
  | { readonly op: 'setHyperlink'; readonly span: AutomationSpanRef; readonly target: string }
  /**
   * The bookmarks a scope holds, in document order.
   *
   * `{ body }` is a whole story; a narrower span answers the ones it OVERLAPS, which is what
   * "the bookmarks of this range" means. Word's own scratch names (`_GoBack` and the rest of the
   * underscore-prefixed ones) are not answered, matching Word's default.
   */
  | { readonly op: 'getBookmarks'; readonly scope: AutomationSpanRef }
  /** The name a bookmark is declared with. */
  | { readonly op: 'getBookmarkName'; readonly bookmark: AutomationHandle }
  /**
   * The range a bookmark's two markers enclose.
   *
   * Refused once the document no longer declares the name: the markers are gone with the text
   * that held them, and a stale range would point a caller at whatever moved into their place.
   */
  | { readonly op: 'getBookmarkRange'; readonly bookmark: AutomationHandle }
  /**
   * The comments anchored in a scope, in document order — the TOP-LEVEL ones.
   *
   * A reply is reached through the comment it answers rather than listed beside it, because a flat
   * list makes a conversation look like several remarks and loses which answered which.
   */
  | { readonly op: 'getComments'; readonly scope: AutomationSpanRef }
  /** Replies to one comment, in document order. */
  | { readonly op: 'getCommentReplies'; readonly comment: AutomationHandle }
  /** The `w:id` the comments part holds a comment under. */
  | { readonly op: 'getCommentId'; readonly comment: AutomationHandle }
  /** Who wrote a comment. `CT_TrackChange` requires it, so a comment always has one. */
  | { readonly op: 'getCommentAuthor'; readonly comment: AutomationHandle }
  /** `@w:date` verbatim, or empty where the file wrote none. Never invented. */
  | { readonly op: 'getCommentDate'; readonly comment: AutomationHandle }
  /** A comment's body as plain text. */
  | { readonly op: 'getCommentText'; readonly comment: AutomationHandle }
  /** The words a comment is about. Refused for a comment the file gave no usable range. */
  | { readonly op: 'getCommentRange'; readonly comment: AutomationHandle }
  /** Whether the thread is resolved (`w15:commentEx/@w15:done`). */
  | { readonly op: 'getCommentResolved'; readonly comment: AutomationHandle }
  /**
   * Resolve a comment thread, or reopen it.
   *
   * A THREAD: the comment and its replies together, which is what resolving means in Word. Marking
   * the parent alone would leave a reply reading as open under a closed remark.
   */
  | {
      readonly op: 'setCommentResolved';
      readonly comment: AutomationHandle;
      readonly resolved: boolean;
    }
  /**
   * Reply to a comment, over the same words it is anchored to.
   *
   * `author` is required and must not be blank: `CT_TrackChange` makes `@w:author` mandatory, so a
   * reply without one is invalid XML rather than an anonymous remark.
   *
   * Answers the NEW comment, because its `w:id` is minted inside the package transaction and a
   * caller that had to re-read the thread to find its own reply would be reading a document that
   * another writer may have changed in between.
   */
  | {
      readonly op: 'replyToComment';
      readonly comment: AutomationHandle;
      readonly text: string;
      readonly author: string;
      /** ISO-8601. Omitted writes no `@w:date` — inventing one is a content change. */
      readonly date?: string;
    }
  /**
   * The tracked changes of a story, in document order.
   *
   * The ones this engine can RESOLVE. A structural revision — a row, a cell, a section, the table
   * grid — is refused by accept and reject, so it is not answered here: an object that can only
   * refuse is not an object a caller can do anything with.
   */
  | { readonly op: 'getRevisions'; readonly body: AutomationHandle }
  /** Word's name for the kind of change: `Insert`, `Delete`, `Replace`, `Property`, … */
  | { readonly op: 'getRevisionType'; readonly revision: AutomationHandle }
  | { readonly op: 'getRevisionAuthor'; readonly revision: AutomationHandle }
  /** `@w:date` verbatim, or empty where the file wrote none. */
  | { readonly op: 'getRevisionDate'; readonly revision: AutomationHandle }
  /** The words a change covers. Empty-range changes — a formatting one — answer their site. */
  | { readonly op: 'getRevisionRange'; readonly revision: AutomationHandle }
  /**
   * Accept one change, resolving every site that carries its identity.
   *
   * Both halves of a replacement go together: accepting the deletion and leaving the insertion
   * unproposed is a state no reviewer asked for.
   */
  | { readonly op: 'acceptRevision'; readonly revision: AutomationHandle }
  | { readonly op: 'rejectRevision'; readonly revision: AutomationHandle }
  /** Accept every change in the main story, as ONE decision and one undo unit. */
  | { readonly op: 'acceptAllRevisions'; readonly document: AutomationHandle }
  | { readonly op: 'rejectAllRevisions'; readonly document: AutomationHandle }
  /**
   * Put the reader's selection on a span. Requires the `selection` capability, so a headless
   * host refuses it rather than pretending to have a caret.
   */
  | {
      readonly op: 'selectSpan';
      readonly span: AutomationSpanRef;
      readonly mode: AutomationSelectionMode;
    }
  /**
   * Put the reader's selection on the range a bookmark currently encloses.
   *
   * The bookmark is resolved inside the batch so callers do not need a separate round trip to
   * obtain an addressable range. Requires the `selection` capability, like `selectSpan`.
   */
  | {
      readonly op: 'selectBookmark';
      readonly bookmark: AutomationHandle;
      readonly mode: AutomationSelectionMode;
    }
  /**
   * The content controls a scope holds, outermost first and in document order.
   *
   * A control INSIDE another is reached through the one that holds it, never listed beside it:
   * a flat list of a document's controls makes a form field and the section wrapping it look
   * like siblings, and a caller iterating to fill a form would write into both.
   */
  | { readonly op: 'getContentControls'; readonly scope: AutomationContentControlScope }
  /**
   * The first control in a scope whose `w:id` is the one asked for.
   *
   * FIRST, not "the" — `w:id` is not unique in OOXML and a file may write the same number
   * twice. Both controls remain reachable by listing; only this lookup has to choose, and
   * choosing document order is the choice a caller can predict.
   */
  | {
      readonly op: 'getContentControlById';
      readonly scope: AutomationContentControlScope;
      readonly id: number;
    }
  /** Every control in a scope carrying a tag, in document order. */
  | {
      readonly op: 'getContentControlsByTag';
      readonly scope: AutomationContentControlScope;
      readonly tag: string;
    }
  /** Every control in a scope carrying a title (`w:alias`), in document order. */
  | {
      readonly op: 'getContentControlsByTitle';
      readonly scope: AutomationContentControlScope;
      readonly title: string;
    }
  /** `w:tag`, or empty where the file wrote none. Never invented. */
  | { readonly op: 'getContentControlTag'; readonly contentControl: AutomationHandle }
  /** `w:alias` — what Word's UI calls the title. Empty where absent. */
  | { readonly op: 'getContentControlTitle'; readonly contentControl: AutomationHandle }
  /**
   * `w:id` as a STRING, and empty where the file wrote none.
   *
   * Metadata, deliberately: the identity a caller holds is the handle. A file id answered as a
   * number would invite a caller to treat it as one, and an optional non-unique attribute is
   * not an identity however it is spelled.
   */
  | { readonly op: 'getContentControlFileId'; readonly contentControl: AutomationHandle }
  /** The control's type: `richText`, `plainText`, `dropDownList`, `comboBox`, `date`, … */
  | { readonly op: 'getContentControlSubtype'; readonly contentControl: AutomationHandle }
  /** The `ST_Lock` in force, INCLUDING what an enclosing control imposes. */
  | { readonly op: 'getContentControlLock'; readonly contentControl: AutomationHandle }
  /** Whether the control is showing its placeholder rather than a value (`w:showingPlcHdr`). */
  | { readonly op: 'getContentControlPlaceholderShown'; readonly contentControl: AutomationHandle }
  /** Whether the control removes itself on the first edit (`w:temporary`). */
  | { readonly op: 'getContentControlTemporary'; readonly contentControl: AutomationHandle }
  /** The text the control encloses, as the document reads it. */
  | { readonly op: 'getContentControlText'; readonly contentControl: AutomationHandle }
  /** The paragraphs the control holds, in reading order. Empty for an inline control's own. */
  | { readonly op: 'getContentControlParagraphs'; readonly contentControl: AutomationHandle }
  /**
   * The span the control's content covers, so a caller can read or format it.
   *
   * `location` narrows it: `start`/`end` collapse onto the content's edges, and `before`/`after`
   * answer those same edges because a control's boundary marks occupy no offset here.
   */
  | {
      readonly op: 'getContentControlRange';
      readonly contentControl: AutomationHandle;
      readonly location?: AutomationContentControlRangeLocation;
    }
  /**
   * Write the control's value in the vocabulary its own type accepts.
   *
   * The refusals are the store's: `locked`, `bound`, `type-mismatch`, `invalid-value`. This
   * operation adds none of its own, because a script and a keystroke must be refused for the
   * same reasons or a form is only as protected as the path a caller happened to take.
   */
  | {
      readonly op: 'setContentControlValue';
      readonly contentControl: AutomationHandle;
      readonly value: AutomationContentControlValue;
    }
  /** Author tag, title or lock. An omitted member is left as it is; `null` removes it. */
  | {
      readonly op: 'setContentControlProperties';
      readonly contentControl: AutomationHandle;
      readonly tag?: string | null;
      readonly title?: string | null;
      readonly lock?: AutomationContentControlLock;
    }
  /** Remove the control. `keepContent` is Word's own "Remove content control". */
  | {
      readonly op: 'deleteContentControl';
      readonly contentControl: AutomationHandle;
      readonly keepContent: boolean;
    }
  /**
   * Put text into the control, at `replace` (its value) or at one edge of its content.
   *
   * The edge is resolved HERE and not by the caller: a script that read the span first and wrote
   * to it second could only write to where the control was when it asked, and the read and the
   * write would be two refusals instead of one.
   */
  | {
      readonly op: 'insertContentControlText';
      readonly contentControl: AutomationHandle;
      readonly text: string;
      readonly at: 'replace' | 'start' | 'end';
    }
  /** Wrap a span in a new control of the named type. */
  | {
      readonly op: 'insertContentControl';
      readonly span: AutomationSpanRef;
      readonly subtype: AutomationContentControlSubtype;
      readonly tag?: string;
      readonly title?: string;
    }
  /**
   * Insert a custom node: a tagged inline control, optionally bound to a payload.
   *
   * `w:tag` caps at 64 characters, so a node whose identity is a query string fits and a node
   * carrying authors, a year and a locator does not. The payload answers that — it lives in a
   * customXml data part and the control points at it — and the store, the node and the control
   * are ONE transaction. A control bound to a store that was never written is a document Word
   * offers to repair, and repairing it throws the control away.
   *
   * It lives HERE rather than on the editor session so both hosts answer it identically: a
   * payload write needs package scope, and putting it on the session would make the browser the
   * real implementation and leave the headless host to reimplement it or do without.
   *
   * `at` is a position; `span` wraps existing text instead. Exactly one, because a node with
   * both would be an insertion the caller thinks is a wrap.
   */
  | {
      readonly op: 'insertCustomNode';
      /** Where the node goes. Omitted with `span`, which supplies its own place. */
      readonly at?: AutomationPoint;
      /** Text to wrap, in place of `at`. The node's label replaces it. */
      readonly span?: AutomationSpanRef;
      /** The node's identity, as its definition encoded it. Word caps this at 64 characters. */
      readonly tag: string;
      /** The literal text the control holds — what Word and a reader without this library see. */
      readonly text: string;
      /** `w:alias` — the title Word shows on the control. */
      readonly title?: string;
      /** `w:lock`; omitted writes none. */
      readonly lock?: AutomationContentControlLock;
      /** The payload, and where it lives. Omitted authors a control with no store. */
      readonly payload?: AutomationCustomNodePayload;
    };

/**
 * A custom node's payload, and the store it lives in.
 *
 * `data` is a STRING and stays one all the way down. A schema belongs to the definition that
 * declared it, and an automation lane that parsed payloads would be a second opinion about what
 * a host's node means — carried over a transport that cannot hold the schema in the first place.
 *
 * @public
 */
export interface AutomationCustomNodePayload {
  /** Namespace of the store's root element. One store per namespace, per document. */
  readonly namespaceUri: string;
  /** Local name of that root. An NCName; anything else refuses. */
  readonly rootLocalName: string;
  /** The node's id inside the store, which the binding's xpath quotes. */
  readonly nodeId: string;
  /** The text Word paints the control from. Empty is an empty chip. */
  readonly label: string;
  /** The payload, serialized. */
  readonly data: string;
}

/** Just the `op` discriminants of {@link AutomationOperation}, for dispatch tables. */
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
  'getLists',
  'getListId',
  'getListById',
  'getListParagraphs',
  'getParagraphList',
  'getListLevel',
  'getHyperlink',
  'getBookmarks',
  'getBookmarkName',
  'getBookmarkRange',
  'getComments',
  'getCommentReplies',
  'getCommentId',
  'getCommentAuthor',
  'getCommentDate',
  'getCommentText',
  'getCommentRange',
  'getCommentResolved',
  'getRevisions',
  'getRevisionType',
  'getRevisionAuthor',
  'getRevisionDate',
  'getRevisionRange',
  'getContentControls',
  'getContentControlById',
  'getContentControlsByTag',
  'getContentControlsByTitle',
  'getContentControlTag',
  'getContentControlTitle',
  'getContentControlFileId',
  'getContentControlSubtype',
  'getContentControlLock',
  'getContentControlPlaceholderShown',
  'getContentControlTemporary',
  'getContentControlText',
  'getContentControlParagraphs',
  'getContentControlRange',
] as const satisfies readonly AutomationOperationKind[];

/** Operations that write. Every one of these goes through the single transaction path. */
export const AUTOMATION_COMMAND_OPERATIONS = [
  'insertText',
  'replaceSpan',
  'insertParagraph',
  'splitParagraph',
  'deleteParagraph',
  'selectSpan',
  'selectBookmark',
  'setFont',
  'setParagraphFormat',
  'setStyle',
  'setPageSetup',
  'deleteNote',
  'setListLevel',
  'insertListParagraph',
  'setHyperlink',
  'setCommentResolved',
  'replyToComment',
  'acceptRevision',
  'rejectRevision',
  'acceptAllRevisions',
  'rejectAllRevisions',
  'setContentControlValue',
  'setContentControlProperties',
  'deleteContentControl',
  'insertContentControlText',
  'insertContentControl',
  'insertCustomNode',
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
  'setCommentResolved',
  'replyToComment',
  // A payload write is a package transaction of its own — the data part, the node inside it and
  // the body's control — so it shares a batch with nothing, for the same reason a reply does not.
  'insertCustomNode',
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
