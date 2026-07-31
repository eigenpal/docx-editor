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
  ORIGIN_IDS,
  TreeDocumentStore,
  readOoxmlPackage,
  resolveHeaderFooterParts,
  resolveHeaderFooterPartsBySection,
  resolveRelationship,
  withPart,
  writeOoxmlPackage,
  paragraphTextOf,
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
import { collectDocumentOutline, type DocumentOutlineEntry } from './document-outline.ts';
import {
  allParagraphs,
  bodyParagraphs,
  docToTreeOps,
  reconcileDoc,
  treeToDoc,
} from './tree-binding.ts';
import type { TreeBindingRejection } from './tree-binding.ts';

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
   * The heading outline of the BODY story, in document order: paragraphs whose
   * `w:pStyle` resolves to a heading through the styles part (built-in `heading N`
   * name, or the style's own `w:outlineLvl` 0..8). Memoized per main-part revision —
   * an edit can retitle, add or remove a heading, but the styles part cannot change
   * in-session.
   */
  documentOutline(): readonly DocumentOutlineEntry[];
}

export type { DocumentStyleEntry } from './document-catalog.ts';
export type { DocumentOutlineEntry } from './document-outline.ts';

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

  const store = new TreeDocumentStore(main);
  let headerFooterBySection: readonly HeaderFooterParts[] | null = null;
  let lastChange: TreeModelChange | null = null;
  store.subscribe((change) => {
    lastChange = change;
  });

  const currentPackage = (): OoxmlPackage => withPart(pkg, store.part);

  // The styles part, resolved once through the main part's `styles` relationship (the
  // same resolution discipline `resolveHeaderFooterParts` uses), with the conventional
  // part name as a fallback for packages whose rels part is absent or degenerate.
  // Styles editing is a later slice, so the part is immutable in-session.
  const STYLES_REL_TYPE =
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
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

  let fontsCache: { readonly revision: number; readonly fonts: readonly string[] } | null = null;
  let stylesCache: readonly DocumentStyleEntry[] | null = null;
  let outlineCache: {
    readonly revision: number;
    readonly outline: readonly DocumentOutlineEntry[];
  } | null = null;

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
        return headerFooterBySection[headerFooterBySection.length - 1] ?? resolveHeaderFooterParts(pkg);
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
        stylesCache ??= collectDocumentStyles(resolveStylesRoot());
        return stylesCache;
      },

      stylesRoot: () => resolveStylesRoot(),

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
