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
import { collectReviewItems, type ReviewItem } from '../layout/review-model.ts';
import { addComment } from '../store/store/comment-writes.ts';
import {
  ORIGIN_IDS,
  TreeDocumentStore,
  readEmbeddedFonts,
  readOoxmlPackage,
  resolveHeaderFooterParts,
  resolveHeaderFooterPartsBySection,
  resolveRelationship,
  withPart,
  writeOoxmlPackage,
  ensureListDefinition,
  ensureNumberingLevel,
  ensureHyperlinkRelationship,
  buildBookmarkIndex,
  relationshipTargetIn,
  normalizeParagraphIdentity,
  paragraphTextOf,
  type BookmarkIndex,
  type EmbeddedFont,
  type ListKind,
  type HeaderFooterParts,
  type OoxmlElement,
  type OoxmlPackage,
  type OoxmlPackageRejection,
  type OoxmlPart,
  type SelectionMark,
  type TreeDocOp,
  type TreeModelChange,
} from '@docx-editor.dev/core-contract/store';
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
  collectDocumentThemeColors,
  collectDocumentThemeFonts,
  type DocumentThemeColorEntry,
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

export interface TreeApplyResult {
  readonly committed: boolean;
  readonly rejected: boolean;
  readonly opCount: number;
  /** Present when the edit was refused, so a host can report WHY rather than a silent no-op. */
  readonly reason?: TreeBindingRejection | string;
}

export interface TreeDocxSession {
  /** Whether the body holds at least one editable paragraph. */
  readonly editable: boolean;
  /** Canonical node ids of the body paragraphs, in order. */
  paragraphIds(): string[];
  /** The current canonical part — what layout reads. Never mutated by the caller. */
  part(): OoxmlPart;
  /**
   * Commit typed tree ops directly, as ONE transaction.
   *
   * The paginated surface has no ProseMirror doc to diff, so it addresses the model the way
   * the ops already do — by node id and offset — rather than round-tripping an edit through
   * a projection just to have it diffed back out.
   */
  applyTreeOps(
    ops: readonly TreeDocOp[],
    selectionBefore?: SelectionMark | null,
    selectionAfter?: SelectionMark | null
  ): TreeApplyResult;
  /** Project the current revision into a ProseMirror doc. */
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
  /** Map an edited doc to tree ops and commit them as ONE transaction. */
  applyPmDoc(doc: PMNode): TreeApplyResult;
  /** Body text, paragraphs joined by newlines, read from the CANONICAL tree. */
  bodyText(): string;
  revision(): number;
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
  beginComposition(): void;
  endComposition(): void;
  subscribe(onChange: (change: TreeModelChange) => void): () => void;
  /** Serialize the whole package back to DOCX bytes. */
  save(): Uint8Array;
  /**
   * The resolved header/footer parts of the section, by variant (phase 2, read-only).
   *
   * Returns the FINAL section's effective parts after OOXML inheritance. Prefer
   * `headerFooterPartsBySection` for multi-section pagination.
   *
   * Immutable for the session's lifetime: header/footer EDITING is a later slice, so a
   * host may key derived layout by part object identity.
   */
  headerFooterParts(): HeaderFooterParts;
  /**
   * Per-section header/footer parts after OOXML inheritance, index-aligned with
   * `enumerateDocumentSections`.
   */
  headerFooterPartsBySection(): readonly HeaderFooterParts[];
  /**
   * Font family names the document uses, from every `w:rFonts` in the CURRENT main
   * part plus the styles and header/footer parts — validated, deduplicated, sorted.
   * Memoized per main-part revision (the other parts are immutable in-session).
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
   * What the MAIN part's relationships answer for one `r:id`: the authored target and
   * whether it is external. `null` for an id the part does not declare.
   *
   * Live rather than memoized: inserting a link mints a relationship mid-session, and a
   * cached resolver would report the link this session just created as dangling.
   */
  relationshipTarget(
    relationshipId: string
  ): { readonly target: string; readonly external: boolean } | null;
  /**
   * `bookmarkName -> { paragraphId, offset }` over the main part, memoized per revision.
   *
   * What an internal hyperlink's `w:anchor` resolves through. Keyed on the store revision
   * because an edit can move, split or delete the paragraph a bookmark sits in.
   */
  bookmarks(): BookmarkIndex;
  /**
   * The relationship id for an external hyperlink target, minting one if the package has
   * none, or `null` when the URL is refused.
   *
   * Lives on the PACKAGE, outside `store.transact`, like the numbering definitions: the
   * undoable half is the tree op that names the id. An unreferenced relationship left
   * behind by an undo is inert and is what Word writes anyway.
   */
  ensureHyperlinkRelationship(url: string): string | null;
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
   * mapped. Header/footer/footnote paragraphs are not: those stories are addressed
   * structurally (`DocLocation`) when they become editable.
   */
  paragraphAnchors(): ParagraphAnchorIndex;
  /** `w14:paraId` of a canonical paragraph node id, verbatim, or null. */
  paraIdOf(nodeId: string): string | null;
  /** Canonical node id for a `w14:paraId`, matched case-insensitively, or null. */
  nodeIdOf(paraId: string): string | null;
}

export type { DocumentStyleEntry } from './document-catalog.ts';
export type { DocumentThemeColorEntry, ThemeColorSlot } from './document-theme.ts';
export type { DocumentOutlineEntry } from './document-outline.ts';
export type { ParagraphAnchorIndex } from './paragraph-anchors.ts';

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
export function openTreeSession(bytes: Uint8Array): OpenTreeSessionResult {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) {
    return {
      ok: false,
      reason: loaded.reason,
      ...(loaded.detail ? { detail: loaded.detail } : {}),
    };
  }

  let pkg: OoxmlPackage = loaded.package;
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) return { ok: false, reason: 'no-main-document-tree', detail: pkg.mainDocumentPart };

  // Paragraph identity is established once, here — every paragraph the session edits
  // carries a valid, part-unique `w14:paraId` from the first revision on, so the op
  // layer can seed split-tail mints and the contract can address by paraId. A document
  // already carrying valid ids normalizes to the SAME part reference (byte-stable save).
  const normalized = normalizeParagraphIdentity(main);
  if (normalized !== main) pkg = withPart(pkg, normalized);

  // The store owns the whole package now, so a transaction that writes several parts is one
  // publication and one undo entry. `store.part` still answers with the main document part.
  const store = new TreeDocumentStore(pkg, pkg.mainDocumentPart);
  let headerFooterBySection: readonly HeaderFooterParts[] | null = null;
  /** Memoized per store revision: the queue only changes when the document does. */
  let reviewCache: { revision: number; items: readonly ReviewItem[] } | null = null;
  let lastChange: TreeModelChange | null = null;
  store.subscribe((change) => {
    lastChange = change;
  });

  const currentPackage = (): OoxmlPackage => store.package;

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
    const record = (pkg.relationships.get(pkg.mainDocumentPart) ?? []).find(
      (rel) => rel.type === STYLES_REL_TYPE
    );
    let part: OoxmlPart | undefined;
    if (record) {
      const resolved = resolveRelationship(record);
      if (resolved.mode === 'Internal' && resolved.target.ok) {
        part = pkg.parts.get(resolved.target.partName);
      }
    }
    part ??= pkg.parts.get('/word/styles.xml');
    stylesRoot = part?.root ?? null;
    return stylesRoot;
  };

  let numberingRootResolved = false;
  let numberingRoot: OoxmlElement | null = null;
  const resolveNumberingRoot = (): OoxmlElement | null => {
    if (numberingRootResolved) return numberingRoot;
    numberingRootResolved = true;
    const record = (pkg.relationships.get(pkg.mainDocumentPart) ?? []).find(
      (rel) => rel.type === NUMBERING_REL_TYPE
    );
    let part: OoxmlPart | undefined;
    if (record) {
      const resolved = resolveRelationship(record);
      if (resolved.mode === 'Internal' && resolved.target.ok) {
        part = pkg.parts.get(resolved.target.partName);
      }
    }
    part ??= pkg.parts.get('/word/numbering.xml');
    numberingRoot = part?.root ?? null;
    return numberingRoot;
  };

  // The settings part, resolved like the styles part. Word writes document-wide layout
  // constants here — `w:defaultTabStop` among them — that no paragraph property chain can
  // see, so layout has to be handed them separately.
  const SETTINGS_REL_TYPE =
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings';
  let settingsRootResolved = false;
  let settingsRoot: OoxmlElement | null = null;
  const resolveSettingsRoot = (): OoxmlElement | null => {
    if (settingsRootResolved) return settingsRoot;
    settingsRootResolved = true;
    const record = (pkg.relationships.get(pkg.mainDocumentPart) ?? []).find(
      (rel) => rel.type === SETTINGS_REL_TYPE
    );
    let part: OoxmlPart | undefined;
    if (record) {
      const resolved = resolveRelationship(record);
      if (resolved.mode === 'Internal' && resolved.target.ok) {
        part = pkg.parts.get(resolved.target.partName);
      }
    }
    part ??= pkg.parts.get('/word/settings.xml');
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
    const record = (pkg.relationships.get(pkg.mainDocumentPart) ?? []).find(
      (rel) => rel.type === THEME_REL_TYPE
    );
    let part: OoxmlPart | undefined;
    if (record) {
      const resolved = resolveRelationship(record);
      if (resolved.mode === 'Internal' && resolved.target.ok) {
        part = pkg.parts.get(resolved.target.partName);
      }
    }
    part ??= pkg.parts.get('/word/theme/theme1.xml');
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
    const record = (pkg.relationships.get(pkg.mainDocumentPart) ?? []).find(
      (rel) => rel.type === FONT_TABLE_REL_TYPE
    );
    let part: OoxmlPart | undefined;
    if (record) {
      const resolved = resolveRelationship(record);
      if (resolved.mode === 'Internal' && resolved.target.ok) {
        part = pkg.parts.get(resolved.target.partName);
      }
    }
    part ??= pkg.parts.get('/word/fontTable.xml');
    embeddedFontsCache = Object.freeze(readEmbeddedFonts(pkg, part));
    return embeddedFontsCache;
  };

  let fontsCache: { readonly revision: number; readonly fonts: readonly string[] } | null = null;
  let stylesCache: readonly DocumentStyleEntry[] | null = null;
  let themeColorsCache: readonly DocumentThemeColorEntry[] | null = null;
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
  let anchorsCache: {
    readonly revision: number;
    readonly index: ParagraphAnchorIndex;
  } | null = null;
  let bookmarksCache: { readonly revision: number; readonly index: BookmarkIndex } | null = null;
  const paragraphAnchors = (): ParagraphAnchorIndex => {
    // Keyed on the store revision, like the outline: a split mints a new paragraph and
    // a join removes one, but between commits the map cannot move.
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
      editable: allParagraphs(store.part).length > 0,

      // The full editable set, cell paragraphs included: selection clamping, Enter's
      // minted-tail diff and select-all in the paginated surface address these by node id.
      paragraphIds: () => allParagraphs(store.part).map((paragraph) => paragraph.id),

      part: () => store.part,

      applyTreeOps(ops, selectionBefore, selectionAfter) {
        if (ops.length === 0) return { committed: false, rejected: false, opCount: 0 };
        const result = store.transact((ctx) => {
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

      projectDoc: () => treeToDoc(store.part),

      reconcile: (previousDoc) => reconcileDoc(previousDoc, store.part, lastChange),

      lastCommitWasStructural: () =>
        lastChange !== null &&
        (lastChange.created.length > 0 ||
          lastChange.deleted.length > 0 ||
          lastChange.splitJoin.length > 0),

      applyPmDoc(doc) {
        const mapped = docToTreeOps(store.part, doc);
        if (!mapped.ok) {
          return { committed: false, rejected: true, opCount: 0, reason: mapped.reason };
        }
        if (mapped.ops.length === 0) return { committed: false, rejected: false, opCount: 0 };
        const result = store.transact((ctx) => {
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

      bodyText: () => projectedText(store),

      revision: () => store.revision,
      canUndo: () => store.canUndo,
      canRedo: () => store.canRedo,
      undo: () => {
        const selection = store.selectionForUndo();
        return store.undo() === null ? null : selection;
      },
      redo: () => {
        const selection = store.selectionForRedo();
        return store.redo() === null ? null : selection;
      },
      beginComposition: () => store.beginComposition(),
      endComposition: () => store.endComposition(),

      subscribe(onChange) {
        return store.subscribe(onChange);
      },

      save() {
        pkg = currentPackage();
        return writeOoxmlPackage(pkg);
      },

      headerFooterParts() {
        headerFooterBySection ??= resolveHeaderFooterPartsBySection(pkg);
        return (
          headerFooterBySection[headerFooterBySection.length - 1] ?? resolveHeaderFooterParts(pkg)
        );
      },

      headerFooterPartsBySection() {
        headerFooterBySection ??= resolveHeaderFooterPartsBySection(pkg);
        return headerFooterBySection;
      },

      documentFonts() {
        // Keyed on the store revision: an edit can add or remove a run-level
        // `w:rFonts`, but the styles and header/footer parts cannot change in-session.
        if (fontsCache && fontsCache.revision === store.revision) return fontsCache.fonts;
        headerFooterBySection ??= resolveHeaderFooterPartsBySection(pkg);
        const roots: OoxmlElement[] = [store.part.root];
        const styles = resolveStylesRoot();
        if (styles) roots.push(styles);
        const seen = new Set<OoxmlPart>();
        for (const section of headerFooterBySection) {
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
        fontsCache = { revision: store.revision, fonts: collectDocumentFonts(roots) };
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

      numberingRoot: () => resolveNumberingRoot(),

      settingsRoot: () => resolveSettingsRoot(),

      documentThemeColors() {
        themeColorsCache ??= collectDocumentThemeColors(resolveThemeRoot());
        return themeColorsCache;
      },

      effectiveRunDefaults(paragraphId, runProperties) {
        runDefaultsResolver ??= createRunDefaultsResolver(
          resolveStylesRoot(),
          collectDocumentThemeFonts(resolveThemeRoot())
        );
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
        // Keyed on the store revision, like the fonts: typing inside a heading or
        // splitting one changes the outline, but the styles part is immutable.
        if (outlineCache && outlineCache.revision === store.revision) return outlineCache.outline;
        outlineCache = {
          revision: store.revision,
          outline: collectDocumentOutline(store.part, resolveStylesRoot()),
        };
        return outlineCache.outline;
      },

      embeddedFonts: resolveEmbeddedFonts,

      paragraphAnchors,

      paraIdOf: (nodeId) => paragraphAnchors().paraIdByNode.get(nodeId) ?? null,

      nodeIdOf: (paraId) => paragraphAnchors().nodeByParaId.get(paraId.toUpperCase()) ?? null,

      relationshipTarget: (relationshipId) =>
        relationshipTargetIn(pkg, pkg.mainDocumentPart, relationshipId),

      bookmarks: () => {
        if (!bookmarksCache || bookmarksCache.revision !== store.revision) {
          bookmarksCache = { revision: store.revision, index: buildBookmarkIndex(store.part) };
        }
        return bookmarksCache.index;
      },

      ensureHyperlinkRelationship(url) {
        // Same lane as `ensureListDefinition`: a package write, not a tree op, so it sits
        // outside the undo stack. It goes THROUGH the store, because the store owns the
        // package — writing only to a session-local copy leaves two owners of one value, and
        // the save then reads the one the write never reached, so the link reopens targetless.
        const before = currentPackage();
        const ensured = ensureHyperlinkRelationship(before, url);
        if (!ensured) return null;
        if (ensured.pkg !== before) {
          store.graftPackage(() => ensured.pkg);
          pkg = ensured.pkg;
        }
        return ensured.relationshipId;
      },

      reviewItems() {
        if (!reviewCache || reviewCache.revision !== store.revision) {
          const pkg = currentPackage();
          reviewCache = {
            revision: store.revision,
            items: collectReviewItems({
              storyPart: store.part,
              commentsPart: pkg.parts.get('/word/comments.xml'),
              commentsExtendedPart: pkg.parts.get('/word/commentsExtended.xml'),
            }),
          };
        }
        return reviewCache.items;
      },

      replyToComment(parentCommentId, anchor, text, author, date) {
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
        return result.ok ? result.commentId : null;
      },

      ensureListDefinition(kind) {
        // The numbering part lives on the PACKAGE and this is not a user intent, so it takes
        // the graft lane rather than `store.transact`: no revision, no undo entry. It goes
        // THROUGH the store so the package has one owner. The memoized numbering root is
        // cleared so layout re-reads the definitions this just added.
        const ensured = ensureListDefinition(currentPackage(), kind);
        if (!ensured) return null;
        store.graftPackage(() => ensured.pkg);
        pkg = ensured.pkg;
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
          store.graftPackage(() => ensured);
          pkg = ensured;
          numberingRootResolved = false;
          numberingRoot = null;
        }
        return true;
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
function projectedText(store: TreeDocumentStore): string {
  return bodyParagraphs(store.part)
    .map((paragraph) => paragraphTextOf(store.part, paragraph.id) ?? '')
    .join('\n');
}

/** The origin a host should use when committing a reconciliation rather than a user edit. */
export const PROJECTION_ORIGIN = ORIGIN_IDS.projection;
