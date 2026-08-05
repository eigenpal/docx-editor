// Tree-backed editing session (cutover step 2b).
//
// The replacement for `openDocxSession`'s `PackageModel` path. Same job — open bytes, hand
// out a ProseMirror projection, accept an edited doc, save — over the canonical tree
// instead of a semantic model plus a byte-range preservation snapshot.
//
// Most of what the legacy session exposes exists to express the SECOND model's limits:
// `readOnlyBlockIds`, `readOnlyRegions`, `structuralMutationAllowed` and the
// fully-captured-slice rule are all answers to "can this paragraph's original bytes be
// patched?". On the tree that question does not arise. A paragraph is editable because it
// is a paragraph; unknown content survives because it is in the tree; so those fields
// collapse to a single honest statement of what the part contains.

import type { Node as PMNode } from 'prosemirror-model';
import {
  linkRevisionReplies,
  paragraphOrderOfPart,
  reviewItemKey,
  reviewItemPositionRank,
  type ReviewCommentItem,
  type ReviewItem,
  type ReviewRevisionItem,
} from '../layout/review-support.ts';
import type { ReviewModuleContribution } from '../contracts/modules.ts';
import {
  addComment,
  setCommentResolved,
  commentPartNameOf,
  commentsExtendedPartNameOf,
} from '../store/store/comment-writes.ts';
import { deleteCommentThread } from '../store/package/comment-lifecycle.ts';
import {
  ORIGIN_IDS,
  TreePackageStore,
  readEmbeddedFonts,
  readOoxmlPackage,
  resolveHeaderFooterParts,
  resolveHeaderFooterPartsBySection,
  resolveHeaderFooterResolutionBySection,
  resolveRelationship,
  writeOoxmlPackage,
  ensureListDefinition,
  ensureNumberingLevel,
  ensureHyperlinkRelationship,
  buildBookmarkIndex,
  findNode,
  relationshipTargetIn,
  isHeaderFooterLifecycleOp,
  isNoteLifecycleOp,
  normalizeParagraphIdentity,
  paragraphTextOf,
  collectRevisionSites,
  type BookmarkIndex,
  type EmbeddedFont,
  type ListKind,
  type HeaderFooterParts,
  type HeaderFooterSectionResolution,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPackage,
  type OoxmlPackageRejection,
  type OoxmlPart,
  type SelectionMark,
  type StoryScope,
  type StoryTargetRejection,
  type TreeDocOp,
  type TreeModelChange,
} from '@docx-editor.dev/core/store';
import {
  collectDocumentFonts,
  collectDocumentStyles,
  type DocumentStyleEntry,
} from './document-catalog.ts';
import {
  collectDocumentOutline,
  paragraphStyleId,
  type DocumentOutlineEntry,
} from './document-outline.ts';
import {
  collectTextMatches,
  type DocumentSearchOptions,
  type DocumentSearchResult,
} from './document-search.ts';
import {
  collectDocumentThemeColors,
  collectDocumentThemeFonts,
  type DocumentThemeColorEntry,
  type DocumentThemeFonts,
} from './document-theme.ts';
import {
  createRunDefaultsResolver,
  type RunPropertyLike,
  type StyleRunDefaults,
} from './document-run-defaults.ts';
import {
  allParagraphs,
  bodyParagraphs,
  docToTreeOps,
  reconcileDoc,
  treeToDoc,
} from './tree-binding.ts';
import type { TreeBindingRejection } from './tree-binding.ts';
import { buildParagraphAnchorIndex, type ParagraphAnchorIndex } from './paragraph-anchors.ts';
import {
  readTrackingSettings,
  type DocumentTrackingSettings,
} from '../store/package/tracking-settings.ts';

export interface TreeApplyResult {
  readonly committed: boolean;
  readonly rejected: boolean;
  readonly opCount: number;
  /** Present when the edit was refused, so a host can report WHY rather than a silent no-op. */
  readonly reason?: TreeBindingRejection | StoryTargetRejection | string;
}

export interface TreeDocxSession {
  /** Whether the body holds at least one editable paragraph. */
  readonly editable: boolean;
  /** Canonical node ids of the body paragraphs, in order. */
  paragraphIds(): string[];
  /**
   * Canonical node ids of paragraphs in a story scope. Defaults to the body.
   * Header/footer scopes address the part `EditorScope { kind: 'headerFooter'; rId }` names.
   */
  paragraphIdsIn(scope?: StoryScope): string[];
  /** The current canonical BODY part — what layout reads for the main story. */
  part(): OoxmlPart;
  /** The current part for a story scope, or null when the target is refused. */
  partFor(scope: StoryScope): OoxmlPart | null;
  /**
   * The current package with every opened story store merged in. Authority for layout
   * resolution and save — never a swapped single-part view.
   */
  currentPackage(): OoxmlPackage;
  /**
   * Commit typed tree ops directly, as ONE transaction.
   *
   * The paginated surface has no ProseMirror doc to diff, so it addresses the model the way
   * the ops already do — by node id and offset — rather than round-tripping an edit through
   * a projection just to have it diffed back out.
   *
   * `scope` defaults to the body. Pass `{ kind: 'headerFooter', rId }` to target an existing
   * header/footer part; the transaction publishes one ModelChange (HF → `global` impact)
   * and one undo unit without swapping the body store.
   */
  applyTreeOps(
    ops: readonly TreeDocOp[],
    selectionBefore?: SelectionMark | null,
    selectionAfter?: SelectionMark | null,
    scope?: StoryScope
  ): TreeApplyResult;
  /** Project the current BODY revision into a ProseMirror doc. */
  projectDoc(): PMNode;
  /** Re-project incrementally from the last committed change, reusing untouched paragraphs. */
  reconcile(previousDoc: PMNode): PMNode;
  /**
   * Whether the last commit changed the BLOCK SEQUENCE (a split, join, insert or delete).
   *
   * A host needs this to decide whether the view must be re-projected at all: after a pure
   * text edit the view already holds what the model holds, and re-projecting anyway both
   * wastes work and races the next keystroke.
   */
  lastCommitWasStructural(): boolean;
  /** Map an edited BODY doc to tree ops and commit them as ONE transaction. */
  applyPmDoc(doc: PMNode): TreeApplyResult;
  /** Body text, paragraphs joined by newlines, read from the CANONICAL tree. */
  bodyText(): string;
  /** Text of a story scope, paragraphs joined by newlines. */
  storyText(scope: StoryScope): string | null;
  /** Body-store revision (independent of header/footer store revisions). */
  revision(): number;
  /** Per-story revision, or null when the target is refused. */
  revisionFor(scope: StoryScope): number | null;
  /** Package-wide revision — bumps on any story commit (body or HF). */
  packageRevision(): number;
  canUndo(): boolean;
  canRedo(): boolean;
  /**
   * Undo the last entry, returning the selection to restore.
   *
   * The selection is part of the entry, not something a host can recompute: after undoing a
   * split the caret belongs where the user was typing, and offsets in the reverted tree do
   * not correspond to offsets in the one that replaced it. `null` means nothing was undone
   * or the entry recorded no selection.
   */
  undo(): SelectionMark | null;
  redo(): SelectionMark | null;
  beginComposition(scope?: StoryScope): void;
  endComposition(): void;
  subscribe(onChange: (change: TreeModelChange) => void): () => void;
  /** Serialize the whole package back to DOCX bytes. */
  save(): Uint8Array;
  /**
   * The resolved header/footer parts of the section, by variant (phase 2).
   *
   * Returns the FINAL section's effective parts after OOXML inheritance. Prefer
   * `headerFooterPartsBySection` for multi-section pagination.
   *
   * Re-resolved after any package revision so an edited shared part is visible everywhere
   * it is attached.
   */
  headerFooterParts(): HeaderFooterParts;
  /**
   * Per-section header/footer parts after OOXML inheritance, index-aligned with
   * `enumerateDocumentSections`.
   */
  headerFooterPartsBySection(): readonly HeaderFooterParts[];
  /**
   * Per-section resolution with declared-vs-inherited metadata for "Same as previous"
   * chrome. Index-aligned with `headerFooterPartsBySection`.
   */
  headerFooterResolutionBySection(): readonly HeaderFooterSectionResolution[];
  /**
   * Font family names the document uses, from every `w:rFonts` in the CURRENT main
   * part plus the styles and header/footer parts — validated, deduplicated, sorted.
   * Memoized per package revision.
   */
  documentFonts(): readonly string[];
  /**
   * The `w:style` definitions of the styles part, validated and projected for a style
   * picker. Memoized once: the styles part is immutable for the session's lifetime.
   * A document without a styles part answers `[]`.
   */
  documentStyles(): readonly DocumentStyleEntry[];
  /**
   * Root of the styles part tree, for layout's style cascade. Memoized once; `null` when
   * the package has no styles part. Styles editing is a later slice, so this is immutable
   * for the session.
   */
  stylesRoot(): OoxmlElement | null;
  /**
   * The theme part's Latin typefaces, for resolving `w:rFonts` theme references in layout.
   *
   * Memoized once: theme editing is a later slice. A document with no theme part answers
   * `{ major: null, minor: null }`, which leaves every theme reference on the explicit
   * font name beside it.
   */
  documentThemeFonts(): DocumentThemeFonts;
  /**
   * Root of the numbering part tree (`w:numbering`), for list layout. Memoized once;
   * `null` when the package has no numbering part. Numbering editing is a later slice.
   */
  numberingRoot(): OoxmlElement | null;
  /**
   * Root of the settings part tree (`w:settings`), for document-wide layout constants such
   * as `w:defaultTabStop`. Memoized once; `null` when the package has no settings part.
   * Settings editing is a later slice, so this is immutable for the session.
   */
  settingsRoot(): OoxmlElement | null;
  /**
   * What `settings.xml` says about tracking — `w:trackRevisions`, the tracked-changes
   * protection, and the two do-not-track switches.
   *
   * Read from the document rather than assumed, because Word records the tracking state on
   * the FILE: a package that asks to be edited as tracked changes, presented as an ordinary
   * editable one, takes its first keystroke as an untracked edit.
   */
  trackingSettings(): DocumentTrackingSettings;
  /**
   * The theme's ten picker colours (`a:clrScheme`), in Word's column order, or `[]`
   * when the package has no complete scheme. Memoized once: the theme part is
   * immutable for the session's lifetime.
   */
  documentThemeColors(): readonly DocumentThemeColorEntry[];
  /**
   * The run formatting a paragraph's content INHERITS when it authors none: the
   * paragraph style's `basedOn` chain, then `w:docDefaults`, with theme `rFonts`
   * attributes resolved through the font scheme. `runProperties` (the span's own
   * authored properties) lets a theme-only run-level `w:rFonts` resolve too. This is
   * what lets a toolbar always show the effective font, the way Word does.
   */
  effectiveRunDefaults(
    paragraphId: string,
    runProperties?: readonly RunPropertyLike[]
  ): StyleRunDefaults;
  /**
   * The heading outline of the BODY story, in document order: paragraphs whose
   * `w:pStyle` resolves to a heading through the styles part (built-in `heading N`
   * name, or the style's own `w:outlineLvl` 0..8). Memoized per main-part revision —
   * an edit can retitle, add or remove a heading, but the styles part cannot change
   * in-session.
   */
  documentOutline(): readonly DocumentOutlineEntry[];

  /**
   * Every pending review decision in the document, memoized per revision.
   *
   * Derived from the canonical TREE — the queue is a property of the document, and one derived
   * from laid-out spans empties by half whenever the reader switches to a resolved view.
   */
  reviewItems(): readonly ReviewItem[];

  /**
   * Whether the document carries review content — tracked changes or comment
   * anchors — regardless of any review module. Derived from store vocabulary
   * only (never the review model), memoized per revision: it is the free
   * tier's honest "this document has more than you are seeing" signal.
   */
  hasReviewContent(): boolean;

  /** Reply to a comment, or add one over a revision's range. Returns the new comment's id. */
  replyToComment(
    parentCommentId: string | null,
    anchor: { paragraphId: string; start: number; end: number; endParagraphId?: string },
    text: string,
    author: string,
    /** ISO-8601. Omitted writes no `@w:date`, because inventing one is a content change. */
    date?: string
  ): string | null;
  /**
   * Resolve a comment thread, or reopen it. False when the document holds no such comment.
   *
   * The same package transaction shape as a reply, and for the same reason: `@w15:done` lives in
   * `commentsExtended.xml`, a part a document with no thread does not have, so the state and the
   * part that records it commit together.
   */
  setCommentResolved(commentId: string, resolved: boolean): boolean;
  /**
   * Delete a comment thread outright — body, thread state and story markers.
   *
   * A THREAD, like resolving one: a reply whose parent is gone has nothing left to answer.
   * False when the document holds no such comment, or when the removal was refused.
   */
  deleteComment(commentId: string): boolean;
  /**
   * Every occurrence of `query` in the BODY story, in document order, addressed in the
   * same offset vocabulary the tree ops and the surface selection use — so a match can be
   * handed straight to `setSelection` without re-deriving anything.
   *
   * Memoized one deep, keyed on the revision AND the question asked: a find panel asks the
   * same question on every tick, and a different query replaces the entry rather than
   * growing a cache the session would have to bound.
   */
  findText(query: string, options?: DocumentSearchOptions): DocumentSearchResult;
  /**
   * The faces the package EMBEDS (`word/fontTable.xml` embed relationships),
   * deobfuscated — the only font source that needs neither a substitute nor a network.
   * Extraction asserts nothing about validity; admitting a face is the font resource
   * lane's job. Memoized once: the font table and font parts are immutable in-session.
   */
  embeddedFonts(): readonly EmbeddedFont[];
  /**
   * The `w:numId` of a bullet or numbered list definition, creating one where the document
   * has none — including `numbering.xml` itself, its relationship and its content type.
   *
   * A document Word has never numbered carries no numbering part at all, so the first
   * bullet a user asks for has to bring the whole definition with it. An existing
   * definition of the same kind is reused rather than duplicated.
   */
  /**
   * What the owning part's relationships answer for one `r:id` under `scope` (default:
   * body): the authored target and whether it is external. `null` for an id the part does
   * not declare, or when the scoped part is not open.
   *
   * Live rather than memoized: inserting a link mints a relationship mid-session, and a
   * cached resolver would report the link this session just created as dangling.
   */
  relationshipTarget(
    relationshipId: string,
    scope?: StoryScope
  ): { readonly target: string; readonly external: boolean } | null;
  /**
   * `bookmarkName -> { paragraphId, offset }` over the main part, memoized per revision.
   *
   * What an internal hyperlink's `w:anchor` resolves through. Keyed on the store revision
   * because an edit can move, split or delete the paragraph a bookmark sits in.
   */
  bookmarks(): BookmarkIndex;
  /**
   * The relationship id for an external hyperlink target on the part owning `scope`
   * (default: body), minting one if that part has none, or `null` when the URL is refused
   * or the scoped part cannot be resolved.
   *
   * Lives on the PACKAGE, outside `store.transact`, like the numbering definitions: the
   * undoable half is the tree op that names the id. An unreferenced relationship left
   * behind by an undo is inert and is what Word writes anyway. Scoped inserts mint onto
   * the story's own `.rels` so a header/footer or note link never creates a stray body
   * relationship.
   */
  ensureHyperlinkRelationship(url: string, scope?: StoryScope): string | null;
  ensureListDefinition(kind: ListKind): string | null;
  /**
   * Declare `level` in the list definition `numId` names, with Word's default format for
   * that depth, or answer false.
   *
   * Word never greys Increase Indent out on a list item: demoting past the deepest level
   * a definition declares makes Word define the level, cycling its stock bullets and
   * number formats. An already-declared level answers true without changing anything.
   *
   * The declaration lives on the PACKAGE, outside the store's history — undoing the edit
   * that needed it restores the paragraph but leaves the level declared, which is
   * harmless: an unreferenced level renders nothing and Word writes files full of them.
   */
  ensureNumberingLevel(numId: string, level: number, kind: ListKind): boolean;
  /**
   * The `w14:paraId` ↔ node-id index over the full editable set of the MAIN part,
   * memoized per revision. Every editable paragraph carries a valid, part-unique id
   * (established at open, maintained by the split appliers), so every paragraph is
   * mapped. Header/footer paragraphs become addressable through `partFor` once their
   * story store is open.
   */
  paragraphAnchors(): ParagraphAnchorIndex;
  /** `w14:paraId` of a canonical paragraph node id, verbatim, or null. */
  paraIdOf(nodeId: string): string | null;
  /** Canonical node id for a `w14:paraId`, matched case-insensitively, or null. */
  nodeIdOf(paraId: string): string | null;

  /** Insert a validated raster image as one package undo unit (task 12). */
  insertImage(
    scope: StoryScope,
    input: import('../store/store/tree-package-images.ts').InsertImageInput
  ): Promise<import('../store/store/tree-package-images.ts').ImageIntentResult>;

  /** Replace a picture drawing's embedded media in one package undo unit. */
  replaceImage(
    scope: StoryScope,
    drawingNodeId: string,
    bytes: Uint8Array,
    mime: import('../store/package/image-resources.ts').SupportedImageMime,
    decodePort: import('../store/package/image-resources.ts').ImageDecodePort,
    options: import('../store/store/tree-package-images.ts').ReplaceImageOptions
  ): Promise<import('../store/store/tree-package-images.ts').ImageIntentResult>;

  /** Delete a picture drawing and collect orphaned media in one package undo unit. */
  deleteImage(
    scope: StoryScope,
    drawingNodeId: string
  ): import('../store/store/tree-package-images.ts').ImageIntentResult;

  /** Apply image property tree ops plus hyperlink relationship wiring atomically. */
  applyImageProperties(
    scope: StoryScope,
    input: import('../store/store/tree-package-images.ts').ApplyImagePropertiesInput
  ): import('../store/store/tree-package-images.ts').ImageIntentResult;
}

export type { DocumentStyleEntry } from './document-catalog.ts';
export type { DocumentThemeColorEntry, ThemeColorSlot } from './document-theme.ts';
export type { DocumentOutlineEntry } from './document-outline.ts';
export type { ParagraphAnchorIndex } from './paragraph-anchors.ts';
export type { StoryScope, StoryTargetRejection } from '@docx-editor.dev/core/store';

export type TreeSessionRejection = OoxmlPackageRejection | 'no-main-document-tree';

export type OpenTreeSessionResult =
  | { readonly ok: true; readonly session: TreeDocxSession }
  | { readonly ok: false; readonly reason: TreeSessionRejection; readonly detail?: string };

/**
 * Open DOCX bytes into a tree-backed session.
 *
 * Returns a typed rejection rather than throwing: every failure here is a property of the
 * FILE, and a host needs to tell "this is not a package" from "this package is malicious"
 * from "this document has no body".
 */
/** One frozen empty queue, so a module-less `reviewItems()` is reference-stable. */
const EMPTY_REVIEW_ITEMS: readonly ReviewItem[] = Object.freeze([]);

export interface OpenTreeSessionOptions {
  /**
   * The review module's derivation hooks, contributed through the editor's
   * `EditorModule` seam. Absent — the free engine — the session's
   * `reviewItems()` reports the typed empty queue; parse, preservation, and
   * `hasReviewContent` are unaffected.
   */
  readonly reviewModel?: ReviewModuleContribution;
}

export function openTreeSession(
  bytes: Uint8Array,
  options: OpenTreeSessionOptions = {}
): OpenTreeSessionResult {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) {
    return {
      ok: false,
      reason: loaded.reason,
      ...(loaded.detail ? { detail: loaded.detail } : {}),
    };
  }

  const pkgLoaded: OoxmlPackage = loaded.package;
  const main = pkgLoaded.parts.get(pkgLoaded.mainDocumentPart);
  if (!main)
    return { ok: false, reason: 'no-main-document-tree', detail: pkgLoaded.mainDocumentPart };

  // Paragraph identity is established once, here — every paragraph the session edits
  // carries a valid, part-unique `w14:paraId` from the first revision on, so the op
  // layer can seed split-tail mints and the contract can address by paraId. A document
  // already carrying valid ids normalizes to the SAME part reference (byte-stable save).
  const normalized = normalizeParagraphIdentity(main);
  const packageStore = new TreePackageStore(pkgLoaded, normalized);

  let headerFooterBySection: {
    readonly packageRevision: number;
    readonly parts: readonly HeaderFooterParts[];
    readonly resolution: readonly HeaderFooterSectionResolution[];
  } | null = null;
  /** Memoized per package/body revision: the queue only changes when the document does. */
  let reviewCache: {
    revisionKey: string;
    bodyRevision: number;
    /** Package revision when this queue was last fully derived or patched. */
    packageRevision: number;
    items: readonly ReviewItem[];
    paragraphOrder: ReadonlyMap<string, number>;
    commentsPart: OoxmlPart | undefined;
    commentsExtendedPart: OoxmlPart | undefined;
  } | null = null;
  /** Memoized per body revision, like `reviewCache` — see `hasReviewContent`. */
  let reviewContentCache: { revision: number; present: boolean } | null = null;
  let lastChange: TreeModelChange | null = null;
  packageStore.subscribe((change) => {
    lastChange = change;
  });

  const bodyStore = () => packageStore.bodyStore();
  const currentPackage = (): OoxmlPackage => packageStore.currentPackage();
  const BODY_SCOPE: StoryScope = Object.freeze({ kind: 'body' as const });

  const resolvedHeaderFooterBySection = (): {
    readonly parts: readonly HeaderFooterParts[];
    readonly resolution: readonly HeaderFooterSectionResolution[];
  } => {
    if (
      !headerFooterBySection ||
      headerFooterBySection.packageRevision !== packageStore.packageRevision
    ) {
      const resolution = resolveHeaderFooterResolutionBySection(currentPackage());
      headerFooterBySection = {
        packageRevision: packageStore.packageRevision,
        resolution,
        parts: resolveHeaderFooterPartsBySection(currentPackage()),
      };
    }
    return headerFooterBySection;
  };

  // The styles / numbering parts, resolved once through the main part's relationships
  // (the same resolution discipline `resolveHeaderFooterParts` uses), with conventional
  // part names as fallbacks. Both are immutable in-session (editing is a later slice).
  const STYLES_REL_TYPE =
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
  const NUMBERING_REL_TYPE =
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';
  let stylesRootResolved = false;
  let stylesRoot: OoxmlElement | null = null;
  const resolveStylesRoot = (): OoxmlElement | null => {
    if (stylesRootResolved) return stylesRoot;
    stylesRootResolved = true;
    const live = currentPackage();
    const record = (live.relationships.get(live.mainDocumentPart) ?? []).find(
      (rel) => rel.type === STYLES_REL_TYPE
    );
    let part: OoxmlPart | undefined;
    if (record) {
      const resolved = resolveRelationship(record);
      if (resolved.mode === 'Internal' && resolved.target.ok) {
        part = live.parts.get(resolved.target.partName);
      }
    }
    part ??= live.parts.get('/word/styles.xml');
    stylesRoot = part?.root ?? null;
    return stylesRoot;
  };

  let numberingRootResolved = false;
  let numberingRoot: OoxmlElement | null = null;
  const resolveNumberingRoot = (): OoxmlElement | null => {
    if (numberingRootResolved) return numberingRoot;
    numberingRootResolved = true;
    const live = currentPackage();
    const record = (live.relationships.get(live.mainDocumentPart) ?? []).find(
      (rel) => rel.type === NUMBERING_REL_TYPE
    );
    let part: OoxmlPart | undefined;
    if (record) {
      const resolved = resolveRelationship(record);
      if (resolved.mode === 'Internal' && resolved.target.ok) {
        part = live.parts.get(resolved.target.partName);
      }
    }
    part ??= live.parts.get('/word/numbering.xml');
    numberingRoot = part?.root ?? null;
    return numberingRoot;
  };

  // The settings part, resolved like the styles part. Word writes document-wide layout
  // constants here — `w:defaultTabStop` among them — that no paragraph property chain can
  // see, so layout has to be handed them separately.
  const SETTINGS_REL_TYPE =
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings';
  let settingsRootRevision = -1;
  let settingsRoot: OoxmlElement | null = null;
  const resolveSettingsRoot = (): OoxmlElement | null => {
    if (settingsRootRevision === packageStore.packageRevision) return settingsRoot;
    settingsRootRevision = packageStore.packageRevision;
    const live = currentPackage();
    const record = (live.relationships.get(live.mainDocumentPart) ?? []).find(
      (rel) => rel.type === SETTINGS_REL_TYPE
    );
    let part: OoxmlPart | undefined;
    if (record) {
      const resolved = resolveRelationship(record);
      if (resolved.mode === 'Internal' && resolved.target.ok) {
        part = live.parts.get(resolved.target.partName);
      }
    }
    part ??= live.parts.get('/word/settings.xml');
    settingsRoot = part?.root ?? null;
    return settingsRoot;
  };

  // The theme part, resolved like the styles part: through the main part's `theme`
  // relationship, with the conventional name as a fallback. Immutable in-session.
  const THEME_REL_TYPE =
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme';
  let themeRootResolved = false;
  let themeRoot: OoxmlElement | null = null;
  const resolveThemeRoot = (): OoxmlElement | null => {
    if (themeRootResolved) return themeRoot;
    themeRootResolved = true;
    const live = currentPackage();
    const record = (live.relationships.get(live.mainDocumentPart) ?? []).find(
      (rel) => rel.type === THEME_REL_TYPE
    );
    let part: OoxmlPart | undefined;
    if (record) {
      const resolved = resolveRelationship(record);
      if (resolved.mode === 'Internal' && resolved.target.ok) {
        part = live.parts.get(resolved.target.partName);
      }
    }
    part ??= live.parts.get('/word/theme/theme1.xml');
    themeRoot = part?.root ?? null;
    return themeRoot;
  };

  // The font table part, resolved once through the main part's `fontTable` relationship
  // (same discipline as the styles part), with the conventional name as fallback. The
  // table and the font parts it points at are immutable in-session, so the extraction —
  // which COPIES every deobfuscated part — runs at most once per session.
  const FONT_TABLE_REL_TYPE =
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable';
  let embeddedFontsCache: readonly EmbeddedFont[] | null = null;
  const resolveEmbeddedFonts = (): readonly EmbeddedFont[] => {
    if (embeddedFontsCache) return embeddedFontsCache;
    const live = currentPackage();
    const record = (live.relationships.get(live.mainDocumentPart) ?? []).find(
      (rel) => rel.type === FONT_TABLE_REL_TYPE
    );
    let part: OoxmlPart | undefined;
    if (record) {
      const resolved = resolveRelationship(record);
      if (resolved.mode === 'Internal' && resolved.target.ok) {
        part = live.parts.get(resolved.target.partName);
      }
    }
    part ??= live.parts.get('/word/fontTable.xml');
    embeddedFontsCache = Object.freeze(readEmbeddedFonts(live, part));
    return embeddedFontsCache;
  };

  let fontsCache: { readonly revision: number; readonly fonts: readonly string[] } | null = null;
  let stylesCache: readonly DocumentStyleEntry[] | null = null;
  let themeColorsCache: readonly DocumentThemeColorEntry[] | null = null;
  let themeFontsCache: DocumentThemeFonts | null = null;
  let runDefaultsResolver:
    | ((styleId: string | null, runProperties?: readonly RunPropertyLike[]) => StyleRunDefaults)
    | null = null;
  // Paragraph -> pStyle, per revision: an edit can change a paragraph's style, but the
  // styles and theme parts cannot change in-session.
  let pStyleCache: { readonly revision: number; readonly byId: Map<string, string | null> } | null =
    null;
  let outlineCache: {
    readonly revision: number;
    readonly outline: readonly DocumentOutlineEntry[];
  } | null = null;
  // Last search answered, keyed on the revision AND the exact question. A find panel asks
  // the same question repeatedly — a re-render, a tick, a next/previous press — and one
  // entry is enough to make those free; a different query simply replaces it.
  let searchCache: {
    readonly revision: number;
    readonly key: string;
    readonly result: DocumentSearchResult;
  } | null = null;
  let anchorsCache: {
    readonly revision: number;
    readonly index: ParagraphAnchorIndex;
  } | null = null;
  let bookmarksCache: { readonly revision: number; readonly index: BookmarkIndex } | null = null;
  const paragraphAnchors = (): ParagraphAnchorIndex => {
    // Keyed on the body-store revision, like the outline: a split mints a new paragraph and
    // a join removes one, but between commits the map cannot move.
    const store = bodyStore();
    if (!anchorsCache || anchorsCache.revision !== store.revision) {
      anchorsCache = { revision: store.revision, index: buildParagraphAnchorIndex(store.part) };
    }
    return anchorsCache.index;
  };

  return {
    ok: true,
    session: {
      // A document with paragraphs — body-level OR inside table cells — is editable. There
      // is no per-block gate, because the conditions the legacy gate tested — captured
      // source range, fully-captured slice, projectable runs — are all properties of the
      // byte-range model, not of the document.
      editable: allParagraphs(bodyStore().part).length > 0,

      // The full editable set, cell paragraphs included: selection clamping, Enter's
      // minted-tail diff and select-all in the paginated surface address these by node id.
      paragraphIds: () => allParagraphs(bodyStore().part).map((paragraph) => paragraph.id),

      paragraphIdsIn(scope = BODY_SCOPE) {
        const part = packageStore.partFor(scope);
        if (!part) return [];
        return allParagraphs(part).map((paragraph) => paragraph.id);
      },

      part: () => bodyStore().part,

      partFor: (scope) => packageStore.partFor(scope),

      currentPackage,

      applyTreeOps(ops, selectionBefore, selectionAfter, scope = BODY_SCOPE) {
        if (ops.length === 0) return { committed: false, rejected: false, opCount: 0 };
        const lifecycleCount = ops.filter(
          (op) => isHeaderFooterLifecycleOp(op) || isNoteLifecycleOp(op)
        ).length;
        if (lifecycleCount > 0) {
          // Lifecycle ops are package-level transactions; refuse mixing with story ops or
          // batching multiple lifecycle ops into one call (each is its own ModelChange).
          if (lifecycleCount !== ops.length || ops.length !== 1) {
            return {
              committed: false,
              rejected: true,
              opCount: ops.length,
              reason: 'invalidArgs',
            };
          }
          const result = packageStore.applyLifecycleOp(ops[0]!);
          if (!result.ok) {
            return {
              committed: false,
              rejected: true,
              opCount: 1,
              // Prefer the lifecycle detail (`first-section`, `not-declared`, …) so Editor
              // gates can surface engine reasons rather than a bare `invalidArgs`.
              reason: result.detail ?? result.reason,
            };
          }
          return { committed: true, rejected: false, opCount: 1 };
        }
        const result = packageStore.transact(scope, (ctx) => {
          // Recorded BEFORE the ops run, so undo restores where the caret was when the user
          // made the edit rather than where it ended up afterwards.
          if (selectionBefore !== undefined) ctx.selectionBefore(selectionBefore);
          // And where it ends up, so REDO has somewhere to put it. No caller supplied this,
          // so `selectionForRedo` was always null and redo left the caret addressing the
          // tree the undo had discarded — offsets past the end of a paragraph it re-shortened.
          if (selectionAfter !== undefined) ctx.selectionAfter(selectionAfter);
          for (const op of ops) ctx.apply(op);
        });
        if (!result.ok) {
          return { committed: false, rejected: true, opCount: ops.length, reason: result.reason };
        }
        return { committed: true, rejected: false, opCount: ops.length };
      },

      projectDoc: () => treeToDoc(bodyStore().part),

      reconcile: (previousDoc) => reconcileDoc(previousDoc, bodyStore().part, lastChange),

      lastCommitWasStructural: () =>
        lastChange !== null &&
        (lastChange.created.length > 0 ||
          lastChange.deleted.length > 0 ||
          lastChange.splitJoin.length > 0 ||
          lastChange.impact === 'global'),

      applyPmDoc(doc) {
        const store = bodyStore();
        const mapped = docToTreeOps(store.part, doc);
        if (!mapped.ok) {
          return { committed: false, rejected: true, opCount: 0, reason: mapped.reason };
        }
        if (mapped.ops.length === 0) return { committed: false, rejected: false, opCount: 0 };
        const result = packageStore.transact(BODY_SCOPE, (ctx) => {
          for (const op of mapped.ops) ctx.apply(op);
        });
        if (!result.ok) {
          return {
            committed: false,
            rejected: true,
            opCount: mapped.ops.length,
            reason: result.reason,
          };
        }
        return { committed: true, rejected: false, opCount: mapped.ops.length };
      },

      bodyText: () => projectedText(bodyStore().part),

      storyText(scope) {
        const part = packageStore.partFor(scope);
        if (!part) return null;
        return allParagraphs(part)
          .map((paragraph) => paragraphTextOf(part, paragraph.id) ?? '')
          .join('\n');
      },

      revision: () => bodyStore().revision,
      revisionFor: (scope) => packageStore.revisionFor(scope),
      packageRevision: () => packageStore.packageRevision,
      canUndo: () => packageStore.canUndo,
      canRedo: () => packageStore.canRedo,
      undo: () => {
        const selection = packageStore.selectionForUndo();
        return packageStore.undo() === null ? null : selection;
      },
      redo: () => {
        const selection = packageStore.selectionForRedo();
        return packageStore.redo() === null ? null : selection;
      },
      beginComposition: (scope = BODY_SCOPE) => {
        packageStore.beginComposition(scope);
      },
      endComposition: () => packageStore.endComposition(),

      subscribe(onChange) {
        return packageStore.subscribe(onChange);
      },

      save() {
        return writeOoxmlPackage(currentPackage());
      },

      headerFooterParts: () => {
        const bySection = resolvedHeaderFooterBySection().parts;
        return bySection[bySection.length - 1] ?? resolveHeaderFooterParts(currentPackage());
      },
      headerFooterPartsBySection: () => resolvedHeaderFooterBySection().parts,
      headerFooterResolutionBySection: () => resolvedHeaderFooterBySection().resolution,

      documentFonts() {
        // Keyed on the package revision: body or header/footer edits can add or remove a
        // run-level `w:rFonts`.
        if (fontsCache && fontsCache.revision === packageStore.packageRevision) {
          return fontsCache.fonts;
        }
        const bySection = resolvedHeaderFooterBySection().parts;
        const roots: OoxmlElement[] = [bodyStore().part.root];
        const styles = resolveStylesRoot();
        if (styles) roots.push(styles);
        const seen = new Set<OoxmlPart>();
        for (const section of bySection) {
          for (const part of section.headers.values()) {
            if (seen.has(part)) continue;
            seen.add(part);
            roots.push(part.root);
          }
          for (const part of section.footers.values()) {
            if (seen.has(part)) continue;
            seen.add(part);
            roots.push(part.root);
          }
        }
        fontsCache = {
          revision: packageStore.packageRevision,
          fonts: collectDocumentFonts(roots, collectDocumentThemeFonts(resolveThemeRoot())),
        };
        return fontsCache.fonts;
      },

      documentStyles() {
        // Font and size for each style's PREVIEW come from the run-defaults resolver, which
        // already owns the basedOn chain, `docDefaults` and the theme font scheme — a
        // picker showing every row in the UI font is the thing this avoids.
        runDefaultsResolver ??= createRunDefaultsResolver(
          resolveStylesRoot(),
          collectDocumentThemeFonts(resolveThemeRoot())
        );
        const resolve = runDefaultsResolver;
        stylesCache ??= collectDocumentStyles(resolveStylesRoot(), (styleId) => resolve(styleId));
        return stylesCache;
      },

      stylesRoot: () => resolveStylesRoot(),

      documentThemeFonts() {
        themeFontsCache ??= collectDocumentThemeFonts(resolveThemeRoot());
        return themeFontsCache;
      },

      numberingRoot: () => resolveNumberingRoot(),

      settingsRoot: () => resolveSettingsRoot(),
      trackingSettings: () => readTrackingSettings(resolveSettingsRoot()),

      documentThemeColors() {
        themeColorsCache ??= collectDocumentThemeColors(resolveThemeRoot());
        return themeColorsCache;
      },

      effectiveRunDefaults(paragraphId, runProperties) {
        runDefaultsResolver ??= createRunDefaultsResolver(
          resolveStylesRoot(),
          collectDocumentThemeFonts(resolveThemeRoot())
        );
        const store = bodyStore();
        if (!pStyleCache || pStyleCache.revision !== store.revision) {
          const byId = new Map<string, string | null>();
          for (const paragraph of allParagraphs(store.part)) {
            // `allParagraphs` collects paragraph ELEMENTS but is typed OoxmlNode.
            if (paragraph.kind === 'textValue') continue;
            byId.set(paragraph.id, paragraphStyleId(paragraph) ?? null);
          }
          pStyleCache = { revision: store.revision, byId };
        }
        return runDefaultsResolver(pStyleCache.byId.get(paragraphId) ?? null, runProperties);
      },

      documentOutline() {
        // Keyed on the body-store revision, like the fonts: typing inside a heading or
        // splitting one changes the outline, but the styles part is immutable.
        const store = bodyStore();
        if (outlineCache && outlineCache.revision === store.revision) return outlineCache.outline;
        outlineCache = {
          revision: store.revision,
          outline: collectDocumentOutline(store.part, resolveStylesRoot()),
        };
        return outlineCache.outline;
      },

      findText(query, options) {
        const store = bodyStore();
        const key = `${options?.matchCase === true ? 'c' : ''}${
          options?.wholeWord === true ? 'w' : ''
        }${options?.limit ?? ''}${'\u0000'}${query}`;
        if (searchCache && searchCache.revision === store.revision && searchCache.key === key) {
          return searchCache.result;
        }
        const result = collectTextMatches(store.part, query, options ?? {});
        searchCache = { revision: store.revision, key, result };
        return result;
      },

      embeddedFonts: resolveEmbeddedFonts,

      paragraphAnchors,

      paraIdOf: (nodeId) => paragraphAnchors().paraIdByNode.get(nodeId) ?? null,

      nodeIdOf: (paraId) => paragraphAnchors().nodeByParaId.get(paraId.toUpperCase()) ?? null,

      relationshipTarget: (relationshipId, scope = BODY_SCOPE) => {
        const live = currentPackage();
        const part = packageStore.partFor(scope);
        if (!part) return null;
        return relationshipTargetIn(live, part.name, relationshipId);
      },

      bookmarks: () => {
        const store = bodyStore();
        if (!bookmarksCache || bookmarksCache.revision !== store.revision) {
          bookmarksCache = { revision: store.revision, index: buildBookmarkIndex(store.part) };
        }
        return bookmarksCache.index;
      },

      ensureHyperlinkRelationship(url, scope = BODY_SCOPE) {
        // Package write, not a tree op: the story undo unit names the rId, while the
        // relationship itself is session-persistent across lifecycle package snapshots
        // (see `mergePersistentPackageShell`). Leftover rels are harmless; missing ones are not.
        // `currentPackage()` mints a fresh object per call, so the identity check compares
        // against the SAME instance the write was given.
        const part = packageStore.partFor(scope);
        if (!part) return null;
        const before = currentPackage();
        const ensured = ensureHyperlinkRelationship(before, url, part.name);
        if (!ensured) return null;
        if (ensured.pkg !== before) packageStore.replacePackageShell(ensured.pkg);
        return ensured.relationshipId;
      },

      reviewItems() {
        const derive = options.reviewModel;
        if (!derive) return EMPTY_REVIEW_ITEMS;
        const store = bodyStore();
        const revisionKey = `${packageStore.packageRevision}:${store.revision}`;
        if (reviewCache && reviewCache.revisionKey === revisionKey) {
          return reviewCache.items;
        }

        const pkg = currentPackage();
        const commentsPart = pkg.parts.get(commentPartNameOf(pkg, store.part.name));
        const commentsExtendedPart = pkg.parts.get(
          commentsExtendedPartNameOf(pkg, store.part.name)
        );
        const furnitureParts: OoxmlPart[] = [];
        const seenFurniture = new Set<OoxmlPart>();
        for (const section of resolvedHeaderFooterBySection().parts) {
          for (const slots of [section.headers, section.footers]) {
            for (const part of slots.values()) {
              if (seenFurniture.has(part)) continue;
              seenFurniture.add(part);
              furnitureParts.push(part);
            }
          }
        }

        const patchParagraphId =
          reviewCache && lastChange
            ? localReviewPatchParagraphId(
                lastChange,
                reviewCache,
                reviewCache.items,
                store.part,
                commentsPart,
                commentsExtendedPart,
                packageStore.packageRevision
              )
            : null;

        let items: readonly ReviewItem[];
        let paragraphOrder: ReadonlyMap<string, number>;
        if (patchParagraphId && reviewCache) {
          const localRevisions = derive.revisionItemsOfParagraph(store.part, patchParagraphId);
          if (canApplyLocalReviewPatch(reviewCache.items, localRevisions, patchParagraphId)) {
            items = patchLocalReviewItems(
              reviewCache.items,
              reviewCache.paragraphOrder,
              patchParagraphId,
              localRevisions
            );
            paragraphOrder = reviewCache.paragraphOrder;
          } else {
            paragraphOrder = paragraphOrderOfPart(store.part);
            items = derive.collectReviewItems({
              storyPart: store.part,
              furnitureParts,
              commentsPart,
              commentsExtendedPart,
            });
          }
        } else {
          paragraphOrder = paragraphOrderOfPart(store.part);
          items = derive.collectReviewItems({
            storyPart: store.part,
            furnitureParts,
            commentsPart,
            commentsExtendedPart,
          });
        }

        reviewCache = {
          revisionKey,
          bodyRevision: store.revision,
          packageRevision: packageStore.packageRevision,
          items,
          paragraphOrder,
          commentsPart,
          commentsExtendedPart,
        };
        return reviewCache.items;
      },

      hasReviewContent() {
        const store = bodyStore();
        if (!reviewContentCache || reviewContentCache.revision !== store.revision) {
          reviewContentCache = {
            revision: store.revision,
            present:
              collectRevisionSites(store.part).length > 0 ||
              storyCarriesCommentAnchor(store.part.root),
          };
        }
        return reviewContentCache.present;
      },

      replyToComment(parentCommentId, anchor, text, author, date) {
        const store = bodyStore();
        // Captured BEFORE the graft, so the undo unit spans exactly what this write changed.
        const beforePackage = packageStore.currentPackage();
        const checkpoint = store.checkpoint();
        // The story store keeps a package of its OWN, and package-level writes that are not
        // story intents — a `numbering.xml` graft, a minted hyperlink relationship — land on
        // the coordinator's copy through `replacePackageShell`. Without this graft the comment
        // transaction builds on a package that never saw them, and publishing its result back
        // overwrites them: a `w:numPr` or an `r:id` left dangling on save by an unrelated
        // reply. `graftPackage` is the narrow lane for exactly this — a package write that is
        // not a user intent and publishes no revision.
        store.graftPackage(() => packageStore.currentPackage());
        // The comment ITSELF is a user intent and does publish one — see the
        // `publishStoryWrite` below.
        const result = addComment(store, {
          anchor: {
            paragraphId: anchor.paragraphId,
            start: anchor.start,
            end: anchor.end,
            // A range that ends in a LATER paragraph is ordinary in OOXML: the start and end
            // markers are independent elements. Dropping the end paragraph would anchor the
            // comment to an offset in the wrong one.
            ...(anchor.endParagraphId === undefined
              ? {}
              : { endParagraphId: anchor.endParagraphId }),
          },
          author,
          text,
          ...(date === undefined ? {} : { date }),
          ...(parentCommentId === null ? {} : { replyToCommentId: parentCommentId }),
        });
        if (!result.ok) return null;
        // A comment write creates PARTS — `comments.xml`, `commentsExtended.xml`, their
        // relationships and content types. Those live on the package, and the transaction
        // wrote them into the story store's copy of it, so the coordinator has to be told or
        // `currentPackage()` keeps answering with a package that has no comment part and the
        // reply reads back as never written.
        // The story entry the transaction just recorded is DISCARDED in favour of a package
        // pointer. Undoing a story entry syncs the story part alone, so a comment undone that
        // way put the markers back and left the body in `comments.xml`.
        store.restoreHistoryStacks(checkpoint);
        packageStore.replacePackageShell(store.package);
        packageStore.adoptPackageUnit(beforePackage);
        // Published LAST, so a subscriber that re-derives on the notification already sees the
        // shell installed above. Publishing first handed the change to a rail whose next
        // `reviewItems()` still read a package with no comment part in it.
        packageStore.publishStoryWrite(result.change);
        return result.commentId;
      },

      setCommentResolved(commentId, resolved) {
        const store = bodyStore();
        const beforePackage = packageStore.currentPackage();
        const checkpoint = store.checkpoint();
        // Grafted and republished for the same reason a reply is: the story store's package does
        // not carry the coordinator's package-level writes, and publishing back over them would
        // drop a minted relationship or a numbering graft an unrelated edit had made.
        store.graftPackage(() => packageStore.currentPackage());
        const result = setCommentResolved(store, commentId, resolved);
        if (!result.ok) return false;
        // Promoted to a package unit, like a reply: `@w15:done` lives in a sibling part.
        store.restoreHistoryStacks(checkpoint);
        packageStore.replacePackageShell(store.package);
        packageStore.adoptPackageUnit(beforePackage);
        // Resolving is a document change like any other — see `replyToComment`.
        packageStore.publishStoryWrite(result.change);
        return true;
      },

      deleteComment(commentId) {
        const store = bodyStore();
        const beforePackage = packageStore.currentPackage();
        const checkpoint = store.checkpoint();
        // Grafted and republished exactly as a reply and a resolve are, and for the same
        // reason: the story store's package does not carry the coordinator's package-level
        // writes, and publishing back over them would drop a minted relationship.
        store.graftPackage(() => packageStore.currentPackage());
        let refused = false;
        let removed = false;
        const result = store.transact((ctx) => {
          // ONE `applyPackage`, because a comment is not in one part. The body, the thread
          // record and the story markers are three places describing one remark, and a
          // transaction that took them separately could commit a body with no markers.
          ctx.applyPackage((current) => {
            const next = deleteCommentThread(current, commentId);
            if (next === null) {
              refused = true;
              return current;
            }
            removed = next !== current;
            return next;
          });
        });
        // An unchanged package means the id named no comment. That is not a failure the
        // caller can act on differently from a refusal, but it is not a write either, so it
        // must not publish a change nothing changed.
        if (refused || !result.ok || !removed) return false;
        store.restoreHistoryStacks(checkpoint);
        packageStore.replacePackageShell(store.package);
        packageStore.adoptPackageUnit(beforePackage);
        packageStore.publishStoryWrite(result.change);
        return true;
      },

      ensureListDefinition(kind) {
        // The numbering part lives on the PACKAGE, not the main-part tree. Definitions are
        // monotonic in-session and persist across lifecycle package undo/redo so story
        // `numId` references cannot go dead. The memoized numbering root is cleared so
        // layout re-reads the definitions this just added.
        const ensured = ensureListDefinition(currentPackage(), kind);
        if (!ensured) return null;
        packageStore.replacePackageShell(ensured.pkg);
        numberingRootResolved = false;
        numberingRoot = null;
        return ensured.numId;
      },

      ensureNumberingLevel(numId, level, kind) {
        // Same lane as `ensureListDefinition`: the numbering part lives on the PACKAGE,
        // and the memoized numbering root must forget what it read before this write.
        // `currentPackage()` mints a fresh object per call, so the identity check must
        // compare against the SAME instance the write was given.
        const before = currentPackage();
        const ensured = ensureNumberingLevel(before, numId, level, kind);
        if (!ensured) return false;
        if (ensured !== before) {
          packageStore.replacePackageShell(ensured);
          numberingRootResolved = false;
          numberingRoot = null;
        }
        return true;
      },

      insertImage(scope, input) {
        return packageStore.insertImage(scope, input);
      },

      replaceImage(scope, drawingNodeId, bytes, mime, decodePort, options) {
        return packageStore.replaceImage(scope, drawingNodeId, bytes, mime, decodePort, options);
      },

      deleteImage(scope, drawingNodeId) {
        return packageStore.deleteImage(scope, drawingNodeId);
      },

      applyImageProperties(scope, input) {
        return packageStore.applyImageProperties(scope, input);
      },
    },
  };
}

/**
 * Paragraph text joined by newlines, read from the CANONICAL TREE.
 *
 * Read through `paragraphTextOf` rather than the projection's `textContent`, because a tab
 * and a hard break are ATOM nodes in ProseMirror and contribute nothing to `textContent` —
 * so body text silently disagreed with the offsets the ops and the layout use. A caret at
 * offset 12 and a `bodyText().slice(12)` have to mean the same place.
 */
function projectedText(part: OoxmlPart): string {
  return bodyParagraphs(part)
    .map((paragraph) => paragraphTextOf(part, paragraph.id) ?? '')
    .join('\n');
}

function itemStartParagraphRank(
  item: ReviewItem,
  order: ReadonlyMap<string, number>
): number | null {
  const range = item.kind === 'revision' ? (item.ranges[0] ?? null) : item.range;
  if (!range) return null;
  const rank = order.get(range.start.paragraphId);
  return rank === undefined ? null : rank;
}

function canApplyLocalReviewPatch(
  cached: readonly ReviewItem[],
  localRevisions: readonly ReviewRevisionItem[],
  dirtyParagraphId: string
): boolean {
  for (const local of localRevisions) {
    if (local.ranges.length === 0) return false;
  }
  const keptRangelessKeys = new Set<string>();
  for (const item of cached) {
    if (item.kind !== 'revision' || item.ranges.length > 0) continue;
    if (isRevisionWhollyInParagraph(item, dirtyParagraphId)) continue;
    keptRangelessKeys.add(reviewItemKey(item));
  }
  for (const local of localRevisions) {
    if (keptRangelessKeys.has(reviewItemKey(local))) return false;
  }
  return true;
}

function patchLocalReviewItems(
  cached: readonly ReviewItem[],
  paragraphOrder: ReadonlyMap<string, number>,
  dirtyParagraphId: string,
  localRevisions: readonly ReviewRevisionItem[]
): ReviewItem[] {
  const dirtyRank = paragraphOrder.get(dirtyParagraphId);
  if (dirtyRank === undefined) return [...cached];

  const patched: ReviewItem[] = [];
  let insertAt: number | null = null;

  for (const item of cached) {
    if (item.kind === 'revision' && isRevisionWhollyInParagraph(item, dirtyParagraphId)) {
      if (insertAt === null) insertAt = patched.length;
      continue;
    }
    if (insertAt === null) {
      const rank = itemStartParagraphRank(item, paragraphOrder);
      if (rank !== null && rank > dirtyRank) insertAt = patched.length;
    }
    patched.push(item);
  }

  if (insertAt === null) insertAt = patched.length;
  if (localRevisions.length > 0) {
    const orderedLocalRevisions =
      localRevisions.length < 2
        ? [...localRevisions]
        : [...localRevisions].sort(
            (a, b) =>
              reviewItemPositionRank(a, paragraphOrder) - reviewItemPositionRank(b, paragraphOrder)
          );
    patched.splice(insertAt, 0, ...orderedLocalRevisions);
  }
  // RE-LINKED, because the local revisions were derived from one paragraph and carry no
  // replies. Splicing them in as-is dropped the link between a tracked change and the comment
  // answering it, so a keystroke in that paragraph tore the reply out into a card of its own —
  // and the next full re-derive put it back. The pass is over the patched list and costs
  // nothing when no comment answers a change.
  return linkRevisionReplies(patched);
}

function isRevisionWhollyInParagraph(item: ReviewRevisionItem, paragraphId: string): boolean {
  return (
    item.ranges.length > 0 &&
    item.ranges.every(
      (range) => range.start.paragraphId === paragraphId && range.end.paragraphId === paragraphId
    )
  );
}

function commentTouchesParagraph(item: ReviewCommentItem, paragraphId: string): boolean {
  if (!item.range) return false;
  return item.range.start.paragraphId === paragraphId || item.range.end.paragraphId === paragraphId;
}

function revisionCrossesParagraphBoundary(item: ReviewRevisionItem, paragraphId: string): boolean {
  if (item.ranges.length === 0) return false;
  const touches = item.ranges.some(
    (range) => range.start.paragraphId === paragraphId || range.end.paragraphId === paragraphId
  );
  if (!touches) return false;
  return !item.ranges.every(
    (range) => range.start.paragraphId === paragraphId && range.end.paragraphId === paragraphId
  );
}

function localReviewPatchParagraphId(
  change: TreeModelChange,
  cache: {
    bodyRevision: number;
    packageRevision: number;
    commentsPart: OoxmlPart | undefined;
    commentsExtendedPart: OoxmlPart | undefined;
  },
  items: readonly ReviewItem[],
  part: OoxmlPart,
  commentsPart: OoxmlPart | undefined,
  commentsExtendedPart: OoxmlPart | undefined,
  currentPackageRevision: number
): string | null {
  if (change.fromRevision !== cache.bodyRevision) return null;
  // Body text-local edits bump package revision by exactly one. A header/footer or package
  // write can move package revision without moving the body revision — patching against a
  // queue derived before that would keep stale furniture cards by reference.
  if (currentPackageRevision !== cache.packageRevision + 1) return null;
  if (change.story !== undefined && change.story.kind !== 'body') return null;
  if (change.impact !== 'text-local') return null;
  if (change.dirty.length !== 1) return null;
  if (change.created.length > 0 || change.deleted.length > 0 || change.splitJoin.length > 0) {
    return null;
  }
  if (cache.commentsPart !== commentsPart || cache.commentsExtendedPart !== commentsExtendedPart) {
    return null;
  }
  const paragraphId = change.dirty[0]!;
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return null;

  for (const item of items) {
    if (item.kind === 'comment') {
      if (commentTouchesParagraph(item, paragraphId)) return null;
      continue;
    }
    // A custom node's item is refreshed by the FULL derivation only; a local revision
    // patch on its paragraph could go stale, so refuse the fast path when one touches it.
    if (item.kind === 'custom') {
      if (item.range?.start.paragraphId === paragraphId) return null;
      continue;
    }
    if (revisionCrossesParagraphBoundary(item, paragraphId)) return null;
  }
  return paragraphId;
}

/**
 * Whether the story contains a comment anchor (`w:commentRangeStart` /
 * `w:commentReference`), from STORE vocabulary alone.
 *
 * Deliberately not `commentAnchorsOfStory`: that is review-model derivation and
 * lives with the review module. This answers presence only, for
 * `hasReviewContent`, and must keep answering with no module registered.
 *
 * Memoized per immutable node, because `snapshot()` reads `hasReviewContent`
 * every tick: without the memo a comment-less document paid a full-tree walk
 * per keystroke (the answer only early-exits when an anchor IS found). An edit
 * replaces only the nodes on its path, so every untouched subtree answers from
 * the cache. Depth-capped like the sibling walks — nesting is the cheapest
 * unbounded axis in an attacker-controlled file.
 */
const commentAnchorPresenceCache = new WeakMap<OoxmlElement, boolean>();

function storyCarriesCommentAnchor(node: OoxmlElement, depth = 0): boolean {
  if (depth > 64) return false;
  const cached = commentAnchorPresenceCache.get(node);
  if (cached !== undefined) return cached;
  let present = false;
  for (const child of node.children as readonly OoxmlNode[]) {
    if (child.kind === 'textValue') continue;
    if (
      child.kind === 'commentRangeStart' ||
      child.kind === 'commentReference' ||
      storyCarriesCommentAnchor(child, depth + 1)
    ) {
      present = true;
      break;
    }
  }
  commentAnchorPresenceCache.set(node, present);
  return present;
}

/** The origin a host should use when committing a reconciliation rather than a user edit. */
export const PROJECTION_ORIGIN = ORIGIN_IDS.projection;
