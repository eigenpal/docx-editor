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
  withPart,
  writeOoxmlPackage,
  type OoxmlPackage,
  type OoxmlPackageRejection,
  type TreeModelChange,
} from '@docx-editor.dev/engine-core';
import { bodyParagraphs, docToTreeOps, reconcileDoc, treeToDoc } from './tree-binding.ts';
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
  undo(): boolean;
  redo(): boolean;
  beginComposition(): void;
  endComposition(): void;
  subscribe(onChange: (change: TreeModelChange) => void): () => void;
  /** Serialize the whole package back to DOCX bytes. */
  save(): Uint8Array;
}

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
  let lastChange: TreeModelChange | null = null;
  store.subscribe((change) => {
    lastChange = change;
  });

  const currentPackage = (): OoxmlPackage => withPart(pkg, store.part);

  return {
    ok: true,
    session: {
      // A body with paragraphs is editable. There is no per-block gate, because the
      // conditions the legacy gate tested — captured source range, fully-captured slice,
      // projectable runs — are all properties of the byte-range model, not of the document.
      editable: bodyParagraphs(store.part).length > 0,

      paragraphIds: () => bodyParagraphs(store.part).map((paragraph) => paragraph.id),

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
      undo: () => store.undo() !== null,
      redo: () => store.redo() !== null,
      beginComposition: () => store.beginComposition(),
      endComposition: () => store.endComposition(),

      subscribe(onChange) {
        return store.subscribe(onChange);
      },

      save() {
        pkg = currentPackage();
        return writeOoxmlPackage(pkg);
      },
    },
  };
}

/** Paragraph text joined by newlines, read from the projection of the canonical tree. */
function projectedText(store: TreeDocumentStore): string {
  const doc = treeToDoc(store.part);
  const lines: string[] = [];
  doc.forEach((paragraph) => lines.push(paragraph.textContent));
  return lines.join('\n');
}

/** The origin a host should use when committing a reconciliation rather than a user edit. */
export const PROJECTION_ORIGIN = ORIGIN_IDS.projection;
