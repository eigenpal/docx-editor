import {
  findNode,
  replaceNode,
  withPart,
  writeOoxmlPackage,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPackage,
  type OoxmlPart,
} from '../store/package/index.ts';
import { WML_NAMESPACE_URI, XML_NAMESPACE_URI } from '../store/package/ooxml-shared.ts';
import { paragraphTextOf } from '../store/store/tree-op-apply.ts';
import {
  createParagraphAddressResolver,
  isStoryPart,
  paragraphSnapshot,
} from './paragraph-addresses.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';
import { TreePackageStore, type StoryScope } from '../store/store/tree-package-store.ts';
import type {
  CollaborationApplyResult,
  CollaborationDocumentPort,
  CollaborationMutation,
  CollaborationParagraph,
  CollaborationParagraphTextUpdate,
} from './index.ts';
import {
  flushPendingCanonicalJournals,
  observeCanonicalPrimitiveJournal,
  storeHasPendingCanonicalJournals,
  type CanonicalPrimitiveJournal,
} from './primitive-journal.ts';
import type { TreeModelChange } from '../store/store/tree-store.ts';

const BODY: StoryScope = Object.freeze({ kind: 'body' });
const MAX_COLLABORATIVE_PARAGRAPH_TEXT = 1_000_000;

/** Options for a canonical collaboration document port. @public */
export interface CreateCollaborationDocumentPortOptions {
  readonly documentId: string;
}

function splitsSurrogate(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return false;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}

function replacementOps(nodeId: string, current: string, next: string): readonly TreeDocOp[] {
  if (current === next) return [];
  let prefix = 0;
  const shared = Math.min(current.length, next.length);
  while (prefix < shared && current.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix += 1;
  while (prefix > 0 && (splitsSurrogate(current, prefix) || splitsSurrogate(next, prefix))) {
    prefix -= 1;
  }

  let suffix = 0;
  while (
    suffix < current.length - prefix &&
    suffix < next.length - prefix &&
    current.charCodeAt(current.length - suffix - 1) === next.charCodeAt(next.length - suffix - 1)
  ) {
    suffix += 1;
  }
  while (
    suffix > 0 &&
    (splitsSurrogate(current, current.length - suffix) ||
      splitsSurrogate(next, next.length - suffix))
  ) {
    suffix -= 1;
  }

  const deleteCount = current.length - prefix - suffix;
  const inserted = next.slice(prefix, next.length - suffix);
  const ops: TreeDocOp[] = [];
  if (deleteCount > 0) {
    ops.push({
      op: 'deleteText',
      paragraphId: nodeId,
      start: prefix,
      end: prefix + deleteCount,
    });
  }
  if (inserted.length > 0) {
    ops.push({ op: 'insertText', paragraphId: nodeId, offset: prefix, text: inserted });
  }
  return Object.freeze(ops);
}

function mergeRunTextChildren(children: readonly OoxmlNode[]): readonly OoxmlNode[] {
  const mergeable = (node: OoxmlNode | undefined): node is OoxmlElement =>
    !!node &&
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    node.localName === 't' &&
    node.attributes.every(
      (attribute) => attribute.namespaceUri === XML_NAMESPACE_URI && attribute.localName === 'space'
    ) &&
    node.children.every((child) => child.kind === 'textValue');
  const merged: OoxmlNode[] = [];
  for (const child of children) {
    const previous = merged.at(-1);
    if (!mergeable(previous) || !mergeable(child)) {
      merged.push(child);
      continue;
    }
    const value =
      previous.children.map((node) => (node.kind === 'textValue' ? node.value : '')).join('') +
      child.children.map((node) => (node.kind === 'textValue' ? node.value : '')).join('');
    merged[merged.length - 1] = {
      ...previous,
      attributes: /^\s|\s$/.test(value)
        ? [
            {
              kind: 'xmlSpace',
              namespaceUri: XML_NAMESPACE_URI,
              localName: 'space',
              prefix: 'xml',
              value: 'preserve',
            },
          ]
        : [],
      children: [
        {
          id: previous.children[0]?.id ?? `${previous.id}/text`,
          kind: 'textValue',
          value,
        },
      ],
    } as OoxmlNode;
  }
  return merged;
}

function normalizeParagraphTextNodes(node: OoxmlNode): OoxmlNode {
  if (node.kind === 'textValue') return node;
  let changed = false;
  let children = node.children.map((child) => {
    const next = normalizeParagraphTextNodes(child);
    if (next !== child) changed = true;
    return next;
  });
  if (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'r') {
    const merged = mergeRunTextChildren(children);
    if (
      merged.length !== children.length ||
      merged.some((child, index) => child !== children[index])
    ) {
      children = [...merged];
      changed = true;
    }
  }
  return changed ? ({ ...node, children } as OoxmlNode) : node;
}

/** Normalize supported text edits inside their existing canonical transaction. */
export function normalizeCollaborationTextPackage(
  pkg: OoxmlPackage,
  partName: string,
  ops: readonly TreeDocOp[]
): OoxmlPackage {
  let part = pkg.parts.get(partName);
  if (!part) return pkg;
  let changed = false;
  const paragraphIds = new Set<string>();
  for (const op of ops) {
    if ((op.op === 'insertText' || op.op === 'deleteText') && !op.revision) {
      paragraphIds.add(op.paragraphId);
    }
  }
  for (const paragraphId of paragraphIds) {
    const paragraph = findNode(part, paragraphId);
    if (!paragraph || paragraph.kind === 'textValue') continue;
    const normalized = normalizeParagraphTextNodes(paragraph);
    if (normalized === paragraph) continue;
    const edited = replaceNode(part, paragraphId, normalized, { deferValidation: true });
    if (!edited.ok) continue;
    part = edited.part;
    changed = true;
  }
  return changed ? withPart(pkg, part) : pkg;
}

/** Create the narrow collaboration view over one canonical package store. @public */
export function createCollaborationDocumentPort(
  store: TreePackageStore,
  options: CreateCollaborationDocumentPortOptions
): CollaborationDocumentPort {
  const documentId = options.documentId.trim();
  if (documentId.length === 0 || documentId.length > 256) {
    throw new TypeError('documentId must contain 1 to 256 characters');
  }

  const paragraphs = (): readonly CollaborationParagraph[] =>
    paragraphSnapshot(store.bodyStore().part);

  /**
   * Story parts presence may name, body first.
   *
   * Memoized on the package and body part by identity, not on the revision, so a caret move
   * allocates nothing. `currentPackage()` is itself identity-memoized, so an unchanged
   * document returns the same tuple.
   */
  let storyPartsMemo:
    | { readonly pkg: OoxmlPackage; readonly body: OoxmlPart; readonly parts: readonly OoxmlPart[] }
    | undefined;

  const storyParts = (): readonly OoxmlPart[] => {
    const body = store.bodyStore().part;
    const pkg = store.currentPackage();
    if (storyPartsMemo?.pkg === pkg && storyPartsMemo.body === body) return storyPartsMemo.parts;
    const parts: OoxmlPart[] = [body];
    for (const part of pkg.parts.values()) {
      if (part === body || !isStoryPart(part)) continue;
      parts.push(part);
    }
    storyPartsMemo = { pkg, body, parts: Object.freeze(parts) };
    return storyPartsMemo.parts;
  };

  const resolveAddress = createParagraphAddressResolver(storyParts);

  const applyParagraphTexts = (
    updates: readonly CollaborationParagraphTextUpdate[],
    mutation: CollaborationMutation
  ): CollaborationApplyResult => {
    if (updates.length === 0) return { ok: true, changed: false };
    const snapshot = paragraphs();
    const seen = new Set<string>();
    const ops: TreeDocOp[] = [];
    for (const update of updates) {
      if (
        typeof update.text !== 'string' ||
        update.text.length > MAX_COLLABORATIVE_PARAGRAPH_TEXT
      ) {
        return { ok: false as const, reason: 'collaboration-text-limit' };
      }
      const paragraphId = update.paragraphId.toUpperCase();
      if (seen.has(paragraphId)) {
        return { ok: false as const, reason: 'duplicate-paragraph-id' };
      }
      seen.add(paragraphId);
      const candidates = snapshot.filter((paragraph) => paragraph.paragraphId === paragraphId);
      if (candidates.length !== 1) {
        return { ok: false as const, reason: 'unknown-paragraph-id' };
      }
      const paragraph = candidates[0]!;
      ops.push(...replacementOps(paragraph.nodeId, paragraph.text, update.text));
    }
    if (ops.length === 0) return { ok: true, changed: false };
    const result = store.transact(
      BODY,
      (context) => {
        for (const op of ops) context.apply(op);
        context.applyPackage((pkg) =>
          normalizeCollaborationTextPackage(pkg, pkg.mainDocumentPart, ops)
        );
      },
      {
        origin: mutation.origin,
        actorId: mutation.actorId,
        operationId: mutation.operationId,
        recordsHistory: false,
      }
    );
    return result.ok
      ? { ok: true as const, changed: result.change !== null }
      : { ok: false as const, reason: result.detail ?? result.reason };
  };

  const port = {
    documentId,
    paragraphs,
    paragraphByNodeId(nodeId: string) {
      return paragraphs().find((paragraph) => paragraph.nodeId === nodeId) ?? null;
    },
    paragraphByStableId(paragraphId: string) {
      const stableId = paragraphId.toUpperCase();
      const address = resolveAddress(stableId);
      if (!address) return null;
      const text = paragraphTextOf(address.part, address.nodeId);
      if (text === null) return null;
      return Object.freeze({ paragraphId: stableId, nodeId: address.nodeId, text });
    },
    applyParagraphText(
      paragraphId: string,
      text: string,
      mutation: CollaborationMutation
    ): CollaborationApplyResult {
      return applyParagraphTexts([{ paragraphId, text }], mutation);
    },
    applyParagraphTexts,
    applyRemotePackage(
      pkg: OoxmlPackage,
      mutation: CollaborationMutation
    ): CollaborationApplyResult {
      const result = store.publishRemotePackage(pkg, mutation);
      return result.ok
        ? { ok: true as const, changed: result.change !== null }
        : { ok: false as const, reason: result.detail ?? result.reason };
    },
    revision: () => store.packageRevision,
    subscribe: (listener: (change: TreeModelChange) => void) => store.subscribe(listener),
    observePrimitiveJournal: (listener: (journal: CanonicalPrimitiveJournal) => void) =>
      observeCanonicalPrimitiveJournal(store, listener),
    hasPendingJournals: () => storeHasPendingCanonicalJournals(store),
    flushPendingJournals: () => {
      flushPendingCanonicalJournals(store);
    },
    save: () => writeOoxmlPackage(store.currentPackage()),
    binaryPart(storageKey: string): Uint8Array | null {
      const pkg = store.currentPackage();
      return (
        pkg.partBytes.get(storageKey) ??
        pkg.partBytes.get(storageKey.startsWith('/') ? storageKey.slice(1) : `/${storageKey}`) ??
        null
      );
    },
  };
  return Object.freeze(port);
}
