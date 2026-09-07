import type { DocumentProperties, OoxmlNode } from '@docx-editor.dev/core/store';
import type { ExclusionZone } from './drawing-exclusion.ts';
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import type { FieldLinkProjector, HyperlinkProjector } from './field-projection.ts';
import type { ParagraphLayoutCache } from './layout-cache.ts';
import type { LayoutSession } from './layout-session.ts';
import type { ResolvedListItem } from './list-resolve.ts';
import type { NumberingIndex } from './numbering-index.ts';
import type { PageFurniture } from './page-furniture-insets.ts';
import type { PendingLine } from './paragraph-flow.ts';
import type { RevisionAuthorFilter, RevisionDisplayMode } from './revision-projection.ts';
import type { SectionColumns } from './section-properties.ts';
import type { PageGeometry, TextMeasurer } from './semantic-records.ts';
import type { StyleCascadeTable } from './style-cascade.ts';

/**
 * Everything a layout pass needs beyond the document itself.
 *
 * `measurer` is the only required field — layout is DOM-free and measures through whatever is
 * injected here, which is what lets the same code paginate on a server and in a browser.
 */
export interface SemanticLayoutOptions {
  readonly geometry?: PageGeometry;
  readonly measurer: TextMeasurer;
  /**
   * Reuse of measured-and-broken paragraphs across revisions (task 9.2).
   *
   * Only the BREAK is cached. Placement — y, fragments, page cuts — is always redone, so
   * an edit high in the document still repaginates everything below it while paragraphs
   * nobody touched are never measured again.
   */
  readonly cache?: ParagraphLayoutCache<readonly PendingLine[]>;
  /**
   * Collector for the cache keys a pass wants retained, instead of retaining directly.
   * Supplied by the multi-section orchestrator, which retains once over the union —
   * retaining per section evicted every other section's entries. `false` skips retention
   * for this pass entirely (the orchestrator strides sweeps). See
   * `retainLiveBreakKeys`.
   */
  readonly retainKeys?: Set<string> | false;
  /**
   * Part-level drawing projection/resource epoch for the section prepass memo.
   *
   * Moves whenever any drawing projection or resource state in the part does, standing in
   * for the per-paragraph drawing tokens the memo would otherwise have to recompute to
   * validate. A caller that supplies `drawingTokenForParagraph` without this epoch keeps
   * the recompute path — the memo must never miss a token move it cannot see.
   */
  readonly drawingLayoutEpoch?: string;
  /** Part-level freshness signal for paragraph-local semantic projection tokens. */
  readonly projectionEpoch?: string;
  /**
   * Who produced the measurements, folded into every cache key.
   *
   * A font arriving after first paint changes every advance in the document while no
   * content changes; without this the cache would serve the pre-font layout forever.
   */
  readonly producer?: string;
  /**
   * Incremental placement across revisions (task 9.3).
   *
   * Holds the previous complete layout and a flow checkpoint per paragraph, so a pass can
   * resume just before the first affected paragraph instead of re-placing the document from
   * the top, and can stop early when the flow reconverges with the previous run.
   *
   * Multi-section documents keep per-section child sessions on {@link LayoutSession.multi}.
   */
  readonly session?: LayoutSession;
  /** Header/footer stories to attach per page; absent means no furniture. */
  readonly furniture?: PageFurniture;
  /**
   * Which tracked revisions this pass resolves away (ECMA-376 §17.13).
   *
   * `all-markup` (the default) lays out both halves of every change. `proposed` lays out what
   * the document becomes if every change is accepted; `original` what it was before any of
   * them. Both are LAYOUT INPUTS: neither applies a `TreeDocOp` nor publishes a `ModelChange`,
   * so a user who switches to the proposed result, saves, and sends the file has not silently
   * accepted every proposal in it.
   */
  readonly displayMode?: RevisionDisplayMode;
  /** Reviewers whose revisions render as their accepted projection. */
  readonly revisionAuthorFilter?: RevisionAuthorFilter;
  /**
   * Per-section furniture, index-aligned with `enumerateDocumentSections`.
   *
   * When present, multi-section layout attaches each section's own headers/footers (after
   * OOXML inheritance). `furniture` remains the single-section / last-section fallback.
   */
  readonly sectionFurniture?: readonly (PageFurniture | undefined)[];
  /** Authored column count/gap for anchored `relativeFrom="column"` frame resolution. */
  readonly sectionColumns?: SectionColumns;
  /**
   * Styles-part cascade table (docDefaults + `w:style` last-wins). Absent keeps direct
   * formatting only — the pre-cascade behaviour, used by unit tests that never open a
   * package.
   */
  readonly styleCascade?: StyleCascadeTable;
  /**
   * Projection of `/word/numbering.xml`. Absent keeps pre-list behaviour (no markers /
   * level indents). The index is immutable for a session; list counter state is derived
   * per layout pass from document order.
   */
  readonly numberingIndex?: NumberingIndex;
  /**
   * Optional precomputed list items for the body story. When absent and
   * {@link numberingIndex} is set, layout walks the full body (including table cells)
   * once so counters continue across section boundaries and table document order.
   */
  readonly listItems?: ReadonlyMap<string, ResolvedListItem>;
  /**
   * `w:settings/w:defaultTabStop` in points (ECMA-376 §17.15.1.25); absent keeps the 0.5"
   * schema default.
   *
   * It arrives as an option because the paragraph cascade cannot see `settings.xml`. A
   * metric-locale template declares 1134 twips (2cm) and every default-interval tab in the
   * document belongs on that grid. Constant for a session — the settings part is immutable
   * here — which is why the prepared-block memo does not key on it.
   */
  readonly defaultTabStopPt?: number;
  /**
   * Turns a typed `w:hyperlink` into the SANITIZED record its spans carry.
   *
   * An option because resolving `r:id` needs the package's relationships, which layout — a
   * per-part walk — cannot see. Absent means link runs still measure, break and paint;
   * they simply carry no link, so nothing is clickable and no text is lost. That is the
   * degradation a headless test or a furniture-only pass gets, and it is the safe one.
   */
  readonly projectLink?: HyperlinkProjector;
  /**
   * Turns a parsed HYPERLINK field instruction into the SANITIZED record its result carries.
   *
   * An option for the same reason as {@link projectLink}: the raw target must cross the
   * surface's href trust boundary, which layout cannot see. Absent means the field's cached
   * result still measures, breaks and paints — it simply is not clickable.
   */
  readonly projectFieldLink?: FieldLinkProjector;
  /**
   * The document's parsed metadata, for document-property fields (TITLE, AUTHOR, …). Read once
   * by the surface and shared across body, table, note and header/footer flows.
   */
  readonly documentProperties?: DocumentProperties;
  /**
   * Footnote/endnote layout input. When present, body layout projects note marks and a
   * post-pass attaches note areas (with bounded reflow for pageBottom reservation).
   */
  readonly notes?: import('./note-pagination.ts').NotesLayoutInput;
  /**
   * Per-page bottom reserves (points) subtracted from content height before line placement,
   * keyed by DOCUMENT page index. A section's pass reads its own slice through
   * `pageIndexStart`. Produced by the note reflow loop; absent means full content column.
   */
  readonly pageBottomReserves?: ReadonlyMap<number, number>;
  /** Derived note marks for body/note projection (provisional or final). */
  readonly noteMarks?: import('./note-projection.ts').NoteMarkContext;
  /** Inline drawing projection for typed `w:drawing` / `wp:inline` nodes. */
  readonly inlineDrawingLayout?: InlineDrawingLayoutContext;
  /** Per-paragraph drawing projection/resource token for break cache keys. */
  readonly drawingTokenForParagraph?: (paragraph: OoxmlNode) => string;
  /** Per-paragraph identity for projected links and live document-property text. */
  readonly projectionTokenForParagraph?: (paragraph: OoxmlNode) => string;
  /** Memoized aggregate projection identity for an immutable table subtree. */
  readonly projectionTokenForTable?: (table: OoxmlNode) => string;
  /** @deprecated Prefer {@link drawingTokenForParagraph}. */
  readonly drawingLayoutToken?: string;
  /** Internal: reflow pass index while wrap exclusions converge. */
  readonly drawingExclusionPass?: number;
  /** Internal: converged exclusion zones — skips the reflow loop when set with zones. */
  readonly drawingExclusionConverged?: boolean;
  /** Internal: exclusion zones from the prior reflow pass, keyed by page index. */
  readonly drawingExclusionZonesByPage?: ReadonlyMap<number, readonly ExclusionZone[]>;
  /** Canonical drawing traversal order within the owner story part. */
  readonly drawingSourceOrder?: ReadonlyMap<string, number>;
  /**
   * Cross-paragraph TOC field begin/end paragraph ids. Empty chrome on these ids suppresses
   * the caret placeholder line in layout while the tree nodes stay intact for refresh/save.
   */
  readonly tocFieldChromeParagraphIds?: ReadonlySet<string>;
  /**
   * Begin-paragraph ids of empty TOCs. These keep one layout line so paint can host an
   * identifiable empty-TOC furniture placeholder (overrides chrome suppression).
   */
  readonly emptyTocPlaceholderParagraphIds?: ReadonlySet<string>;
  /**
   * Empty result-paragraph ids inside empty TOCs. Suppressed like field chrome so blank
   * cached rows do not stack under the empty placeholder.
   */
  readonly emptyTocSuppressedResultParagraphIds?: ReadonlySet<string>;
}
