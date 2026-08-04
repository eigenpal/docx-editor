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
// addresses by paragraph identity and UTF-16 offset); `ParagraphFormat`, lists, bookmarks,
// hyperlinks, sections, page setup, note bodies, comments and revisions followed.
//
//   Document       — `contentControls`
//   Body           — `contentControls`
//   Range          — `contentControls`
//   Paragraph      — `contentControls`
//
// A NULL A DECLARATION CANNOT SAY. `Font#bold`, `Paragraph#alignment` and `#style` are asserted
// against upstream's own non-nullable declared types, and answer `null` (or `'Mixed'`/`'Unknown'`) at
// runtime where the characters or paragraphs read disagree or nothing authors a value — the same
// behavior upstream documents for the same declarations, which is why the declarations are not
// widened: they would stop matching the reference they are measured against.
//
// The `Declared`/`Mine` naming keeps each assertion readable as a sentence: does mine satisfy the
// declared one, in the position a consumer would use it.

import type { DocxEditor as Declared } from '../../../compat/docxeditor/declarations.ts';
import type { Body } from '../../model/body.ts';
import type { ParagraphCollection, RangeCollection } from '../../model/collections.ts';
import type { Document } from '../../model/document.ts';
import type { Font } from '../../model/font.ts';
import type { Paragraph } from '../../model/paragraph.ts';
import type { Range } from '../../model/range.ts';
import type { ClientObject } from '../client-object.ts';
import type { RequestContext } from '../request-context.ts';
import type { DocxEditorRuntime } from '../runtime.ts';

/** True only if `A` is usable everywhere `B` is expected. */
type Satisfies<A extends B, B> = A extends B ? true : false;

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

// ---------------------------------------------------------------------------
// Ranges and paragraphs
// ---------------------------------------------------------------------------

const rangeTextIsAString: Satisfies<Pick<Range, 'text'>, Pick<Declared.Range, 'text'>> = true;
const rangeSelects: Satisfies<Pick<Range, 'select'>, Pick<Declared.Range, 'select'>> = true;
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

// The character formatting, whole: five properties, read and written, compared against the declared
// ones rather than by argument list, because a property has no argument list to compare.
const fontMatchesTheDeclaredFont: Satisfies<
  Pick<Font, 'bold' | 'color' | 'italic' | 'name' | 'size'>,
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
