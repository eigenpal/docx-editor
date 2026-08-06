/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `defineCustomNode` — integrator-defined inline nodes anchored on run-level
// SDTs with `w:tag` identity (pro-review-and-custom-nodes, D5–D7).
//
// This module is the RECOGNITION half of the contract: definitions, the module
// registration, and the pass that turns a document's inline SDTs into typed,
// recognized nodes. The write side (`toDocx` through a new store op), the chip
// render/extent contract, and interaction dispatch land on the same seam in the
// change's remaining tasks — a document recognized today renders its SDT
// content literally, which is also the free tier's and Word's fallback.

import type { EditorModule } from '@docx-editor.dev/core/editor';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '@docx-editor.dev/core/store';
import { rememberLicenseKey, type ProLicenseOptions } from '../license.ts';
import { decodeCustomNodeTag } from './tag-codec.ts';
import { customNodeNamespace } from './node-payload.ts';
import { parseCustomNodeData, type StandardSchemaV1 } from './data-schema.ts';

/** A recognized custom node: one inline SDT whose tag matched a definition. */
export interface RecognizedCustomNode {
  /** The definition's `name`. */
  readonly name: string;
  /** Attrs after the definition's `fromDocx` had its say. Untrusted input. */
  readonly attrs: Readonly<Record<string, string>>;
  /** The SDT's literal content text — what Word users see and may have edited. */
  readonly text: string;
  /** The SDT node's stable id in the canonical tree. */
  readonly nodeId: string;
  /** The raw `w:tag` the node was recognized from. */
  readonly tag: string;
  /**
   * The payload the node's control binds to, validated against the definition's `schema`.
   *
   * `undefined` when the node carries none, when the binding named a store node the document
   * does not hold, or when the payload failed its schema — the last of which is reported
   * through {@link customNodesModule}'s `onDiagnostic` rather than swallowed. A chip that
   * vanished because one field was wrong would be worse than a chip with no data.
   *
   * With a schema declared this is that schema's output type; without one it is whatever JSON
   * the file held, which is the honest description of an unchecked payload.
   */
  readonly data?: unknown;
}

/** A payload as the store holds it, before any schema has looked at it. Untrusted file input. */
export interface CustomNodePayloadSource {
  readonly nodeId: string;
  readonly label: string;
  readonly data: string;
}

/**
 * Something worth telling an integrator about a document, which is never worth throwing over.
 *
 * A payload arrives from a file the sender wrote, so "it did not match the schema" is an
 * ordinary property of an ordinary document — not an exception. It is reported and the node
 * still renders.
 */
export interface CustomNodeDiagnostic {
  readonly code: 'payload-invalid';
  /** The definition whose schema refused it. */
  readonly name: string;
  /** The control's canonical node id, so a host can locate it. */
  readonly nodeId: string;
  /** Human-readable, one per failing field. Never rendered as markup by this package. */
  readonly issues: readonly string[];
}

/**
 * One integrator-defined inline node, anchored on a run-level SDT whose `w:tag` carries its
 * identity.
 *
 * A definition claims a tag PREFIX, so `acme` recognizes every `acme:*` tag. An SDT whose prefix
 * no definition claims stays literal — which is also what the free tier and Word itself render,
 * so an unrecognized node never loses content or locks editing.
 *
 * Build one with {@link defineCustomNode}, which validates the shape, then register it through
 * {@link customNodesModule}.
 *
 * @example
 * ```ts
 * const citation = defineCustomNode({
 *   name: 'citation',
 *   tagPrefix: 'acme',
 *   chrome: { color: '#2563eb' },
 *   onClick: (node) => openCitation(node.attrs.key),
 * });
 * ```
 *
 * @public
 */
export interface CustomNodeDefinition {
  /** Node type name — the second segment of the tag (`<prefix>:<name>?…`). */
  readonly name: string;
  /** Tag prefix this definition claims (`acme` claims `acme:*`). No colons. */
  readonly tagPrefix: string;
  /**
   * Recognition hook. Receives the decoded attrs and the SDT's literal text
   * (so label drift from Word edits is visible) and returns the attrs the node
   * should carry — or null to leave this SDT unrecognized and literal.
   *
   * Every input value originates in a file an attacker controls; treat it as
   * untrusted and never build DOM or URLs from it without sanitizing.
   */
  readonly fromDocx?: (input: {
    readonly attrs: Readonly<Record<string, string>>;
    readonly text: string;
    /** The bound payload, through `schema`. Undefined when there is none or it did not match. */
    readonly data?: unknown;
  }) => Readonly<Record<string, string>> | null;
  /**
   * Chip appearance, HOST-authored (never file data). `color` tints the chip
   * and its border; applied by `CustomNodeChrome` from `@docx-editor.dev/pro/react`.
   */
  readonly chrome?: {
    readonly color?: string;
  };
  /** Click on the painted chip. UI state belongs in `CustomNodeChrome`'s `onNodeClick`. */
  readonly onClick?: (node: ActivatedCustomNode) => void;
  /** Pointer enters the painted chip. */
  readonly onHover?: (node: ActivatedCustomNode) => void;
  /**
   * Contribute a card to the review sidebar for every recognized node of this
   * definition, anchored at the node's range. Return null to skip one node.
   *
   * `attrs` and `text` originate in the file — untrusted; the returned strings
   * are rendered as TEXT by the pane, never markup. The context-menu section
   * reuses this hook for its info block and may invoke it with `text: ''` when
   * no review module is registered (the DOM decode alone cannot see the text).
   */
  readonly reviewCard?: (node: {
    readonly attrs: Readonly<Record<string, string>>;
    readonly text: string;
    /** The bound payload, through `schema`. Undefined when there is none or it did not match. */
    readonly data?: unknown;
  }) => { readonly title: string; readonly detail?: string } | null;
  /**
   * The "Edit {label}" row the context menu shows at the top when the
   * right-click lands on the node's chip. The HOST owns the dialog.
   *
   * HONEST LIMIT: there is no in-place update call yet — re-authoring is
   * `removeContentControl` + `insertCustomNode` at the node's range (the
   * activation carries `nodeId` and, when a review module is registered, the
   * current `text` to prefill a form). Schema-driven edit forms are the planned
   * follow-up.
   */
  readonly onEdit?: (node: ActivatedCustomNode) => void;
  /**
   * Display name for chrome — the "Edit {label}" context-menu row. Defaults to
   * `name`. Host-authored, never file data; provide a localized string.
   */
  readonly label?: string;
  /**
   * The shape of this node's payload, as a zod (or valibot, or arktype) schema.
   *
   * A payload lives in a customXml data part, so it arrives from a file the sender controls.
   * Declaring the shape means it is parsed and checked ONCE, at the read boundary, after which
   * the `data` handed to the hooks is the type that was asked for rather than something every
   * caller has to re-guard. Without one, `data` is whatever JSON the file held, typed
   * `unknown`, which is the honest description of an unchecked payload.
   *
   * Any Standard Schema satisfies this, which is what zod produces:
   *
   * ```ts
   * const Citation = z.object({ sourceId: z.string(), year: z.number() });
   * defineCustomNode({ name: 'citation', tagPrefix: 'acme', schema: Citation });
   * ```
   *
   * Validated on the way IN as well as on the way out, so a payload that does not match is
   * refused at the insert rather than written and rejected on the next open.
   */
  readonly schema?: StandardSchemaV1;
  /**
   * The customXml store this definition's payloads live in.
   *
   * One store per namespace, per document, so this is what decides whether two definitions
   * share a store or get one each. Defaults to a namespace derived from `tagPrefix`, which
   * means a host that never thinks about it still gets one store per prefix and never collides
   * with another integrator's.
   *
   * Set it to interoperate with something that already reads a namespace of its own. Whatever
   * it is, it must be free of quotes and angle brackets: it is written into an XPath prefix
   * declaration, where there is no escape for either.
   */
  readonly payloadNamespace?: string;
  /**
   * What happens to this node when a document is exported OUTSIDE the system that made it.
   *
   * A host may not want its own markup travelling in a file its users download: a `w:tag`
   * naming the tool, or a payload with no meaning anywhere else. This declares the fate, and
   * the save that applies it picks the pipeline — so one document can serialize one way at
   * rest and another on the way out.
   *
   *  - `true` (default) — the node and its payload survive untouched.
   *  - `'text'` — the control is unwrapped: a reader still sees the words, while the tag, the
   *    binding and the payload are gone. Right for a citation, whose text is the point of it.
   *  - `false` — the node goes, and takes its content with it.
   *
   * Applied by `exportCustomNodes`, which is a pipeline of its own rather than something
   * `save()` does — that is what lets one document serialize one way at rest and another on the
   * way out.
   *
   * IT DOES NOT MAKE A DOCUMENT ANONYMOUS. It removes this library's markup and nothing else. A
   * `.docx` carries its origin in `docProps/app.xml`, `docProps/core.xml`, comment and revision
   * authors, rsids and custom document properties.
   */
  readonly preserveOnExport?: boolean | 'text';
}

/**
 * A chip activation: identity + attrs, plus where it sits.
 *
 * `attrs` are the definition's OWN shape — the raw tag decode has already been
 * through `fromDocx`, exactly as the review derivation runs it, so every
 * surface (click, hover, edit, cards) sees one attrs vocabulary. `text` and
 * `nodeId` are present when the surface could resolve them (a registered
 * review module resolves both).
 */
export interface ActivatedCustomNode {
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly tag: string;
  /** Viewport-relative rect of the chip's boundary, for anchoring host UI. */
  readonly rect: DOMRect;
  /** The SDT node's canonical id — the address `removeContentControl` takes. */
  readonly nodeId?: string;
  /** The node's literal content text, when resolvable. */
  readonly text?: string;
  /**
   * The node's payload, when the surface could resolve one.
   *
   * Present only where the review derivation has already run — a chip's own click and hover
   * resolve through the review item, which is what carries the payload. Undefined otherwise,
   * and undefined for a node whose payload failed its schema.
   */
  readonly data?: unknown;
}

/**
 * Whether an opaque registry value is a custom-node definition.
 *
 * The engine carries registered definitions as unknowns (`getCustomNodeDefinitions`), so
 * every pro surface that reads them back narrows through this ONE guard.
 */
export function isCustomNodeDefinition(candidate: unknown): candidate is CustomNodeDefinition {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof (candidate as { name?: unknown }).name === 'string' &&
    typeof (candidate as { tagPrefix?: unknown }).tagPrefix === 'string'
  );
}

/**
 * The characters a definition identity may use.
 *
 * Conservative ON PURPOSE: `tagPrefix` and `name` travel into the `w:tag` codec (where `:`
 * and `?` are structural), into CSS attribute selectors (`CustomNodeChrome`), and into XML
 * attributes (`customNodeSdtXml`). A charset that can never need escaping in any of those
 * places is cheaper than three escaping rules that must each be right.
 */
export const CUSTOM_NODE_IDENTITY_PATTERN = /^[A-Za-z0-9_.-]+$/;

/** Validate and freeze a definition. Throws on a shape mistake — author error, not file input. */
export function defineCustomNode(definition: CustomNodeDefinition): CustomNodeDefinition {
  if (!CUSTOM_NODE_IDENTITY_PATTERN.test(definition.name ?? '')) {
    throw new Error(`defineCustomNode: invalid name ${JSON.stringify(definition.name)}`);
  }
  if (!CUSTOM_NODE_IDENTITY_PATTERN.test(definition.tagPrefix ?? '')) {
    throw new Error(`defineCustomNode: invalid tagPrefix ${JSON.stringify(definition.tagPrefix)}`);
  }
  // Both options are refused HERE, where the mistake was made. A schema that is not one means
  // every node of this type fails to parse later, three layers from the cause; a mistyped
  // `preserveOnExport` silently degrades "strip this from anything that leaves" into a value an
  // export path reads as truthy, which is the failure nobody notices until a file is out.
  const schema: unknown = definition.schema;
  if (schema !== undefined) {
    const standard = (
      schema as { readonly '~standard'?: { readonly validate?: unknown } } | null
    )?.['~standard'];
    if (typeof standard?.validate !== 'function') {
      throw new Error(
        `defineCustomNode: ${JSON.stringify(definition.name)} has a schema that does not implement Standard Schema`
      );
    }
  }
  if (
    definition.preserveOnExport !== undefined &&
    definition.preserveOnExport !== true &&
    definition.preserveOnExport !== false &&
    definition.preserveOnExport !== 'text'
  ) {
    throw new Error(
      `defineCustomNode: ${JSON.stringify(definition.name)} has an unknown preserveOnExport ${JSON.stringify(definition.preserveOnExport)}`
    );
  }
  return Object.freeze({ ...definition });
}

/**
 * How {@link customNodesModule} is configured.
 *
 * @public
 */
export interface CustomNodesModuleOptions extends ProLicenseOptions {
  /** The definitions this editor recognizes. A tag prefix no definition claims stays literal. */
  readonly nodes: readonly CustomNodeDefinition[];
  /**
   * Told about a document, never about a bug: a payload that failed its schema, so far.
   *
   * A payload comes from a file the sender wrote, so a mismatch is an ordinary property of an
   * ordinary document. The node still renders, without its `data`; this is how an integrator
   * finds out rather than wondering why one chip's dialog is empty.
   */
  readonly onDiagnostic?: (diagnostic: CustomNodeDiagnostic) => void;
}

/**
 * Where recognition reports to.
 *
 * Module-level, like the license key, and for the same reason: recognition runs inside the
 * engine's review derivation, which forwards definitions and nothing else. Threading a callback
 * through `ReviewModelInput` would put a capability package's diagnostics channel in the
 * engine's own contract. Last registration wins, which matches one editor per page.
 */
let reportDiagnostic: ((diagnostic: CustomNodeDiagnostic) => void) | null = null;

/** Report to whatever `customNodesModule` was told, if anything. Never throws at the caller. */
export function reportCustomNodeDiagnostic(diagnostic: CustomNodeDiagnostic): void {
  const report = reportDiagnostic;
  if (!report) return;
  try {
    report(diagnostic);
  } catch {
    // A host's logger throwing must not take a document's recognition pass with it.
  }
}

/** Register custom node definitions with `createDocxEditor({ modules })`. */
export function customNodesModule(options: CustomNodesModuleOptions): EditorModule {
  rememberLicenseKey(options.licenseKey);
  reportDiagnostic = options.onDiagnostic ?? null;
  return {
    id: 'custom-nodes',
    customNodes: options.nodes,
    // The stores this module owns, so the engine's open-time sweep collects orphaned payloads
    // in them and touches nobody else's — see `EditorModule.customNodePayloadNamespaces`.
    customNodePayloadNamespaces: [...new Set(options.nodes.map(customNodeNamespace))],
  };
}

function wmlTag(node: OoxmlElement): string | undefined {
  // STRUCTURAL, not kind-keyed: a Word re-save adds `w:placeholder` (and
  // friends) to `w:sdtPr`, which demotes the properties node to GENERIC under
  // the lossless-preservation rule — the tag is still right there. Matching on
  // localName reads it in both the typed and the demoted shape.
  for (const child of node.children as readonly OoxmlNode[]) {
    if (child.kind === 'textValue' || child.localName !== 'sdtPr') continue;
    for (const property of child.children as readonly OoxmlNode[]) {
      if (property.kind === 'textValue' || property.localName !== 'tag') continue;
      for (const attribute of property.attributes) {
        if (attribute.localName === 'val') return attribute.value;
      }
    }
  }
  return undefined;
}

function textUnder(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  let text = '';
  for (const child of node.children) text += textUnder(child);
  return text;
}

/**
 * Every recognized custom node in one story, in document order.
 *
 * Tag-prefix keyed, exactly as the change specifies: an inline SDT whose tag
 * decodes to a registered `<prefix>:<name>` pair is offered to that
 * definition's `fromDocx`; everything else — foreign tags, unregistered
 * prefixes, a `fromDocx` veto — stays a literal SDT.
 */
export function recognizeCustomNodes(
  part: OoxmlPart,
  definitions: readonly CustomNodeDefinition[],
  payloads?: ReadonlyMap<string, CustomNodePayloadSource>
): RecognizedCustomNode[] {
  if (definitions.length === 0) return [];
  const byIdentity = new Map<string, CustomNodeDefinition>();
  for (const definition of definitions) {
    const identity = `${definition.tagPrefix}:${definition.name}`;
    // Author error, thrown like `defineCustomNode`'s own validation: two
    // definitions claiming one identity would silently last-win otherwise.
    if (byIdentity.has(identity)) {
      throw new Error(`recognizeCustomNodes: duplicate definition for ${JSON.stringify(identity)}`);
    }
    byIdentity.set(identity, definition);
  }
  const found: RecognizedCustomNode[] = [];
  const walk = (node: OoxmlNode, depth: number): void => {
    if (node.kind === 'textValue' || depth > 64) return;
    if (node.kind === 'contentControl') {
      const tag = wmlTag(node);
      const decoded = tag !== undefined ? decodeCustomNodeTag(tag) : null;
      const definition = decoded ? byIdentity.get(`${decoded.prefix}:${decoded.name}`) : undefined;
      if (decoded && definition && tag !== undefined) {
        const text = textUnder(node);
        // Resolved BEFORE `fromDocx`, so the hook sees the payload alongside the attrs and can
        // decide with both. A node whose payload failed its schema arrives with `data`
        // undefined rather than not arriving.
        const data = resolvePayload(definition, node.id, payloads?.get(node.id));
        const attrs = definition.fromDocx
          ? definition.fromDocx({
              attrs: decoded.attrs,
              text,
              ...(data.present ? { data: data.value } : {}),
            })
          : decoded.attrs;
        if (attrs !== null) {
          found.push({
            name: definition.name,
            attrs,
            text,
            nodeId: node.id,
            tag,
            ...(data.present ? { data: data.value } : {}),
          });
          // A recognized node is ATOMIC: its content is the node's, so nothing
          // inside it can be another recognized node.
          return;
        }
      }
    }
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(part.root, 0);
  return found;
}

/**
 * A stored payload through the definition's schema, or nothing.
 *
 * `present: false` covers three cases a caller cannot usefully tell apart at the hook: the node
 * binds no payload, the binding named a store node the document does not hold, or the payload
 * did not match. Only the last is worth reporting, and it is — the node still renders, because
 * a chip that vanished over one wrong field would be a worse answer than a chip with no data.
 */
function resolvePayload(
  definition: CustomNodeDefinition,
  nodeId: string,
  source: CustomNodePayloadSource | undefined
): { readonly present: true; readonly value: unknown } | { readonly present: false } {
  if (!source) return { present: false };
  const parsed = parseCustomNodeData(definition.schema, source.data);
  if (parsed.ok) return { present: true, value: parsed.value };
  reportCustomNodeDiagnostic({
    code: 'payload-invalid',
    name: definition.name,
    nodeId,
    issues: parsed.issues,
  });
  return { present: false };
}
