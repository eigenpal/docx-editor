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

import { projectedText, storyCarriesCommentAnchor } from './story-text-reads.ts';
import type { Node as PMNode } from 'prosemirror-model';
import { paragraphOrderOfPart, type ReviewItem } from '@docx-editor.dev/core/store';
import {
  canApplyLocalReviewPatch,
  localReviewPatchParagraphId,
  patchLocalReviewItems,
} from './review-patch.ts';
import type { ReviewModuleContribution } from '../contracts/modules.ts';
import {
  addPackageComment,
  deletePackageComments,
  setPackageCommentResolved,
} from '../store/store/comment-package-write.ts';
import { commentPartNameOf, commentsExtendedPartNameOf } from '../store/store/comment-writes.ts';
import {
  insertPackageCustomNode,
  removePackageCustomNode,
} from '../store/store/custom-node-package-write.ts';
import {
  customNodePayloadsByControl,
  type CustomNodePayloadRead,
  sweepCustomNodePayloads,
  type CustomNodeSweepOutcome,
} from '../store/store/custom-node-writes.ts';
import { resolveNotesPart } from '../store/package/note-references.ts';
import { runObservedStoreTransaction } from '../store/package/canonical-primitive-capture.ts';
import {
  ORIGIN_IDS,
  TreePackageStore,
  readEmbeddedFonts,
  readOoxmlPackage,
  resolveHeaderFooterParts,
  resolveHeaderFooterResolutionBySection,
  resolveRelationship,
  writeOoxmlPackage,
  ensureListDefinition,
  ensureNumberingLevel,
  ensureHyperlinkRelationship,
  buildBookmarkIndex,
  relationshipTargetIn,
  normalizeParagraphIdentity,
  paragraphTextOf,
  collectRevisionSites,
  type BookmarkIndex,
  type EmbeddedFont,
  type HeaderFooterParts,
  type HeaderFooterSectionResolution,
  type OoxmlElement,
  type OoxmlPackage,
  type OoxmlPackageRejection,
  type OoxmlPart,
  type StoryScope,
  type TreeModelChange,
} from '@docx-editor.dev/core/store';
import { headerFooterPartsFromResolution } from '../store/package/hf-references.ts';
import {
  collectDocumentFonts,
  collectDocumentStyles,
  documentRendersText,
  type DocumentStyleEntry,
} from './document-catalog.ts';
import {
  collectDocumentOutline,
  paragraphStyleId,
  type DocumentOutlineEntry,
} from './document-outline.ts';
import { collectRenderedFontFamilies } from './document-rendered-fonts.ts';
import { collectTextMatches, type DocumentSearchResult } from './document-search.ts';
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
import { allParagraphs, docToTreeOps, reconcileDoc, treeToDoc } from './tree-binding.ts';
import {
  buildParagraphAnchorIndex,
  refreshParagraphAnchorParts,
  type ParagraphAnchorIndex,
} from './paragraph-anchors.ts';
import { directParaIdOf } from './paragraph-anchor-direct-read.ts';
import { readTrackingSettings } from '../store/package/tracking-settings.ts';
import {
  EMPTY_DOCUMENT_PROPERTIES,
  readDocumentProperties,
  type DocumentProperties,
} from '../store/package/document-properties.ts';
import { createCollaborationDocumentPort } from '../collaboration/replication.ts';
import { commitSessionTreeOps } from './tree-session-apply.ts';

// The session view contract (TreeApplyResult + TreeDocxSessionView) lives in
// tree-session-contract.ts; re-exported so every existing import through this module stays
// stable.
import type {
  TreeApplyOptions,
  TreeApplyResult,
  TreeDocxSessionView,
} from './tree-session-contract.ts';
export type { TreeApplyOptions, TreeApplyResult, TreeDocxSessionView };

/**
 * Binding-only session methods that exchange ProseMirror projections.
 *
 * Editor surfaces expose {@link TreeDocxSessionView}. Only the binding lane sees this extension.
 */
export interface TreeDocxSession extends TreeDocxSessionView {
  /** Project the current BODY revision into a ProseMirror doc. */
  projectDoc(): PMNode;
  /** Re-project incrementally from the last committed change, reusing untouched paragraphs. */
  reconcile(previousDoc: PMNode): PMNode;
  /**
   * Whether the last commit changed the BLOCK SEQUENCE (a split, join, insert or delete).
   *
   * A host needs this to decide whether the view must be re-projected at all. After a pure
   * text edit, the view already holds what the model holds. Re-projecting wastes work and
   * races the next keystroke.
   */
  lastCommitWasStructural(): boolean;
  /** Map an edited BODY doc to tree ops and commit them as one transaction. */
  applyPmDoc(doc: PMNode): TreeApplyResult;
}

export type { DocumentStyleEntry } from './document-catalog.ts';
export type { DocumentThemeColorEntry, ThemeColorSlot } from './document-theme.ts';
export type { DocumentOutlineEntry } from './document-outline.ts';
export type { ParagraphAnchorIndex } from './paragraph-anchors.ts';
export type { StoryScope, StoryTargetRejection } from '@docx-editor.dev/core/store';

/**
 * Why bytes could not be opened: any bounded-reader rejection, plus the package that parsed but
 * carried no main document tree.
 */
export type TreeSessionRejection = OoxmlPackageRejection | 'no-main-document-tree';

/**
 * An open session, or a typed refusal.
 *
 * A result rather than a throw: every failure here is a property of the FILE, and a host needs to
 * tell "this is not a package" from "this package is malicious" from "this document has no body".
 */
export type OpenTreeSessionResult =
  | { readonly ok: true; readonly session: TreeDocxSession }
  | { readonly ok: false; readonly reason: TreeSessionRejection; readonly detail?: string };

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

/**
 * Open DOCX bytes into a tree-backed session.
 *
 * Returns a typed rejection rather than throwing: every failure here is a property of the FILE,
 * and a host needs to tell "this is not a package" from "this package is malicious" from "this
 * document has no body".
 *
 * The read is BOUNDED — decompression ratio, part count, XML depth and element counts are all
 * capped — because the bytes are untrusted by definition.
 */
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
      headerFooterBySection &&
      lastChange &&
      headerFooterBySection.packageRevision === lastChange.fromRevision &&
      packageStore.packageRevision === lastChange.toRevision &&
      lastChange.story?.kind === 'body' &&
      lastChange.impact === 'text-local' &&
      lastChange.created.length === 0 &&
      lastChange.deleted.length === 0 &&
      lastChange.splitJoin.length === 0
    ) {
      headerFooterBySection = {
        ...headerFooterBySection,
        packageRevision: packageStore.packageRevision,
      };
    }
    if (
      !headerFooterBySection ||
      headerFooterBySection.packageRevision !== packageStore.packageRevision
    ) {
      const resolution = resolveHeaderFooterResolutionBySection(currentPackage());
      headerFooterBySection = {
        packageRevision: packageStore.packageRevision,
        resolution,
        parts: headerFooterPartsFromResolution(resolution),
      };
    }
    return headerFooterBySection;
  };

  // Resolve styles and numbering through relationships, with conventional-name fallbacks.
  // Their memoized roots are cleared after the narrow package edits this session supports.
  const STYLES_REL_TYPE =
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
  const NUMBERING_REL_TYPE =
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';
  let stylesRoot: OoxmlElement | null = null;
  const resolveStylesRoot = (): OoxmlElement | null => {
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
    const next = part?.root ?? null;
    if (next !== stylesRoot) {
      stylesRoot = next;
      stylesCache = null;
      runDefaultsResolver = null;
    }
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

  // The document-property parts, related off the PACKAGE root (`/`), not the main document part.
  // Both are conventional docProps names, with a relationship lookup first so a renamed part
  // still resolves. Read once per package revision — document properties editing is a later slice.
  const CORE_PROPERTIES_REL_TYPE =
    'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties';
  const EXTENDED_PROPERTIES_REL_TYPE =
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties';
  const resolvePropertiesPart = (relType: string, fallbackName: string): OoxmlPart | undefined => {
    const live = currentPackage();
    const record = (live.relationships.get('/') ?? []).find((rel) => rel.type === relType);
    let part: OoxmlPart | undefined;
    if (record) {
      const resolved = resolveRelationship(record);
      if (resolved.mode === 'Internal' && resolved.target.ok) {
        part = live.parts.get(resolved.target.partName);
      }
    }
    return part ?? live.parts.get(fallbackName);
  };
  let documentPropertiesRevision = -1;
  let documentPropertiesValue: DocumentProperties = EMPTY_DOCUMENT_PROPERTIES;
  const resolveDocumentProperties = (): DocumentProperties => {
    if (documentPropertiesRevision === packageStore.packageRevision) return documentPropertiesValue;
    documentPropertiesRevision = packageStore.packageRevision;
    const core = resolvePropertiesPart(CORE_PROPERTIES_REL_TYPE, '/docProps/core.xml');
    const app = resolvePropertiesPart(EXTENDED_PROPERTIES_REL_TYPE, '/docProps/app.xml');
    documentPropertiesValue = readDocumentProperties(core?.root ?? null, app?.root ?? null);
    return documentPropertiesValue;
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
  let renderedFontsCache: {
    readonly revision: number;
    readonly styles: OoxmlElement | null;
    readonly families: readonly string[];
  } | null = null;
  let rendersTextCache: { readonly revision: number; readonly rendersText: boolean } | null = null;
  let stylesCache: readonly DocumentStyleEntry[] | null = null;
  let themeColorsCache: readonly DocumentThemeColorEntry[] | null = null;
  let themeFontsCache: DocumentThemeFonts | null = null;
  /**
   * Live body, headers, footers, and notes — the roots whose content RENDERS. Including
   * notes ensures their fonts load. Callers memoize each answer by package revision.
   */
  const storyCatalogRoots = (): OoxmlElement[] => {
    const roots: OoxmlElement[] = [bodyStore().part.root];
    const seen = new Set<OoxmlPart>();
    for (const part of furnitureAndNoteParts()) {
      if (seen.has(part)) continue;
      seen.add(part);
      roots.push(part.root);
    }
    return roots;
  };
  const catalogRoots = (): OoxmlElement[] => {
    const roots = storyCatalogRoots();
    const styles = resolveStylesRoot();
    // Body first, then styles, then furniture — first-seen casing follows reading order.
    if (styles) roots.splice(1, 0, styles);
    return roots;
  };

  let runDefaultsResolver:
    | ((styleId: string | null, runProperties?: readonly RunPropertyLike[]) => StyleRunDefaults)
    | null = null;
  // Paragraph -> pStyle, per revision. Style-part repair clears this cache explicitly.
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
    readonly openStories: string;
    readonly parts: readonly OoxmlPart[];
    readonly index: ParagraphAnchorIndex;
  } | null = null;
  const readNormalizedParts = new WeakMap<OoxmlPart, OoxmlPart>();
  let bookmarksCache: { readonly revision: number; readonly index: BookmarkIndex } | null = null;
  /**
   * A story part with its paraIds minted, for READING only.
   *
   * Memoized on the part's identity: parts are immutable, so one normalization per part is
   * always enough, and without the memo every revision would rebuild every furniture part in a
   * document that has several. The result never reaches the package — the store mints its own
   * on open, deterministically and identically.
   */
  const normalizedForRead = (part: OoxmlPart): OoxmlPart => {
    const cached = readNormalizedParts.get(part);
    if (cached) return cached;
    const normalized = normalizeParagraphIdentity(part);
    readNormalizedParts.set(part, normalized);
    return normalized;
  };

  const paragraphAnchors = (): ParagraphAnchorIndex => {
    // Keyed on the PACKAGE revision, because the index now spans every story: a split in a
    // header mints a paragraph the body revision knows nothing about, and against that key the
    // map would have kept answering for the document as it was before.
    //
    // COST, measured: ~0.9 ms to rebuild at 7k anchors, against ~0.002 ms for a cached read.
    // Spanning every story costs nothing measurable on top of the body alone — the two builds
    // time the same, and whichever runs second in a bench looks slower, which is warm-up. The
    // furniture and note parts are a handful of paragraphs beside a body's thousands.
    //
    // So the ~0.9 ms is the body index, and it is what a body edit paid before this spanned
    // anything. It is not free: it lands on the snapshot path, and it goes on composing maps
    // over every paragraph rather than on the walk (memoizing `allParagraphs` per part takes
    // only ~7% off).
    //
    const revision = packageStore.packageRevision;
    // AND which stories are open. Opening one mints its paraIds without publishing an edit, so
    // the package revision does not move and an index built a moment earlier would be served
    // for the rest of the session — which is what a host reading `snapshot()` on mount does.
    const openStories = packageStore.openStoryToken();
    if (
      !anchorsCache ||
      anchorsCache.revision !== revision ||
      anchorsCache.openStories !== openStories
    ) {
      // Open story stores FIRST, so their live parts win the dedupe below. `w14:paraId` is
      // minted when a story store opens and only reaches the coordinator's package on the
      // first commit — so a header the reader has entered but not yet typed in carries none
      // in the package copy, and indexing that copy could not address it.
      const open = packageStore.openStoryParts();
      const seen = new Set(open.map((part) => part.name));
      // And an UNOPENED story is normalized on the way in, for the same reason from the other
      // side: a header nobody has entered carries no `w14:paraId` at all, so indexing the
      // package copy verbatim left every one of its paragraphs unaddressable until the reader
      // happened to click into it. Minting is deterministic and seeded by the structural node
      // id, so the ids computed here are the ones the store will mint when the story does
      // open — the same paraId before and after, which is what makes an anchor durable.
      const rest = furnitureAndNoteParts()
        .filter((part) => !seen.has(part.name))
        .map(normalizedForRead);
      const parts = [bodyStore().part, ...open, ...rest];
      const previousAnchors = anchorsCache;
      const canReuseMaps =
        previousAnchors !== null &&
        lastChange !== null &&
        previousAnchors.openStories === openStories &&
        previousAnchors.revision === lastChange.fromRevision &&
        revision === lastChange.toRevision &&
        lastChange.impact === 'text-local' &&
        lastChange.created.length === 0 &&
        lastChange.deleted.length === 0 &&
        lastChange.splitJoin.length === 0 &&
        previousAnchors.parts.length === parts.length &&
        previousAnchors.parts.every((part, index) => part.name === parts[index]?.name);
      anchorsCache = {
        revision,
        openStories,
        parts,
        index:
          canReuseMaps && previousAnchors
            ? refreshParagraphAnchorParts(previousAnchors.index, parts)
            : buildParagraphAnchorIndex(parts),
      };
    }
    return anchorsCache.index;
  };

  /**
   * The payload every custom node binds, from EVERY story, merged.
   *
   * The review queue lists cards from every story, so it needs the payloads of every story. It
   * asked for the body's, which meant a chip in a header produced a card with `data: undefined`
   * — indistinguishable from a chip that genuinely carries none, which is the same confusion
   * the activation helpers were fixed for.
   *
   * The store hangs off the MAIN part in every case: Word only reads one authored there. So the
   * story varies per call and the data owner does not.
   */
  const customNodePayloadsAcrossStories = (): ReadonlyMap<string, CustomNodePayloadRead> => {
    const owner = bodyStore().part.name;
    const merged = new Map<string, CustomNodePayloadRead>();
    for (const part of [bodyStore().part, ...furnitureAndNoteParts()]) {
      for (const [controlId, payload] of customNodePayloadsByControl(
        currentPackage(),
        part.name,
        owner
      )) {
        merged.set(controlId, payload);
      }
    }
    return merged;
  };

  /**
   * Every story part that is not the body: each header and footer, then the two note parts,
   * deduplicated.
   *
   * NOTES ARE STORIES TOO. A tracked change or a comment inside a footnote paints on the page
   * like any other, but the review queue once walked the body and the header/footer parts
   * alone — so it was visible in the document and unreachable from every review surface, and
   * `acceptAllRevisions` refuses while it is still there.
   *
   * Read straight from the package rather than through `resolveStory`, which would OPEN a
   * store for every note part just to answer a read.
   */
  const storyParts = (): readonly OoxmlPart[] => [bodyStore().part, ...furnitureAndNoteParts()];

  const furnitureAndNoteParts = (): OoxmlPart[] => {
    const parts: OoxmlPart[] = [];
    const seen = new Set<OoxmlPart>();
    for (const section of resolvedHeaderFooterBySection().parts) {
      for (const slots of [section.headers, section.footers]) {
        for (const part of slots.values()) {
          if (seen.has(part)) continue;
          seen.add(part);
          parts.push(part);
        }
      }
    }
    const pkg = currentPackage();
    for (const noteKind of ['footnote', 'endnote'] as const) {
      const part = resolveNotesPart(pkg, noteKind);
      if (!part || seen.has(part)) continue;
      seen.add(part);
      parts.push(part);
    }
    return parts;
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

      collaborationPort: (documentId) =>
        createCollaborationDocumentPort(packageStore, { documentId }),

      applyTreeOps(ops, selectionBefore, selectionAfter, scope = BODY_SCOPE, options = {}) {
        return commitSessionTreeOps(
          packageStore,
          ops,
          selectionBefore,
          selectionAfter,
          scope,
          options
        );
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

      storyParts,
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
        fontsCache = {
          revision: packageStore.packageRevision,
          fonts: collectDocumentFonts(
            catalogRoots(),
            collectDocumentThemeFonts(resolveThemeRoot())
          ),
        };
        return fontsCache.fonts;
      },

      renderedFontFamilies() {
        // Keyed on the package revision AND the styles root: `resolveStylesRoot` swaps the
        // root by identity when the styles part is repaired or replaced, and the style
        // chains this derivation walks live there.
        const styles = resolveStylesRoot();
        if (
          renderedFontsCache &&
          renderedFontsCache.revision === packageStore.packageRevision &&
          renderedFontsCache.styles === styles
        ) {
          return renderedFontsCache.families;
        }
        renderedFontsCache = {
          revision: packageStore.packageRevision,
          styles,
          families: collectRenderedFontFamilies(
            storyCatalogRoots(),
            styles,
            collectDocumentThemeFonts(resolveThemeRoot())
          ),
        };
        return renderedFontsCache.families;
      },

      rendersText() {
        // Same revision key as `documentFonts`, and for the same reason: typing the first
        // character of a document is exactly the edit this answer must notice.
        if (rendersTextCache && rendersTextCache.revision === packageStore.packageRevision) {
          return rendersTextCache.rendersText;
        }
        rendersTextCache = {
          revision: packageStore.packageRevision,
          rendersText: documentRendersText(catalogRoots()),
        };
        return rendersTextCache.rendersText;
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
      documentProperties: () => resolveDocumentProperties(),
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

      paraIdOf: (nodeId) =>
        directParaIdOf(nodeId, {
          body: bodyStore().part,
          openStories: packageStore.openStoryParts(),
          otherStories: furnitureAndNoteParts(),
          normalize: normalizedForRead,
        }),

      nodeIdOf: (paraId) => paragraphAnchors().nodeByParaId.get(paraId.toUpperCase()) ?? null,

      relationshipTarget: (relationshipId, scope = BODY_SCOPE) => {
        const live = currentPackage();
        const part = packageStore.partFor(scope);
        if (!part) return null;
        return relationshipTargetIn(live, part.name, relationshipId);
      },

      bookmarks: () => {
        // EVERY STORY, keyed on the PACKAGE revision. A bookmark in a header is a bookmark in
        // the document: an internal hyperlink that names it has to reach it, and the reader
        // navigating to one has to land there. Reading the body alone answered that neither
        // existed — navigation returned false and the link sat inert — and keying on the body
        // revision meant a bookmark added in a header never invalidated the answer either.
        //
        // BODY FIRST so it wins a name clash, which is the existing first-in-order rule and
        // what Word does: a duplicate name resolves to the body's.
        const revision = packageStore.packageRevision;
        if (!bookmarksCache || bookmarksCache.revision !== revision) {
          const merged = new Map(buildBookmarkIndex(bodyStore().part));
          for (const part of furnitureAndNoteParts()) {
            for (const [name, anchor] of buildBookmarkIndex(part)) {
              if (!merged.has(name)) merged.set(name, anchor);
            }
          }
          bookmarksCache = { revision, index: merged };
        }
        return bookmarksCache.index;
      },

      ensureHyperlinkRelationship(url, scope = BODY_SCOPE) {
        // Package write, not a tree op: the story undo unit names the rId, while the
        // relationship itself is session-persistent across lifecycle package snapshots
        // (see `mergePersistentPackageShell`). Leftover rels are harmless; missing ones are not.
        // The identity check compares the write's output against the SAME `before` instance
        // handed to the write; `currentPackage()` being memoized only strengthens that.
        const part = packageStore.partFor(scope);
        if (!part) return null;
        // Capture is armed here, not left to the caller's tree transaction: the relationship is
        // a PACKAGE write that lands before the op naming its rId, and outside a capture frame
        // `recordPutRelationship` has nowhere to record. A peer then received a `w:hyperlink`
        // whose rId resolved to nothing — the link painted inert on every screen but this one.
        return runObservedStoreTransaction(
          packageStore,
          () => {
            const before = currentPackage();
            const ensured = ensureHyperlinkRelationship(before, url, part.name);
            if (!ensured) return null;
            if (ensured.pkg !== before) packageStore.replacePackageShell(ensured.pkg);
            return ensured.relationshipId;
          },
          (relationshipId) => relationshipId !== null
        );
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
        const furnitureParts = furnitureAndNoteParts();

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
              customNodePayloads: customNodePayloadsAcrossStories(),
            });
          }
        } else {
          paragraphOrder = paragraphOrderOfPart(store.part);
          items = derive.collectReviewItems({
            storyPart: store.part,
            furnitureParts,
            commentsPart,
            commentsExtendedPart,
            // Resolved HERE because a payload lives in a customXml data part: the derivation
            // receives story parts, and reaching a package part from one is not something a
            // capability module can do.
            customNodePayloads: customNodePayloadsAcrossStories(),
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
        // EVERY story, and keyed on the PACKAGE revision.
        //
        // The contract asks whether THE DOCUMENT carries review content, and the free tier's
        // upsell hint is the one thing that reads it. Walking the body alone answered `false`
        // for a file whose tracked changes live in a header or a footnote — while
        // `reviewItems` right beside it listed them correctly, so two derivations of one
        // question disagreed. And keying on the body revision meant an accept inside a header
        // moved only `packageRevision`, leaving a stale answer cached behind it.
        const revision = packageStore.packageRevision;
        if (!reviewContentCache || reviewContentCache.revision !== revision) {
          const stories = [bodyStore().part, ...furnitureAndNoteParts()];
          reviewContentCache = {
            revision,
            present: stories.some(
              (part) =>
                collectRevisionSites(part).length > 0 || storyCarriesCommentAnchor(part.root)
            ),
          };
        }
        return reviewContentCache.present;
      },

      replyToComment(parentCommentId, anchor, text, author, date, scope = BODY_SCOPE, actorId) {
        // The story that OWNS the anchor. Resolving a refused scope falls back to the body
        // rather than throwing: the caller's next check is the null return either way.
        const result = addPackageComment(
          packageStore,
          {
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
            ...(actorId === undefined ? {} : { actorId }),
          },
          scope
        );
        return result.ok ? result.commentId : null;
      },

      setCommentResolved(commentId, resolved) {
        const result = setPackageCommentResolved(packageStore, commentId, resolved);
        return result.ok;
      },

      deleteComment(commentId, scope = BODY_SCOPE, noteId) {
        return this.deleteComments([{ commentId }], scope, noteId);
      },

      deleteComments(comments, scope = BODY_SCOPE, noteId) {
        return deletePackageComments(packageStore, comments, scope, noteId);
      },

      insertCustomNode(write, scope = BODY_SCOPE) {
        return insertPackageCustomNode(packageStore, write, scope);
      },

      removeCustomNode(controlNodeId, scope = BODY_SCOPE) {
        return removePackageCustomNode(packageStore, controlNodeId, scope);
      },

      // Capture is armed even though this is not a user intent. The sweep converges on its
      // own — same document, same orphan payloads — but a host whose module list differs from
      // a peer's would otherwise drop a `customXml` item locally and nowhere else.
      sweepCustomNodePayloads(namespaces) {
        return runObservedStoreTransaction(
          packageStore,
          (): CustomNodeSweepOutcome => {
            const store = bodyStore();
            const swept = sweepCustomNodePayloads(
              packageStore.currentPackage(),
              store.part.name,
              namespaces
            );
            // A refusal leaves the document exactly as it arrived, which is the safe half of a
            // sweep that could not run. Reported rather than swallowed: the caller is the open
            // path, and a store that refuses a rewrite will refuse it on every later open too.
            if (!swept.ok) return { ok: false, reason: swept.reason };
            if (swept.removed.length === 0) return { ok: true, removed: [] };
            // NO UNDO ENTRY and no published revision. The sweep is not an edit anyone made: it
            // collects payloads whose controls were already gone when the document arrived, and a
            // user who pressed Ctrl+Z straight after opening a file must not get them back.
            // `replacePackageShell` is the lane for exactly that — a package write that is not a
            // user intent.
            packageStore.replacePackageShell(swept.pkg);
            return { ok: true, removed: swept.removed };
          },
          (outcome) => outcome.ok && outcome.removed.length > 0
        );
      },

      ensureListDefinition(kind) {
        // The numbering part lives on the PACKAGE, not the main-part tree. Definitions are
        // monotonic in-session and persist across lifecycle package undo/redo so story
        // `numId` references cannot go dead. The memoized numbering root is cleared so
        // layout re-reads the definitions this just added.
        // Armed for the same reason as `ensureHyperlinkRelationship`: the part, its
        // relationship and its content-type override are package writes, and a `w:numPr`
        // replicated without them names a definition the peer cannot resolve — the list
        // renders as plain paragraphs there and nothing reports why.
        return runObservedStoreTransaction(
          packageStore,
          () => {
            const ensured = ensureListDefinition(currentPackage(), kind);
            if (!ensured) return null;
            packageStore.replacePackageShell(ensured.pkg);
            numberingRootResolved = false;
            numberingRoot = null;
            return ensured.numId;
          },
          (numId) => numId !== null
        );
      },

      ensureNumberingLevel(numId, level, kind) {
        // Same lane as `ensureListDefinition`: the numbering part lives on the PACKAGE,
        // and the memoized numbering root must forget what it read before this write.
        // The identity check compares the write's output against the SAME `before`
        // instance handed to the write; the `currentPackage()` memo preserves that.
        return runObservedStoreTransaction(
          packageStore,
          () => {
            const before = currentPackage();
            const ensured = ensureNumberingLevel(before, numId, level, kind);
            if (!ensured) return { ok: false, changed: false };
            if (ensured !== before) {
              packageStore.replacePackageShell(ensured);
              numberingRootResolved = false;
              numberingRoot = null;
              return { ok: true, changed: true };
            }
            return { ok: true, changed: false };
          },
          (outcome) => outcome.changed
        ).ok;
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

      deleteImageTracked(scope, drawingNodeId, revision) {
        return packageStore.deleteImageTracked(scope, drawingNodeId, revision);
      },

      applyImageProperties(scope, input) {
        return packageStore.applyImageProperties(scope, input);
      },

      applyFragmentPaste(scope, input) {
        return packageStore.applyFragmentPaste(scope, input);
      },
    },
  };
}

/** The origin a host should use when committing a reconciliation rather than a user edit. */
export const PROJECTION_ORIGIN = ORIGIN_IDS.projection;
