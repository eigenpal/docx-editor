/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The runtime and its object model, measured against `compat/docxeditor/declarations.ts`.
//
// Those declarations were authored by hand, from the published Word API surface, without deriving
// anything from a Microsoft package. This file is the other direction of the same claim: that what
// this package ships is what they describe. It contains no runtime code — every statement here is an
// assignability question put to the compiler, and `__tests__/runtime-declared-conformance.test.ts`
// compiles it (plus a deliberately wrong copy, so the compiling is known to be load-bearing).
//
// WHAT IS CHECKED, in two kinds:
//
//   THE LIFECYCLE, whole. `sync()`, `context` and `isNullObject` on a proxy, `run(batch)` giving
//   back the batch's value, and `RequestContext.document` being the model's `Document`.
//
//   THE CALL SHAPES of every member the model implements. Parameter tuples, compared against the
//   declared ones, so a consumer's own call sites — `insertText('x', 'End')`, `split([';'], true)`,
//   `search(text, { matchCase: true })` — compile identically against either. Plus the properties
//   whose types are primitives (`text`) and the methods that answer nothing (`clear`, `delete`,
//   `select`), which can be compared whole.
//
// WHY RETURN TYPES ARE NOT COMPARED WHOLE. A declared `Body#insertText` answers the declared
// `Range`, which also has `contentControls`. This package's `Range` does not, so the shipped type is
// NARROWER than the declared one and asserting the whole return type would either fail or have to be
// faked. What is asserted instead is that the method exists, takes exactly the declared arguments,
// and answers this package's own object of the right sort — and the list below says, by name, what is
// still owed.
//
// WHAT IS NOT IMPLEMENTED YET, and therefore not asserted. One group, and a SCHEDULED one: content
// controls, which the plan completes as its own step. Nothing else on the declared surface is
// unimplemented, because everything that was not implemented has been de-selected from
// `compat/manifest.json` — with a reason each — and removed from the declarations, so the authored
// file is an inventory rather than a roadmap. `Range#start`/`end` were the first members treated that
// way (document-wide character offsets are a second addressing scheme for positions this lane already
// addresses by paragraph identity and UTF-16 offset); `Bookmark#start`/`end`/`delete`,
// `ListItem#listString`/`siblingIndex`, `ParagraphFormat`, and a comment's assignable body and its
// author's email address followed, each for its own recorded reason.
//
//   Document       — `contentControls`
//   Body           — `contentControls`
//   Range          — `contentControls`
//   Paragraph      — `contentControls`
//
// A NULL THE UPSTREAM DECLARATION CANNOT SAY. Font reads include `null` in this package's public
// surface because mixed or inherited formatting returns it at runtime; its setters remain the
// upstream non-nullable types. The independently authored compatibility declaration stays exact to
// upstream, so the font assertion below removes only that documented read sentinel before comparing.
// `Paragraph#alignment` and `#style` retain their separately documented `'Mixed'`/`'Unknown'`
// behavior.
//
// The `Declared`/`Mine` naming keeps each assertion readable as a sentence: does mine satisfy the
// declared one, in the position a consumer would use it.

import type { DocxEditor as Declared } from '../../../compat/docxeditor/declarations.ts';
import type { Body } from '../../model/body.ts';
import type { Bookmark, BookmarkCollection } from '../../model/bookmarks.ts';
import type { ParagraphCollection, RangeCollection } from '../../model/collections.ts';
import type { Document } from '../../model/document.ts';
import type { Font } from '../../model/font.ts';
import type { List, ListCollection, ListItem } from '../../model/lists.ts';
import type { NoteItem, NoteItemCollection } from '../../model/notes.ts';
import type { Paragraph } from '../../model/paragraph.ts';
import type { Range } from '../../model/range.ts';
import type {
  Comment,
  CommentCollection,
  CommentReply,
  CommentReplyCollection,
  Revision,
  RevisionCollection,
} from '../../model/review.ts';
import type { PageSetup, Section, SectionCollection } from '../../model/sections.ts';
import type { ClientObject } from '../client-object.ts';
import type { RequestContext } from '../request-context.ts';
import type { DocxEditorRuntime } from '../runtime.ts';

/** True only if `A` is usable everywhere `B` is expected. */
type Satisfies<A extends B, B> = A extends B ? true : false;

/** Removes this runtime's documented no-agreed-value sentinel from property reads. */
type WithoutNull<T> = { [K in keyof T]: Exclude<T[K], null> };

/**
 * True only if a call written against `B` compiles against `A`.
 *
 * A plain conditional rather than `Satisfies`, because a constraint over two generic parameter
 * tuples cannot be checked until both are instantiated; the assignment to `true` is what fails when
 * the answer is `false`.
 */
type TakesTheSameArguments<
  A extends (...args: never[]) => unknown,
  B extends (...args: never[]) => unknown,
> = Parameters<B> extends Parameters<A> ? true : false;

// ---------------------------------------------------------------------------
// The lifecycle
// ---------------------------------------------------------------------------

// The batch boundary. `ClientRequestContext` declares exactly one member, on purpose (see the
// declarations' file header), and it is the one an example awaits.
const syncsLikeTheDeclaredContext: Satisfies<
  Pick<RequestContext, 'sync'>,
  Pick<Declared.ClientRequestContext, 'sync'>
> = true;

// A proxy carries its context and answers whether it turned out to be nothing. Both are declared on
// the base `ClientObject`, so both are checked against the base rather than against a feature type.
const carriesItsContext: Satisfies<
  Pick<ClientObject, 'context'>,
  Pick<Declared.ClientObject, 'context'>
> = true;

const answersIsNullObject: Satisfies<
  Pick<ClientObject, 'isNullObject'>,
  Pick<Declared.ClientObject, 'isNullObject'>
> = true;

// `run` returns what the batch returned, and the context it hands the batch is the one whose
// `document` is the object model's root.
const runReturnsTheBatchValue: Satisfies<
  DocxEditorRuntime['run'],
  <T>(batch: (context: RequestContext) => Promise<T>) => Promise<T>
> = true;

const contextRootIsTheDocument: Satisfies<RequestContext['document'], Document> = true;

// A concrete instance of the shape, so the generic above cannot pass by being vacuous.
declare const runtime: DocxEditorRuntime;
const batchValueSurvives: Promise<number> = runtime.run(async () => 7);

// ---------------------------------------------------------------------------
// The document and its stories
// ---------------------------------------------------------------------------

const documentHasABody: Satisfies<Document['body'], Body> = true;
const documentHasParagraphs: Satisfies<Document['paragraphs'], ParagraphCollection> = true;

const bodyTextIsAString: Satisfies<Pick<Body, 'text'>, Pick<Declared.Body, 'text'>> = true;
const bodyClears: Satisfies<Pick<Body, 'clear'>, Pick<Declared.Body, 'clear'>> = true;
const bodyInsertsText: TakesTheSameArguments<Body['insertText'], Declared.Body['insertText']> =
  true;
const bodyInsertsAParagraph: TakesTheSameArguments<
  Body['insertParagraph'],
  Declared.Body['insertParagraph']
> = true;
const bodySearches: TakesTheSameArguments<Body['search'], Declared.Body['search']> = true;
const bodyAnswersItsOwnObjects: Satisfies<
  [ReturnType<Body['insertText']>, ReturnType<Body['insertParagraph']>, ReturnType<Body['search']>],
  [Range, Paragraph, RangeCollection]
> = true;
const bodyHasParagraphs: Satisfies<Body['paragraphs'], ParagraphCollection> = true;
const bodyHasBookmarks: Satisfies<Body['bookmarks'], BookmarkCollection> = true;

// ---------------------------------------------------------------------------
// Ranges and paragraphs
// ---------------------------------------------------------------------------

const rangeTextIsAString: Satisfies<Pick<Range, 'text'>, Pick<Declared.Range, 'text'>> = true;
const rangeSelects: Satisfies<Pick<Range, 'select'>, Pick<Declared.Range, 'select'>> = true;
const rangeComments: TakesTheSameArguments<
  Range['insertComment'],
  Declared.Range['insertComment']
> = true;
const rangeCommentIsAComment: Satisfies<ReturnType<Range['insertComment']>, Comment> = true;
const rangeInsertsText: TakesTheSameArguments<Range['insertText'], Declared.Range['insertText']> =
  true;
const rangeInsertsAParagraph: TakesTheSameArguments<
  Range['insertParagraph'],
  Declared.Range['insertParagraph']
> = true;
const rangeSearches: TakesTheSameArguments<Range['search'], Declared.Range['search']> = true;
const rangeHasParagraphs: Satisfies<Range['paragraphs'], ParagraphCollection> = true;

const paragraphTextIsAString: Satisfies<
  Pick<Paragraph, 'text'>,
  Pick<Declared.Paragraph, 'text'>
> = true;
const paragraphClearsAndDeletes: Satisfies<
  Pick<Paragraph, 'clear' | 'delete'>,
  Pick<Declared.Paragraph, 'clear' | 'delete'>
> = true;
const paragraphInsertsText: TakesTheSameArguments<
  Paragraph['insertText'],
  Declared.Paragraph['insertText']
> = true;
const paragraphInsertsAParagraph: TakesTheSameArguments<
  Paragraph['insertParagraph'],
  Declared.Paragraph['insertParagraph']
> = true;
const paragraphSplits: TakesTheSameArguments<Paragraph['split'], Declared.Paragraph['split']> =
  true;
const paragraphAnswersItsOwnObjects: Satisfies<
  [
    ReturnType<Paragraph['insertText']>,
    ReturnType<Paragraph['insertParagraph']>,
    ReturnType<Paragraph['split']>,
  ],
  [Range, Paragraph, RangeCollection]
> = true;

// ---------------------------------------------------------------------------
// Formatting, and the style
// ---------------------------------------------------------------------------

// Every story, stretch and paragraph carries the same `Font`, so a consumer's helper that takes one
// works wherever it came from.
const fontsAreTheSameObject: Satisfies<
  [Body['font'], Range['font'], Paragraph['font']],
  [Font, Font, Font]
> = true;

// The five character-formatting properties, after removing the read-only `null` sentinel that the
// upstream declarations omit. Public type tests separately prove that setters do not accept it.
const fontMatchesTheDeclaredFont: Satisfies<
  WithoutNull<Pick<Font, 'bold' | 'color' | 'italic' | 'name' | 'size'>>,
  Pick<Declared.Font, 'bold' | 'color' | 'italic' | 'name' | 'size'>
> = true;

// The paragraph's own formatting values, in the flattened form the declarations give them — the
// selected subset has no `ParagraphFormat` for them to hang off (a recorded omission), and this is the
// shape upstream declares on `Paragraph` anyway.
const paragraphFormattingMatches: Satisfies<
  Pick<
    Paragraph,
    | 'alignment'
    | 'firstLineIndent'
    | 'leftIndent'
    | 'lineSpacing'
    | 'rightIndent'
    | 'spaceAfter'
    | 'spaceBefore'
  >,
  Pick<
    Declared.Paragraph,
    | 'alignment'
    | 'firstLineIndent'
    | 'leftIndent'
    | 'lineSpacing'
    | 'rightIndent'
    | 'spaceAfter'
    | 'spaceBefore'
  >
> = true;

// And the style, by name, on all three of the objects that declare it.
const stylesMatch: Satisfies<
  [Pick<Body, 'style'>, Pick<Range, 'style'>, Pick<Paragraph, 'style'>],
  [Pick<Declared.Body, 'style'>, Pick<Declared.Range, 'style'>, Pick<Declared.Paragraph, 'style'>]
> = true;

// ---------------------------------------------------------------------------
// The collections
// ---------------------------------------------------------------------------

const paragraphsAreReachable: Satisfies<
  [ReturnType<ParagraphCollection['getFirst']>, ReturnType<ParagraphCollection['getLast']>],
  [Paragraph, Paragraph]
> = true;

const paragraphItemsAreParagraphs: Satisfies<ParagraphCollection['items'], readonly Paragraph[]> =
  true;

const rangesAreReachable: Satisfies<ReturnType<RangeCollection['getFirst']>, Range> = true;
const rangeItemsAreRanges: Satisfies<RangeCollection['items'], readonly Range[]> = true;

// The two edges that are DocxEditor's own rather than the reference's — the or-null form, and the
// other end, which the pieces of a split make worth having. Both recorded as omissions in
// `compat/manifest.json`; asserted here so their types cannot drift from the declared `getFirst`'s.
const rangeEdgesAgree: Satisfies<
  [ReturnType<RangeCollection['getLast']>, ReturnType<RangeCollection['getFirstOrNullObject']>],
  [Range, Range]
> = true;

// ---------------------------------------------------------------------------
// Lists, bookmarks, sections, notes, comments and tracked changes
// ---------------------------------------------------------------------------

// A list's number and its members, and the two ways of asking for its paragraphs.
const listMatchesTheDeclaredList: Satisfies<Pick<List, 'id'>, Pick<Declared.List, 'id'>> = true;
const listTakesAParagraph: TakesTheSameArguments<
  List['insertParagraph'],
  Declared.List['insertParagraph']
> = true;
const listLevelsAreParagraphs: TakesTheSameArguments<
  List['getLevelParagraphs'],
  Declared.List['getLevelParagraphs']
> = true;
const listAnswersItsOwnObjects: Satisfies<
  [List['paragraphs'], ReturnType<List['insertParagraph']>],
  [ParagraphCollection, Paragraph]
> = true;
const listsAreReachable: TakesTheSameArguments<
  ListCollection['getById'],
  Declared.ListCollection['getById']
> = true;
const listItemsAreLists: Satisfies<
  [ListCollection['items'], ReturnType<ListCollection['getFirst']>],
  [readonly List[], List]
> = true;
const listItemLevelMatches: Satisfies<
  Pick<ListItem, 'level'>,
  Pick<Declared.ListItem, 'level'>
> = true;

// A paragraph says which list it is in and where in it — the two accessors upstream declares.
const paragraphReachesItsList: Satisfies<
  [Paragraph['list'], Paragraph['listItem']],
  [List, ListItem]
> = true;

// A bookmark's name, the words it encloses, and moving the reader to it.
const bookmarkMatchesTheDeclaredBookmark: Satisfies<
  Pick<Bookmark, 'name'>,
  Pick<Declared.Bookmark, 'name'>
> = true;
const bookmarkSelects: TakesTheSameArguments<Bookmark['select'], Declared.Bookmark['select']> =
  true;
const bookmarkRangeIsARange: Satisfies<Bookmark['range'], Range> = true;
const bookmarkItemsAreBookmarks: Satisfies<BookmarkCollection['items'], readonly Bookmark[]> = true;
const rangeReachesItsBookmarks: Satisfies<Range['bookmarks'], BookmarkCollection> = true;
const rangeHyperlinkMatches: Satisfies<
  Pick<Range, 'hyperlink'>,
  Pick<Declared.Range, 'hyperlink'>
> = true;

// A section: the page it is laid out on, the furniture it prints, and the next one.
const pageSetupMatchesTheDeclaredPageSetup: Satisfies<PageSetup, Declared.PageSetup> = true;
const sectionFurnitureTakesTheDeclaredVariant: Satisfies<
  [
    TakesTheSameArguments<Section['getHeader'], Declared.Section['getHeader']>,
    TakesTheSameArguments<Section['getFooter'], Declared.Section['getFooter']>,
  ],
  [true, true]
> = true;
const sectionAnswersItsOwnObjects: Satisfies<
  [
    Section['body'],
    Section['pageSetup'],
    ReturnType<Section['getHeader']>,
    ReturnType<Section['getNext']>,
  ],
  [Body, PageSetup, Body, Section]
> = true;
const sectionItemsAreSections: Satisfies<
  [SectionCollection['items'], ReturnType<SectionCollection['getFirst']>],
  [readonly Section[], Section]
> = true;
const documentReachesItsSections: Satisfies<Document['sections'], SectionCollection> = true;

// A note is a story of its own, and it says which kind of note it is.
const noteMatchesTheDeclaredNote: Satisfies<
  Pick<NoteItem, 'type'>,
  Pick<Declared.NoteItem, 'type'>
> = true;
const noteDeletes: Satisfies<Pick<NoteItem, 'delete'>, Pick<Declared.NoteItem, 'delete'>> = true;
const noteAnswersItsOwnObjects: Satisfies<
  [NoteItem['body'], ReturnType<NoteItem['getNext']>],
  [Body, NoteItem]
> = true;
const noteItemsAreNotes: Satisfies<
  [NoteItemCollection['items'], ReturnType<NoteItemCollection['getFirst']>],
  [readonly NoteItem[], NoteItem]
> = true;
// Upstream hangs these off a story; here they are the document's, because only the main story may
// reference a note (a recorded omission). The collection they answer is the measured one.
const notesAreReachable: Satisfies<
  [Document['footnotes'], Document['endnotes']],
  [NoteItemCollection, NoteItemCollection]
> = true;

// A comment: who wrote it, when, whether the thread is settled, and answering it. OOXML may omit
// or corrupt the date, so the runtime's nullable read is checked separately from the upstream shape.
const commentMatchesTheDeclaredComment: Satisfies<
  Pick<Comment, 'authorName' | 'id' | 'resolved' | 'delete'>,
  Pick<Declared.Comment, 'authorName' | 'id' | 'resolved' | 'delete'>
> = true;
const commentDateMatchesAfterDocumentedNull: Satisfies<
  WithoutNull<Pick<Comment, 'creationDate'>>,
  Pick<Declared.Comment, 'creationDate'>
> = true;
const commentRepliesTakeText: TakesTheSameArguments<Comment['reply'], Declared.Comment['reply']> =
  true;
const commentAnswersItsOwnObjects: Satisfies<
  [Comment['replies'], ReturnType<Comment['getRange']>, ReturnType<Comment['reply']>],
  [CommentReplyCollection, Range, CommentReply]
> = true;
const replyMatchesTheDeclaredReply: Satisfies<
  Pick<CommentReply, 'authorName' | 'id' | 'delete'>,
  Pick<Declared.CommentReply, 'authorName' | 'id' | 'delete'>
> = true;
const replyDateMatchesAfterDocumentedNull: Satisfies<
  WithoutNull<Pick<CommentReply, 'creationDate'>>,
  Pick<Declared.CommentReply, 'creationDate'>
> = true;
const commentItemsAreComments: Satisfies<
  [
    CommentCollection['items'],
    ReturnType<CommentCollection['getFirst']>,
    CommentReplyCollection['items'],
  ],
  [readonly Comment[], Comment, readonly CommentReply[]]
> = true;
const commentsAreReachableBothWays: Satisfies<
  [Document['comments'], ReturnType<Body['getComments']>],
  [CommentCollection, CommentCollection]
> = true;

// A tracked change, and the decision a reviewer makes about it. The declared `type` union is the
// whole upstream vocabulary; this model publishes the same union and answers seven of its members.
// Its date has the same documented nullable OOXML divergence as a comment's.
const revisionMatchesTheDeclaredRevision: Satisfies<
  Pick<Revision, 'author' | 'type' | 'accept' | 'reject'>,
  Pick<Declared.Revision, 'author' | 'type' | 'accept' | 'reject'>
> = true;
const revisionDateMatchesAfterDocumentedNull: Satisfies<
  WithoutNull<Pick<Revision, 'date'>>,
  Pick<Declared.Revision, 'date'>
> = true;
const revisionRangeIsARange: Satisfies<Revision['range'], Range> = true;
const revisionsAreDecidedInBulk: Satisfies<
  Pick<RevisionCollection, 'acceptAll' | 'rejectAll'>,
  Pick<Declared.RevisionCollection, 'acceptAll' | 'rejectAll'>
> = true;
const revisionItemsAreRevisions: Satisfies<RevisionCollection['items'], readonly Revision[]> = true;
// By the object it answers rather than against the declared property, for the reason the file header
// gives: a declared `items` is a mutable array and this model's is `readonly`, which is narrower.
const revisionsAreReachable: Satisfies<Document['revisions'], RevisionCollection> = true;

// A declared search option object is accepted verbatim by this model's `search`.
declare const declaredOptions: Declared.SearchOptions;
declare const body: Body;
const declaredOptionsAreAccepted: RangeCollection = body.search('needle', declaredOptions);

// Nothing is exported: this file is a set of questions for the compiler, not a module anyone imports.
void syncsLikeTheDeclaredContext;
void carriesItsContext;
void answersIsNullObject;
void runReturnsTheBatchValue;
void contextRootIsTheDocument;
void batchValueSurvives;
void documentHasABody;
void documentHasParagraphs;
void bodyTextIsAString;
void bodyClears;
void bodyInsertsText;
void bodyInsertsAParagraph;
void bodySearches;
void bodyAnswersItsOwnObjects;
void bodyHasParagraphs;
void bodyHasBookmarks;
void rangeTextIsAString;
void rangeSelects;
void rangeInsertsText;
void rangeInsertsAParagraph;
void rangeSearches;
void rangeHasParagraphs;
void paragraphTextIsAString;
void paragraphClearsAndDeletes;
void paragraphInsertsText;
void paragraphInsertsAParagraph;
void paragraphSplits;
void paragraphAnswersItsOwnObjects;
void paragraphsAreReachable;
void paragraphItemsAreParagraphs;
void rangesAreReachable;
void rangeItemsAreRanges;
void rangeEdgesAgree;
void declaredOptionsAreAccepted;
void fontsAreTheSameObject;
void fontMatchesTheDeclaredFont;
void paragraphFormattingMatches;
void stylesMatch;
void listMatchesTheDeclaredList;
void listTakesAParagraph;
void listLevelsAreParagraphs;
void listAnswersItsOwnObjects;
void listsAreReachable;
void listItemsAreLists;
void listItemLevelMatches;
void paragraphReachesItsList;
void bookmarkMatchesTheDeclaredBookmark;
void bookmarkSelects;
void bookmarkRangeIsARange;
void bookmarkItemsAreBookmarks;
void rangeReachesItsBookmarks;
void rangeHyperlinkMatches;
void rangeComments;
void rangeCommentIsAComment;
void pageSetupMatchesTheDeclaredPageSetup;
void sectionFurnitureTakesTheDeclaredVariant;
void sectionAnswersItsOwnObjects;
void sectionItemsAreSections;
void documentReachesItsSections;
void noteMatchesTheDeclaredNote;
void noteDeletes;
void noteAnswersItsOwnObjects;
void commentMatchesTheDeclaredComment;
void commentDateMatchesAfterDocumentedNull;
void commentRepliesTakeText;
void commentAnswersItsOwnObjects;
void replyMatchesTheDeclaredReply;
void replyDateMatchesAfterDocumentedNull;
void commentItemsAreComments;
void commentsAreReachableBothWays;
void revisionMatchesTheDeclaredRevision;
void revisionDateMatchesAfterDocumentedNull;
void revisionRangeIsARange;
void revisionsAreDecidedInBulk;
void revisionItemsAreRevisions;
void revisionsAreReachable;
void noteItemsAreNotes;
void notesAreReachable;
