/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The SERVER-SIDE half of the write story: a custom node is plain WordprocessingML, so any
// tool that can splice XML into a document body — a template engine, python-docx, a raw
// zip rewrite — can author one. This builder produces that markup from a definition, with
// the same tag codec and the same locked-by-default contract as `insertCustomNode`, so a
// chip written on a server is recognized identically when the document opens in the editor
// (and rides through Word untouched).
//
// DOM-free and editor-free on purpose: it runs in Node.

import {
  CUSTOM_XML_PROPS_REL,
  CUSTOM_XML_PROPS_TYPE,
  CUSTOM_XML_REL,
  DATASTORE_NAMESPACE_URI,
  customNodeBinding,
  datastoreItemIdFor,
  fnv1a32,
  type CustomNodeBinding,
} from '@docx-editor.dev/core/store';
import { encodeCustomNodeTag, type EncodeTagResult } from './tag-codec.ts';
import {
  CUSTOM_NODE_IDENTITY_PATTERN,
  type AnyCustomNodeDefinition,
  type CustomNodeDefinition,
} from './define-custom-node.ts';
import type { InferSchemaInput, StandardSchemaV1 } from './data-schema.ts';
import { CUSTOM_NODE_STORE_ROOT, customNodeDataFor, customNodeNamespace } from './node-payload.ts';

/**
 * Minimal XML escaping for the attribute and text positions this builder writes, PLUS
 * removal of the control characters XML 1.0 cannot represent at all (U+0000–U+0008,
 * U+000B, U+000C, U+000E–U+001F). Escaped they would still be invalid; passed through
 * they make the assembled document.xml malformed and Word refuses the whole file — a
 * template splicing one stray NUL from a database would silently author a broken
 * document.
 */
function escapeXml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * How {@link customNodeXml} writes the control, for server-side templating where there is no
 * editor instance to insert through.
 *
 * @public
 */
export interface CustomNodeXmlOptions<Schema extends StandardSchemaV1 | undefined = undefined> {
  /** `w:alias` — the human title Word shows on the control. */
  readonly alias?: string;
  /** `w:lock`. Defaults to `contentLocked`, matching `insertCustomNode`. `false` omits it. */
  readonly lock?: false | 'sdtLocked' | 'sdtContentLocked' | 'contentLocked';
  /**
   * `w:id` — Word's own numeric control identity (positive, non-zero). Defaults to a
   * deterministic FNV-1a over the tag and text; pass one to control it. Two IDENTICAL
   * nodes in one document then share an id — Word tolerates this and regenerates on
   * open, but a caller splicing many copies of the same node can pass distinct ids.
   */
  readonly id?: number;
  /**
   * The node's payload — everything past the 64 characters `w:tag` holds.
   *
   * A template engine can splice markup but cannot author a package, so this cannot write the
   * data part itself. It answers the part CONTENTS instead (see {@link CustomNodeXmlStore}) and
   * the caller adds them to the zip it is assembling. The markup and the parts agree by
   * construction: the same `ds:itemID` is minted once and written into both.
   */
  readonly data?: InferSchemaInput<Schema>;
  /**
   * Which `/customXml/itemN.xml` this store claims. Defaults to 1.
   *
   * A caller splicing into a template that ALREADY carries a store — Word's Cover Page
   * Properties rides in most of them — has to pick a free index, and only the caller can see
   * the package to know which one is free.
   */
  readonly storeIndex?: number;
  /**
   * The node's id inside the store, which the binding's xpath quotes. Defaults to `cx1`.
   *
   * Splicing several nodes into one document means several ids: two nodes sharing one makes
   * the xpath ambiguous, and Word resolves an ambiguous xpath to the first match — so the
   * second chip would paint the first one's text forever.
   */
  readonly nodeId?: string;
}

/**
 * The package a spliced payload needs, as parts a caller adds to the zip it is assembling.
 *
 * Everything here is required. A control carrying a `w:dataBinding` whose store is missing is a
 * document Word opens and offers to repair, and repairing it throws the control away.
 *
 * @public
 */
export interface CustomNodeXmlStore {
  /** `/customXml/itemN.xml` — the payload itself. Rides the package's `xml` content-type default. */
  readonly itemPartName: string;
  readonly itemXml: string;
  /** `/customXml/itemPropsN.xml` — carries the `ds:itemID` the binding quotes. */
  readonly propsPartName: string;
  readonly propsXml: string;
  /** The `ds:itemID`, which is also the `w:storeItemID` already written into the markup. */
  readonly storeItemId: string;
  /** Relationships the caller must declare, each from the part named to the target named. */
  readonly relationships: readonly {
    readonly from: string;
    readonly type: string;
    readonly target: string;
  }[];
  /** The content-type Override the properties part needs. `itemN.xml` needs none. */
  readonly contentTypeOverride: { readonly partName: string; readonly contentType: string };
}

/**
 * What {@link customNodeXml} answers: the `w:sdt` markup, or a refusal.
 *
 * Refuses exactly what `insertCustomNode` refuses — chiefly the 64-character `w:tag` cap — so a
 * server cannot author a chip the editor itself would not have accepted.
 *
 * @public
 */
export type CustomNodeXmlResult =
  | {
      readonly ok: true;
      readonly xml: string;
      /** Present only when `data` was given. Absent means the node carries no payload. */
      readonly store?: CustomNodeXmlStore;
    }
  | { readonly ok: false; readonly code: 'invalidArgs'; readonly reason: string };

/**
 * The run-level `w:sdt` markup for one custom node, ready to splice between runs inside a
 * `w:p` (the `w` prefix must be bound to the WordprocessingML main namespace, as it is in
 * every `word/document.xml`).
 *
 * Refuses the same inputs `insertCustomNode` refuses (the 64-character `w:tag` cap), so a
 * server cannot author a chip the editor would not have.
 *
 * ```ts
 * const sdt = customNodeXml(citation, { sourceId: 'src_9f3' }, '(Smith 2024)');
 * if (sdt.ok) template.replace('{{citation}}', sdt.xml);
 * ```
 */
export function customNodeXml<Schema extends StandardSchemaV1 | undefined = undefined>(
  definition: CustomNodeDefinition<Schema>,
  attrs: Readonly<Record<string, string>>,
  text: string,
  options: CustomNodeXmlOptions<Schema> = {}
): CustomNodeXmlResult {
  // The identity charset `defineCustomNode` enforces, re-checked because this function is
  // structurally typed and a raw object would otherwise reach the tag codec, where `:` and
  // `?` are structural.
  if (
    !CUSTOM_NODE_IDENTITY_PATTERN.test(definition.tagPrefix) ||
    !CUSTOM_NODE_IDENTITY_PATTERN.test(definition.name)
  ) {
    return {
      ok: false,
      code: 'invalidArgs',
      reason: 'the definition identity must match defineCustomNode’s charset ([A-Za-z0-9_.-])',
    };
  }
  const encoded: EncodeTagResult = encodeCustomNodeTag(
    definition.tagPrefix,
    definition.name,
    attrs
  );
  if (!encoded.ok) {
    return {
      ok: false,
      code: 'invalidArgs',
      reason: `the encoded tag is ${encoded.length} characters; Word caps w:tag at 64 — shorten the attrs`,
    };
  }
  const lock = options.lock === undefined ? 'contentLocked' : options.lock;
  // Word writes `w:id` on every control it authors, and Word Online DROPS an id-less
  // control on resave — a chip authored without one silently vanished on a cloud
  // round-trip. Deterministic by default so a rebuilt template is byte-stable.
  const wordId =
    options.id !== undefined && Number.isInteger(options.id) && options.id > 0
      ? options.id
      : fnv1a32(`${encoded.tag} ${text}`) & 0x7fffffff || 1;

  const payload = options.data === undefined ? null : buildStore(definition, options, text);
  if (payload && 'reason' in payload) {
    return { ok: false, code: 'invalidArgs', reason: payload.reason };
  }

  // CT_SdtPr is a schema-ordered sequence: alias, tag, id, lock, dataBinding. Out of order Word
  // refuses the whole document rather than ignoring the element.
  const properties =
    (options.alias !== undefined ? `<w:alias w:val="${escapeXml(options.alias)}"/>` : '') +
    `<w:tag w:val="${escapeXml(encoded.tag)}"/>` +
    `<w:id w:val="${wordId}"/>` +
    (lock === false ? '' : `<w:lock w:val="${lock}"/>`) +
    (payload
      ? `<w:dataBinding w:prefixMappings="${escapeXml(payload.binding.prefixMappings)}"` +
        ` w:xpath="${escapeXml(payload.binding.xpath)}"` +
        ` w:storeItemID="${escapeXml(payload.binding.storeItemId)}"/>`
      : '');
  const content = `<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
  return {
    ok: true,
    xml: `<w:sdt><w:sdtPr>${properties}</w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`,
    ...(payload ? { store: payload.store } : {}),
  };
}

/**
 * The store parts and the binding that names them, minted together.
 *
 * TOGETHER is the point: the `ds:itemID` in `itemPropsN.xml` and the `w:storeItemID` in the
 * markup are the only link between the body and the payload, and deriving each separately is
 * how the two come to disagree.
 */
function buildStore(
  definition: AnyCustomNodeDefinition,
  options: CustomNodeXmlOptions<StandardSchemaV1 | undefined>,
  label: string
):
  | { readonly binding: CustomNodeBinding; readonly store: CustomNodeXmlStore }
  | { readonly reason: string } {
  const data = customNodeDataFor(definition, options.data);
  if (!data.ok) return { reason: data.reason };
  const namespaceUri = customNodeNamespace(definition);
  const index =
    options.storeIndex !== undefined &&
    Number.isInteger(options.storeIndex) &&
    options.storeIndex > 0
      ? options.storeIndex
      : 1;
  const nodeId = options.nodeId ?? 'cx1';
  const itemPartName = `/customXml/item${String(index)}.xml`;
  const propsPartName = `/customXml/itemProps${String(index)}.xml`;
  // The SAME derivation the in-package writer uses, seeded from what a splice can actually see.
  // A template has no document identity to fold in, so a caller assembling several documents
  // from one template and pasting between them should let the editor author the store instead:
  // Word's data store dedupes on this GUID.
  const storeItemId = datastoreItemIdFor(`${namespaceUri} ${itemPartName} ${nodeId}`);
  const binding = customNodeBinding(
    { partName: itemPartName, propsPartName, itemId: storeItemId, namespaceUri },
    CUSTOM_NODE_STORE_ROOT,
    nodeId
  );
  if (!binding) {
    return {
      reason: `the payload cannot be addressed by an XPath: check nodeId (${nodeId}) and payloadNamespace`,
    };
  }
  // `xml:space` on the label, because a binding supplies the control's text verbatim and a
  // reader is otherwise entitled to normalize the edges away.
  const labelXml =
    label === label.trim()
      ? `<label>${escapeXml(label)}</label>`
      : `<label xml:space="preserve">${escapeXml(label)}</label>`;
  return {
    binding,
    store: {
      itemPartName,
      itemXml:
        `<${CUSTOM_NODE_STORE_ROOT} xmlns="${escapeXml(namespaceUri)}">` +
        `<node id="${escapeXml(nodeId)}">${labelXml}<data>${escapeXml(data.data)}</data></node>` +
        `</${CUSTOM_NODE_STORE_ROOT}>`,
      propsPartName,
      propsXml:
        `<ds:datastoreItem ds:itemID="${escapeXml(storeItemId)}" xmlns:ds="${DATASTORE_NAMESPACE_URI}">` +
        `<ds:schemaRefs><ds:schemaRef ds:uri="${escapeXml(namespaceUri)}"/></ds:schemaRefs>` +
        '</ds:datastoreItem>',
      storeItemId,
      relationships: [
        // Relative to the STORY's own directory, which is where `word/document.xml` sits.
        {
          from: '/word/document.xml',
          type: CUSTOM_XML_REL,
          target: `../customXml/item${String(index)}.xml`,
        },
        { from: itemPartName, type: CUSTOM_XML_PROPS_REL, target: `itemProps${String(index)}.xml` },
      ],
      contentTypeOverride: { partName: propsPartName, contentType: CUSTOM_XML_PROPS_TYPE },
    },
  };
}
