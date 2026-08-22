/**
 * Shared types for the `@docx-editor.dev/core` contract. Type-only, zero runtime.
 *
 * `@docx-editor.dev/core/contracts/types` re-exports this module verbatim, through
 * `types-barrel.ts`. There is no `@docx-editor.dev/core/types` subpath.
 */

/** Which paragraph-level reads the selection disagrees about. @public */
export interface ParagraphDisagreements {
  readonly alignment: boolean;
  readonly spaceBeforePt: boolean;
  readonly spaceAfterPt: boolean;
  readonly lineSpacing: boolean;
  readonly tabStops: boolean;
}

/**
 * The five paragraph flags a Paragraph dialog shows as checkboxes.
 *
 * `contextualSpacing` is Word's "Don't add space between paragraphs of the same style";
 * the rest are its Pagination block. `null` means the selection disagrees.
 *
 * @public
 */
export interface ParagraphFlags {
  readonly contextualSpacing: boolean | null;
  readonly keepNext: boolean | null;
  readonly keepLines: boolean | null;
  readonly widowControl: boolean | null;
  readonly pageBreakBefore: boolean | null;
}

/**
 * Every field of the Paragraph dialog, as `setParagraphFormat` takes it.
 *
 * An omitted field is left as authored. `null` REMOVES a setting so the style supplies it
 * again — not the same as a zero, which blocks the cascade.
 *
 * @public
 */
export interface ParagraphFormatCommand {
  alignment?: 'left' | 'center' | 'right' | 'justify';
  spaceBeforePt?: number | null;
  spaceAfterPt?: number | null;
  lineSpacing?: { rule: 'multiple' | 'exact' | 'atLeast'; value: number } | null;
  indentLeftTwips?: number | null;
  indentRightTwips?: number | null;
  /** ONE signed first-line offset: negative is a hanging indent. */
  indentFirstLineTwips?: number | null;
  contextualSpacing?: boolean;
  keepNext?: boolean;
  keepLines?: boolean;
  widowControl?: boolean;
  pageBreakBefore?: boolean;
  /**
   * Replace the paragraph's custom tab stops. An empty list CLEARS them, which is what
   * "Clear All" does; omit the field to leave them as authored.
   */
  tabStops?: readonly ParagraphTabStop[];
}

/** One custom tab stop, as a command states it. @public */
export interface ParagraphTabStop {
  readonly positionTwips: number;
  readonly alignment: 'left' | 'center' | 'right' | 'decimal' | 'bar';
  readonly leader?: 'none' | 'dot' | 'hyphen' | 'underscore' | 'heavy' | 'middleDot';
}

/** Ownership token for one retained selection highlight. @public */
export type SelectionPin = symbol;

// ─── Addressing ──────────────────────────────────────────────────────────────

/**
 * The LLM- and JSON-facing address for a piece of a document.
 *
 * `paraId` is the 8-hex `w14:paraId`, matched case-insensitively. `search` is a
 * phrase that must match EXACTLY ONCE inside that paragraph; ambiguous or
 * missing matches fail with `'ambiguous'` / `'notFound'` rather than falling
 * back to first-match.
 *
 * Offset-based addressing was tried and abandoned: an agent cannot compute a
 * character offset it has not seen, and offsets do not survive concurrent
 * edits. Do not reintroduce `{ blockId, offset }`.
 */
export interface DocAnchor {
  paraId: string;
  search?: string;
  /** Opt-in disambiguation. Omit to require uniqueness. */
  occurrence?: number;
}

/** Structural addressing for content the paraId map cannot reach. */
export interface DocLocation {
  container: ContainerRef;
  /** Block indices, descending into tables and content controls. */
  path: number[];
  offset?: number;
}

/**
 * Which STORY a location belongs to.
 *
 * The body is one container; every header, footer and note is another. A path alone is
 * ambiguous without it, because block index 0 exists in every story a document has.
 */
export type ContainerRef =
  | { part: 'body' }
  | { part: 'header' | 'footer'; rId: string }
  | { part: 'footnote' | 'endnote'; noteId: number };

/**
 * Anything an operation can be pointed at: a paragraph-relative {@link DocAnchor}, a structural
 * {@link DocLocation}, or a {@link DocRange} spanning two of them.
 */
export type DocTarget = DocAnchor | DocLocation | DocRange;

/** A span between two positions. The endpoints may be addressed either way, independently. */
export interface DocRange {
  from: DocAnchor | DocLocation;
  to: DocAnchor | DocLocation;
}

// ─── Results ─────────────────────────────────────────────────────────────────

/**
 * Every write returns this rather than `boolean`.
 *
 * A bare boolean cannot distinguish "no-op" from "target not found" from
 * "content control is locked", and the editor layer already throws eight
 * distinct ContentControl error classes that a boolean would flatten.
 */
export type ExecResult =
  | { ok: true; changed: boolean }
  | { ok: false; code: ExecErrorCode; reason: string; target?: DocTarget };

/**
 * Why a write was refused, as a value to branch on.
 *
 * Deliberately finer-grained than a boolean: "no-op", "target not found" and "content control is
 * locked" are different outcomes, and a caller retrying the first should not retry the third.
 */
export type ExecErrorCode =
  | 'notFound'
  | 'ambiguous'
  | 'locked'
  | 'bound'
  | 'typeMismatch'
  | 'kindMismatch'
  | 'outOfBounds'
  | 'unsupported'
  | 'invalidArgs';

// ─── Document model ──────────────────────────────────────────────────────────

/**
 * A parsed .docx.
 *
 * NOT JSON-round-trippable: it holds `Map`s and `Date`s, plus an internal
 * side-table of verbatim XML used for lossless round-tripping. Use `toJSON` /
 * `fromJSON` before sending it over JSON-RPC or handing it to a model.
 */
export interface DocxDocument {
  readonly body: DocumentBody;
  readonly styles: StyleDefinitions;
  readonly theme?: Theme;
  readonly comments: readonly DocComment[];
  readonly revisions: readonly Revision[];
}

/** The main story: its blocks in reading order, plus the sections derived from them. */
export interface DocumentBody {
  readonly content: readonly Block[];
  /**
   * Derived, not stored: recomputed on read from section-break markers and
   * section inheritance. Never treat it as a spreadable field.
   */
  readonly sections: readonly Section[];
}

/** The JSON-safe projection of a document. */
export interface DocxDocumentJSON {
  readonly [key: string]: unknown;
}

/** One section: the page it lays out on, and the header/footer stories it declares. */
export interface Section {
  readonly properties: SectionProperties;
  readonly headers: HeaderFooterSet;
  readonly footers: HeaderFooterSet;
}

/**
 * A section's three header (or footer) variants, each a relationship id.
 *
 * All optional: a variant a section does not declare inherits the previous section's, and one
 * absent everywhere means the document simply has none.
 */
export interface HeaderFooterSet {
  readonly default?: string;
  readonly first?: string;
  readonly even?: string;
}

/** Anything that can sit at block level in a story. Discriminate on `kind`. */
export type Block = Paragraph | Table | ContentControl;

/** One paragraph: its runs, the style it names, and its list membership. */
export interface Paragraph {
  readonly kind: 'paragraph';
  /** `w14:paraId`. The stable handle `DocAnchor` addresses. */
  readonly paraId?: string;
  readonly runs: readonly Run[];
  readonly styleId?: string;
  readonly numbering?: NumberingRef;
}

/** A stretch of text sharing one set of character properties. */
export interface Run {
  readonly text: string;
  readonly formatting?: RunFormatting;
  /** Set when the run carries a tracked change. Unique only within its part. */
  readonly revisionId?: number;
}

/**
 * Character formatting, and — at selection level — the paragraph properties a toolbar reads
 * alongside it.
 *
 * One type serves both roles so a toolbar reads alignment, style and script state from the same
 * object as bold and italic. On a {@link Run} the selection-level fields stay absent: a run has
 * no alignment or paragraph style of its own.
 */
export interface RunFormatting {
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly strike?: boolean;
  readonly color?: ColorValue;
  readonly highlight?: string;
  readonly fontFamily?: string;
  readonly fontSizePt?: number;
  // ── Selection-level additions (additive, all optional) ─────────────────────────────
  // `EditorSnapshot.formatting` and `getSelectionFormatting` carry the FULL derivable
  // shape through this one type, so a toolbar reads alignment, style and script state
  // from the same object as bold/italic. On a `Run` these stay absent: a run has no
  // alignment or paragraph style of its own.
  readonly superscript?: boolean;
  readonly subscript?: boolean;
  /** Paragraph alignment at the selection. `both` is OOXML's spelling of justify. */
  readonly alignment?: 'left' | 'center' | 'right' | 'both';
  /** Paragraph style id (`w:pStyle`) at the selection. */
  readonly styleId?: string;
  /**
   * Line spacing at the selection, in the unit its rule implies — LINES for `multiple`,
   * points for `exact` and `atLeast`. The same vocabulary `setLineSpacing` takes, so a
   * control can show what it reads and send back what it shows. Absent when the
   * selection's paragraphs disagree or state no line spacing.
   */
  readonly lineSpacing?: {
    readonly rule: 'multiple' | 'exact' | 'atLeast';
    readonly value: number;
  };
  /**
   * Space above and below the paragraph at the selection, in points.
   *
   * The measurement the cascade STATES — `w:docDefaults`, the style chain and direct
   * formatting resolved together — not the gap the page finally draws. The two differ for a
   * paragraph carrying `w:beforeAutospacing`, where Word substitutes its own value and
   * ignores the measurement, and again where two paragraphs collapse their adjacent spacing.
   * Absent when the selection's paragraphs disagree or no level states it.
   */
  readonly spaceBeforePt?: number;
  readonly spaceAfterPt?: number;
  /**
   * The paragraph flags the Paragraph dialog shows as checkboxes.
   *
   * Each is `true`, `false`, or `null` when the selection's paragraphs disagree — a
   * checkbox needs all three. Read through the cascade, so a flag a STYLE sets reads as on,
   * which is what the box has to show over a paragraph the page is visibly keeping with the
   * next. Absent on a `Run`, like every other selection-level field here.
   */
  readonly paragraphFlags?: ParagraphFlags;
  /**
   * Which paragraph-level fields above are absent because the selection DISAGREES, as
   * opposed to because nothing states them.
   *
   * A `null`/absent value alone cannot tell those apart, and both readings have shipped as
   * bugs: a disagreement rendered as a concrete value is uncorrectable, because the value
   * that would fix it is the one already on screen; an absent value rendered as "mixed"
   * tells a single paragraph it disagrees with itself.
   */
  readonly disagrees?: ParagraphDisagreements;
  /**
   * The paragraph's custom tab stops at the selection, cascade included. Absent when the
   * selection disagrees or the paragraphs have none.
   */
  readonly tabStops?: readonly ParagraphTabStop[];
  /**
   * The EFFECTIVE paragraph indent at the selection — cascade and numbering merge
   * included, so a numbered item that authors no `w:ind` reports the indent its list
   * definition gives it. Absent when nothing is loaded, or when the selection is inside a
   * table (see {@link IndentFormatting}).
   */
  readonly indent?: IndentFormatting;
}

/**
 * Indent at the selection, in twips.
 *
 * Unlike every other field here, this does NOT go absent when the selection's paragraphs
 * disagree. A ruler has to draw its handles somewhere, and Word draws them at the FIRST
 * selected paragraph's values — Select All is the commonest indent gesture, and hiding the
 * handles for it would be worse than showing one paragraph's truth. The values are
 * therefore always the first touched paragraph's, and {@link mixed} records per field
 * whether the rest agree.
 *
 * `firstLine` is ONE SIGNED offset: negative is a hanging indent. OOXML spells it as two
 * mutually exclusive attributes and this collapses them hanging-wins (§17.3.1.12), which
 * is the model Word itself keeps.
 *
 * Absent inside a table. The value would be correct there, but it is measured from the
 * cell's content edge while a ruler is drawn against the page's margin, and the ruler does
 * not know the cell.
 */
export interface IndentFormatting {
  /** Left indent, signed. Negative pulls text into the margin, as Word allows. */
  readonly left: number;
  /** Right indent, signed. */
  readonly right: number;
  /** First-line offset from {@link left}, signed. Negative is a hanging indent. */
  readonly firstLine: number;
  /** Per field, whether the selection's paragraphs disagree about it. */
  readonly mixed: {
    readonly left: boolean;
    readonly right: boolean;
    readonly firstLine: boolean;
  };
}

/** A table: its rows, and the table style they resolve through. */
export interface Table {
  readonly kind: 'table';
  readonly rows: readonly TableRow[];
  readonly styleId?: string;
}

/** One table row. Cell count may vary between rows: `colSpan` and vertical merges reshape it. */
export interface TableRow {
  readonly cells: readonly TableCell[];
}

/**
 * One cell. Its `content` is ordinary blocks, so a cell may hold paragraphs, nested tables and
 * content controls alike.
 */
export interface TableCell {
  readonly content: readonly Block[];
  /** Vertical merge span. Absent means 1. */
  readonly rowSpan?: number;
  /** `w:gridSpan`. Absent means 1. */
  readonly colSpan?: number;
}

/** Structured document tag (`w:sdt`). */
export interface ContentControl {
  readonly kind: 'contentControl';
  readonly id: string;
  readonly tag?: string;
  readonly alias?: string;
  readonly controlType: ContentControlType;
  readonly locked?: boolean;
  readonly content: readonly Block[];
}

/** Which kind of control a `w:sdt` is, and therefore what a value written into it must be. */
export type ContentControlType =
  | 'richText'
  | 'plainText'
  | 'checkbox'
  | 'dropdown'
  | 'comboBox'
  | 'date'
  | 'picture'
  | 'repeatingSection';

/**
 * Narrows a content-control query. Fields combine with AND; an empty filter matches every
 * control.
 */
export interface ContentControlFilter {
  readonly tag?: string;
  readonly alias?: string;
  readonly controlType?: ContentControlType;
}

/**
 * A position in one story: a paragraph and a UTF-16 offset inside it.
 *
 * The same offset space the ops and the caret use, so an anchor read here can be handed
 * straight back to a selection without re-deriving anything.
 */
export interface DocAnchorRange {
  /** Canonical part name of the story the range lives in, e.g. `/word/document.xml`. */
  readonly part: string;
  readonly startParagraphId: string;
  readonly startOffset: number;
  /** May sit in a later paragraph: the range markers are independent elements. */
  readonly endParagraphId: string;
  readonly endOffset: number;
}

/**
 * One comment or reply, as `comments.xml` records it.
 *
 * A reply is a comment with a `parentId`; OOXML gives replies no separate element, so the thread
 * is reconstructed from that link rather than from nesting.
 */
export interface DocComment {
  readonly id: string;
  readonly author: string;
  /**
   * OPTIONAL, because `CT_Comment` makes `@w:date` optional and files omit it. A comment
   * with no date is a comment, not a defect, and fabricating one is a content change.
   */
  readonly date?: string;
  readonly text: string;
  readonly parentId?: string;
  readonly resolved?: boolean;
  /**
   * Where the comment is anchored, absent when the file gave it no usable range.
   *
   * A comment lives in `comments.xml` and is placed by markers in a STORY, so the story is
   * part of the address: a comment anchored in a header belongs to a part the body never saw.
   */
  readonly anchor?: DocAnchorRange;
  /**
   * True when the file gave this comment no usable range — a reference with no markers, or a
   * start with no end. Reported rather than dropped: a reviewer's remark vanishing silently
   * is worse than one that says it lost its text.
   */
  readonly orphaned?: boolean;
}

/**
 * What kind of decision a revision represents.
 *
 * Wider than insert/delete/format, and it has to be. `w:moveFrom`/`w:moveTo` are not a
 * deletion and an insertion — resolving one half alone duplicates or loses the content;
 * `w:pPr/w:rPr/w:ins|w:del` decorates no characters at all and merges paragraphs when
 * resolved; a row or cell revision is structural. A reviewer shown only three kinds is a
 * reviewer who never learns about the rest.
 */
export type RevisionType =
  | 'insert'
  | 'delete'
  /** A deletion and an insertion that are one edit: text typed over a selection. */
  | 'replace'
  | 'moveFrom'
  | 'moveTo'
  /** `w:rPrChange` / `w:pPrChange` — the words are unchanged, their formatting is not. */
  | 'format'
  /** `w:pPr/w:rPr/w:ins|w:del` — a paragraph split or merge. */
  | 'paragraphMark'
  /** A row, cell, section or grid revision. */
  | 'structural';

/**
 * One tracked change.
 *
 * Addressing needs BOTH `id` and `part`: `@w:id` is unique only within a part, so an id alone
 * names two revisions in any package that has a header or a comments part.
 */
export interface Revision {
  /** Numeric, and unique only WITHIN a part. Pair with `part` to address one. */
  readonly id: number;
  readonly type: RevisionType;
  readonly author: string;
  /**
   * OPTIONAL. `CT_TrackChange` requires `@w:id` and `@w:author` and makes `@w:date`
   * optional, and producers that omit it are ordinary. Requiring it here forced either a
   * fabricated date — a content change — or dropping the revision from the list.
   */
  readonly date?: string;
  /**
   * REQUIRED, and a canonical PART NAME rather than a three-value enum.
   *
   * `@w:id` is unique only within a part, so an address without one names two revisions in a
   * package that has both. The enum could not express the parts revisions actually occur in:
   * `header3.xml`, `footer1.xml`, `comments.xml`, and `styles.xml`, which carries
   * `w:pPrChange` inside style definitions with ids that collide with `document.xml`.
   */
  readonly part: string;
}

/** `w:sectPr`: the page a section lays out on. Twips throughout, as the file stores them. */
export interface SectionProperties {
  readonly pageSize: { widthTwips: number; heightTwips: number };
  readonly margins: PageMargins;
  readonly columns?: { count: number; gapTwips: number };
  /** `w:titlePg` — whether the section's first page takes the `first` header/footer variant. */
  readonly titlePage?: boolean;
}

/** Page margins in twips. */
export interface PageMargins {
  readonly topTwips: number;
  readonly rightTwips: number;
  readonly bottomTwips: number;
  readonly leftTwips: number;
}

/**
 * `styles.xml`, split by the three style families that address separately.
 *
 * Keyed by style ID rather than by the name a reader sees, because the ID is what a paragraph or
 * run actually references.
 */
export interface StyleDefinitions {
  readonly paragraph: ReadonlyMap<string, StyleDefinition>;
  readonly character: ReadonlyMap<string, StyleDefinition>;
  readonly table: ReadonlyMap<string, StyleDefinition>;
}

/** One style: the ID content references, the name a reader sees, and its inheritance link. */
export interface StyleDefinition {
  readonly id: string;
  readonly name: string;
  /** `w:basedOn` — the style this one inherits from. Absent at the root of a chain. */
  readonly basedOn?: string;
}

/** A paragraph's list membership: which `numbering.xml` definition, and at which level. */
export interface NumberingRef {
  readonly numId: string;
  /** Zero-based. OOXML numbering has nine levels, 0 through 8. */
  readonly level: number;
}

/**
 * A colour as the FILE expresses it, not as a resolved RGB string.
 *
 * A theme colour stays a theme reference — slot plus tint or shade — so that changing the theme
 * repaints the document the way Word does. Flattening to hex at read time would freeze the
 * resolved value and break that link. `auto` is Word's "let the renderer decide", usually black
 * on white.
 */
export type ColorValue =
  | { readonly kind: 'hex'; readonly value: string }
  | {
      readonly kind: 'theme';
      readonly slot: string;
      readonly tint?: number;
      readonly shade?: number;
    }
  | { readonly kind: 'auto' };

/** `theme1.xml` — what a {@link ColorValue} of kind `theme` resolves against. */
export interface Theme {
  readonly colorScheme: ThemeColorScheme;
  readonly fontScheme?: Record<string, string>;
}

/** Theme colour slots (`accent1`, `dk1`, `lt2`, …) to hex. */
export type ThemeColorScheme = Readonly<Record<string, string>>;

/** A watermark, which OOXML expresses as either text or an image — never both meaningfully. */
export interface Watermark {
  readonly text?: string;
  readonly imageData?: Uint8Array;
}

/** A size in EMUs, the unit DrawingML stores extents in. 914400 EMU = 1 inch. */
export interface Extent {
  readonly widthEmu: number;
  readonly heightEmu: number;
}

/** A font the document names, and whether its bytes travel inside the package. */
export interface FontDefinition {
  readonly family: string;
  readonly embedded: boolean;
}

// ─── Geometry primitives ─────────────────────────────────────────────────────

/** An axis-aligned rectangle in points, the unit layout works in throughout. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A position in points. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** What every subscription returns. Calling it twice is safe. */
export type Unsubscribe = () => void;
