// Authoring a custom node that carries a payload, and taking one back.
//
// ONE TRANSACTION, three writes: the customXml data part (created if the document has none for
// the namespace), the node inside it, and the `w:sdt` in the body whose `w:dataBinding` names
// that node. Partial application is the failure this must not have — a control bound to a store
// that was never written is a document Word offers to repair, and repairing it means throwing
// the control away.
//
// The order is deliberate. The store goes in first, so the id the binding quotes is one the
// package already holds by the time the body references it; the body edit is last, so a refusal
// anywhere (a locked paragraph, an offset out of range, a protected document) abandons the store
// write with it rather than leaving a payload nothing points at.
//
// WHY THE STORE IS THE SOURCE OF TRUTH. A bound control with no type child is read-only in Word:
// the text is painted from the xpath and a user cannot type into it (verified,
// `sdt-custom-node-databinding-word-roundtrip.docx`). This engine refuses content edits inside a
// bound control for its own reasons — see `contentControlBindingRefusal` — so the two agree. The
// page and the payload cannot drift, and nothing here has to reconcile them.

import {
  boundCustomXmlNodeIdOf,
  boundCustomXmlNodeIds,
  customNodeBinding,
} from '../package/custom-node-payloads.ts';
import {
  customXmlNodes,
  withCustomXmlNode,
  withoutCustomXmlNode,
  withoutOrphanCustomXmlNodes,
} from '../package/custom-xml-nodes.ts';
import {
  customXmlDataParts,
  findCustomXmlDataPart,
  withCustomXmlDataPart,
} from '../package/custom-xml-part.ts';
import { contentControlsIn } from '../package/content-control-nodes.ts';
import type { OoxmlPackage } from '../package/ooxml-package.ts';
import type { TreeDocumentStore, TreeModelChange } from './tree-store.ts';
import type { TreeOpRejection } from './tree-op-validate.ts';

/**
 * The payload half of an insert: which store, which node, and what it holds.
 *
 * `data` is opaque here. The lane that owns a schema is the one that declared it, and a store
 * that parsed payloads would be a second opinion about what a host's node means.
 */
export interface CustomNodePayloadWrite {
  /** Namespace of the store's root element — what identifies one store among several. */
  readonly namespaceUri: string;
  /** Local name of that root. An NCName; anything else refuses. */
  readonly rootLocalName: string;
  /** The node's own id, which the binding's xpath quotes. */
  readonly nodeId: string;
  /** The text the control shows. Word paints this from the store, so an empty one is an empty chip. */
  readonly label: string;
  /** The payload, serialized. JSON by convention; never parsed here. */
  readonly data: string;
}

/** Where the control goes, what it says, and the payload it carries. */
export interface InsertCustomNodeWrite {
  readonly paragraphId: string;
  readonly offset: number;
  /**
   * Wrap rather than insert: the text from `offset` to here is removed first.
   *
   * The node's label REPLACES the words it covered, because that is what turning a stretch of a
   * sentence into a citation means. Removed inside the same transaction, so a refused insert
   * leaves the text where it was.
   */
  readonly replaceUntil?: number;
  readonly tag: string;
  readonly text: string;
  readonly alias?: string;
  /** Defaults to none. Callers that want Word's own "cannot type into it" pass `contentLocked`. */
  readonly lock?: 'sdtLocked' | 'sdtContentLocked' | 'contentLocked';
  /** Omitted authors an ordinary tagged control with no store — the pre-payload behaviour. */
  readonly payload?: CustomNodePayloadWrite;
}

/**
 * Why a payload write was refused.
 *
 * The tree rejections pass through unchanged, so a locked paragraph refuses a bound insert for
 * the same named reason it refuses a plain one. The three added here are the payload's own.
 */
export type CustomNodeWriteRejection =
  | TreeOpRejection
  /** The id, root name or namespace cannot be spelled in an XPath, so no binding could name it. */
  | 'unaddressable-payload'
  /** The store could not be authored — see `withCustomXmlDataPart` for every way that happens. */
  | 'store-not-authored'
  /** The payload or the label is past the cap. */
  | 'payload-too-large';

export type CustomNodeWriteResult =
  | { readonly ok: true; readonly change: TreeModelChange | null }
  | { readonly ok: false; readonly reason: CustomNodeWriteRejection; readonly detail?: string };

/**
 * The largest payload one node may carry, in UTF-16 code units.
 *
 * Same figure as the read side's (`parseCustomNodeData`) and for the same reason: far past any
 * legitimate chip, far short of anything that hurts. Checked on the WRITE too, so a document
 * cannot be authored here holding a payload the reader will later refuse to parse.
 */
export const MAX_CUSTOM_NODE_PAYLOAD_LENGTH = 256 * 1024;

/** The longest label a binding may paint. Word renders it as the control's whole content. */
export const MAX_CUSTOM_NODE_LABEL_LENGTH = 4_096;

/**
 * Insert one custom node, with its payload, as a single transaction.
 *
 * Answers the store transaction's own change so the caller can publish it — a payload write is a
 * package write reaching through a story store, exactly as a comment is, and the coordinator
 * needs the change to know which paragraphs went dirty.
 */
export function insertCustomNodeWrite(
  store: TreeDocumentStore,
  write: InsertCustomNodeWrite
): CustomNodeWriteResult {
  const payload = write.payload;
  const storyPartName = store.part.name;

  if (payload) {
    if (payload.data.length > MAX_CUSTOM_NODE_PAYLOAD_LENGTH) {
      return { ok: false, reason: 'payload-too-large', detail: 'data' };
    }
    if (payload.label.length > MAX_CUSTOM_NODE_LABEL_LENGTH) {
      return { ok: false, reason: 'payload-too-large', detail: 'label' };
    }
  }

  // Set inside the transaction and read after it: the store's `ds:itemID` is not known until the
  // part is authored, and the binding cannot be built without it.
  let refusal: CustomNodeWriteRejection | null = null;

  const result = store.transact((ctx) => {
    // The replaced text goes first, so the offsets the caller supplied still describe the
    // paragraph when the deletion is planned against it.
    const replaced = write.replaceUntil;
    if (replaced !== undefined && replaced > write.offset) {
      ctx.apply({
        op: 'deleteText',
        paragraphId: write.paragraphId,
        start: write.offset,
        end: replaced,
      });
    }
    if (!payload) {
      ctx.apply({
        op: 'insertInlineContentControl',
        paragraphId: write.paragraphId,
        offset: write.offset,
        tag: write.tag,
        text: write.text,
        ...(write.alias === undefined ? {} : { alias: write.alias }),
        ...(write.lock === undefined ? {} : { lock: write.lock }),
      });
      return;
    }

    let binding: ReturnType<typeof customNodeBinding> = null;
    // THE STORE FIRST. Everything the binding quotes has to exist in the package before the body
    // names it, so a transaction that dies at the body edit takes an unreferenced store with it
    // rather than leaving one behind.
    ctx.applyPackage((current) => {
      const authored = withCustomXmlDataPart(
        current,
        storyPartName,
        payload.namespaceUri,
        payload.rootLocalName
      );
      if (!authored.part) {
        refusal = 'store-not-authored';
        return current;
      }
      binding = customNodeBinding(authored.part, payload.rootLocalName, payload.nodeId);
      if (!binding) {
        refusal = 'unaddressable-payload';
        return current;
      }
      return withCustomXmlNode(authored.pkg, authored.part.partName, {
        id: payload.nodeId,
        label: payload.label,
        data: payload.data,
      });
    });
    if (refusal !== null || !binding) return;

    ctx.apply({
      op: 'insertInlineContentControl',
      paragraphId: write.paragraphId,
      offset: write.offset,
      tag: write.tag,
      text: write.text,
      ...(write.alias === undefined ? {} : { alias: write.alias }),
      ...(write.lock === undefined ? {} : { lock: write.lock }),
      dataBinding: binding,
    });
  });

  // The payload's own refusal wins over the transaction's outcome: `applyPackage` returning the
  // package unchanged is not a rejection the store reports, so without this a refused store write
  // would come back as a successful no-op — a caller told its node was written when it was not.
  if (refusal !== null) {
    return { ok: false, reason: refusal };
  }
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
      ...(result.detail === undefined ? {} : { detail: result.detail }),
    };
  }
  return { ok: true, change: result.change };
}

/**
 * Remove a control and, in the same transaction, the payload it bound.
 *
 * The sweep would collect the node eventually — that is what makes deletion in Word survivable —
 * but "eventually" is the next open, and a document saved in between carries a payload for a
 * chip that is gone. Doing it here means the ordinary case is exact and the sweep is a backstop.
 */
export function removeCustomNodeWrite(
  store: TreeDocumentStore,
  controlNodeId: string
): CustomNodeWriteResult {
  const storyPartName = store.part.name;
  const control = contentControlsIn(store.part.root).find(
    (entry) => entry.node.id === controlNodeId
  );
  // Which store and node this control binds, resolved BEFORE the removal: afterwards the control
  // is gone and nothing says what it pointed at.
  const bound: { readonly partName: string; readonly nodeId: string }[] = [];
  if (control) {
    for (const dataPart of customXmlDataParts(store.package, storyPartName)) {
      const nodeId = boundCustomXmlNodeIdOf(control.node, dataPart.itemId);
      if (nodeId !== null) bound.push({ partName: dataPart.partName, nodeId });
    }
  }

  const result = store.transact((ctx) => {
    ctx.apply({ op: 'removeContentControl', controlId: controlNodeId, keepContent: false });
    for (const entry of bound) {
      ctx.applyPackage((current) => withoutCustomXmlNode(current, entry.partName, entry.nodeId));
    }
  });
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
      ...(result.detail === undefined ? {} : { detail: result.detail }),
    };
  }
  return { ok: true, change: result.change };
}

/** What one sweep collected, per store. */
export interface CustomNodeSweepResult {
  readonly pkg: OoxmlPackage;
  /** Node ids removed, across every store swept. Empty means the document was already tidy. */
  readonly removed: readonly string[];
}

/**
 * Drop every payload no control binds, in the stores whose namespaces a host claims.
 *
 * ON OPEN, NOT ON SAVE. A chip cut to the clipboard is unbound for as long as it sits there, so a
 * save mid-cut would destroy the payload the user is about to paste. On open the only unbound
 * nodes are ones a control genuinely lost — deleted here, or deleted in Word, which is the case
 * nothing else can collect.
 *
 * `namespaces` is the claim, and it is what keeps this off other people's stores: Word's own Cover
 * Page Properties store rides in most templates, and a sweep that walked every customXml part
 * would be deleting from it on the strength of a name collision.
 */
export function sweepCustomNodePayloads(
  pkg: OoxmlPackage,
  storyPartName: string,
  namespaces: readonly string[]
): CustomNodeSweepResult {
  const story = pkg.parts.get(storyPartName);
  if (!story || namespaces.length === 0) return { pkg, removed: [] };
  let next = pkg;
  const removed: string[] = [];
  for (const namespaceUri of namespaces) {
    const dataPart = findCustomXmlDataPart(next, storyPartName, namespaceUri);
    if (!dataPart) continue;
    const referenced = boundCustomXmlNodeIds(story, dataPart.itemId);
    const swept = withoutOrphanCustomXmlNodes(next, dataPart.partName, referenced);
    next = swept.pkg;
    removed.push(...swept.removed);
  }
  return { pkg: next, removed };
}

/** Every payload one store holds, for a caller resolving a control's `data`. */
export function customNodePayloadsOf(
  pkg: OoxmlPackage,
  storyPartName: string,
  namespaceUri: string
): ReadonlyMap<string, { readonly label: string; readonly data: string }> {
  const found = new Map<string, { readonly label: string; readonly data: string }>();
  const dataPart = findCustomXmlDataPart(pkg, storyPartName, namespaceUri);
  if (!dataPart) return found;
  for (const node of customXmlNodes(pkg, dataPart.partName)) {
    found.set(node.id, { label: node.label, data: node.data });
  }
  return found;
}
