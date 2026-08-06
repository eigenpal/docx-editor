/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `defineCustomNode` — integrator-defined inline nodes anchored on run-level SDTs.
//
// This module is the RECOGNITION half of the contract: definitions, the module registration,
// and the pass that turns a document's inline SDTs into typed, recognized nodes. A node's
// identity rides in `w:tag`, which Word caps at 64 characters; anything larger is a PAYLOAD in
// a customXml data part the control binds to, resolved here and handed to the hooks already
// checked against the definition's `schema`.
//
// The write side is `insert-custom-node.ts` / `update-custom-node.ts`; a document opened without
// a matching definition renders its SDT content literally, which is also the free tier's and
// Word's fallback.

import type { EditorModule } from '@docx-editor.dev/core/editor';
import {
  contentControlPropertiesOf,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { rememberLicenseKey, type ProLicenseOptions } from '../license.ts';
import { decodeCustomNodeTag } from './tag-codec.ts';
import { customNodeNamespace } from './node-payload.ts';
import {
  parseCustomNodeData,
  type InferSchemaOutput,
  type StandardSchemaV1,
} from './data-schema.ts';

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
  /**
   * `payload-invalid` — a payload was found and did not match the schema.
   * `payload-missing` — the control's binding names a store node the document does not hold.
   *
   * The second is what a half-stripped export or a hand-edited file leaves behind, and it used
   * to be indistinguishable from "this node carries no payload": both arrive as `data:
   * undefined` and neither said anything.
   */
  readonly code: 'payload-invalid' | 'payload-missing';
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
export interface CustomNodeDefinition<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see `AnyCustomNodeDefinition`
  Schema extends StandardSchemaV1 | undefined = any,
> {
  /** Node type name — the second segment of the tag (`<prefix>:<name>?…`). */
  readonly name: string;
  /** Tag prefix this definition claims (`acme` claims `acme:*`). No colons. */
  readonly tagPrefix: string;
  /**
   * The WRITE counterpart of {@link CustomNodeDefinition.fromDocx}: what the document should
   * say, derived from the payload.
   *
   * Declare it and a node has ONE representation. `insertCustomNode(editor, Citation, { data })`
   * is then the whole call: the `w:tag` attrs and the text a reader sees are both computed here,
   * so they cannot drift from the payload or from each other. Without it a caller passes all
   * three and is responsible for keeping them consistent — which nothing checks.
   *
   * `attrs` still has to fit the 64-character `w:tag` cap, so return the IDENTITY there and let
   * everything else live in the payload. `text` is what Word paints and what a reader without
   * this library sees.
   *
   * ```ts
   * toDocx: (data) => ({
   *   attrs: { sourceId: data.sourceId },
   *   text: `(${data.authors[0]} ${data.year})`,
   * }),
   * ```
   *
   * Declare a `schema` first. Without one `data` is `unknown`, so there is nothing to derive
   * from and this can only guess.
   */
  readonly toDocx?: (data: InferSchemaOutput<Schema>) => {
    readonly attrs: Readonly<Record<string, string>>;
    readonly text: string;
  };
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
    /**
     * The bound payload, already through `schema` — so this is the type the definition
     * declared, not `unknown`. Undefined when the node carries none or it did not match.
     */
    readonly data?: InferSchemaOutput<Schema>;
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
    /** The bound payload, already through `schema` — see {@link CustomNodeDefinition.fromDocx}. */
    readonly data?: InferSchemaOutput<Schema>;
  }) => { readonly title: string; readonly detail?: string } | null;
  /**
   * The "Edit {label}" row the context menu shows at the top when the
   * right-click lands on the node's chip. The HOST owns the dialog.
   *
   * Re-author with `updateCustomNode(editor, definition, node.nodeId, attrs, text, { data })`:
   * one transaction, one undo step. The activation carries `nodeId`, the node's `text` and its
   * `data`, which is everything a prefilled form needs.
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
  readonly schema?: Schema;
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
 * A definition, plus what {@link defineCustomNode} attaches to it.
 *
 * You author a {@link CustomNodeDefinition}; you are handed one of these. The difference is
 * `dataOf`, which cannot be written by hand because it closes over the schema you just declared.
 */
export interface CustomNode<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see `AnyCustomNodeDefinition`
  Schema extends StandardSchemaV1 | undefined = any,
> extends CustomNodeDefinition<Schema> {
  /**
   * This node's payload, from a surface that carries every definition's under one type.
   *
   * `RecognizedCustomNode.data`, `ActivatedCustomNode.data` and `ReviewCustomItem.data` are all
   * `unknown`, because each of those can be any registered definition's node. This narrows one
   * to THIS definition and validates its payload against THIS schema, so a host reads a typed
   * value without importing its own validator at the call site:
   *
   * ```ts
   * const survey = Iceberg.dataOf(node); // IcebergData | undefined
   * ```
   *
   * `undefined` when the node is a different definition's, carries no payload, or holds one the
   * schema rejects — the three cases a caller has to handle anyway.
   *
   * `name` is checked when present and never required, so this also works on a host's own object
   * that kept only the payload:
   *
   * ```ts
   * const survey = Iceberg.dataOf(popoverState); // { data } is enough
   * ```
   */
  readonly dataOf: (
    node: { readonly name?: string; readonly data?: unknown } | null | undefined
  ) => InferSchemaOutput<Schema> | undefined;
}

/**
 * A definition of any payload shape, spelled out.
 *
 * The AUTHORED shape, which is what every collection and every internal helper takes: they read
 * `name`, `schema`, `toDocx` and `preserveOnExport` and never need `dataOf`. A {@link CustomNode}
 * is assignable to it, so `defineCustomNode`'s result goes wherever this is asked for.
 *
 * The same thing bare `CustomNodeDefinition` already means — the interface defaults its
 * parameter to `any` for exactly this reason. `CustomNodeDefinition<Schema>` is INVARIANT in
 * `Schema`, because the schema's output type appears in the PARAMETER of `fromDocx` and
 * `reviewCard`; that is what makes those hooks typed, and it also means two definitions with
 * different schemas are not assignable to one another. Had the default been `undefined`, the
 * obvious annotation — `const nodes: CustomNodeDefinition[] = [citation, figure]` — would fail
 * with a message naming neither the cause nor this alias.
 *
 * The cost, stated plainly: `data` is unchecked wherever a definition is held under this type.
 * Pull one out of a registry and `insertCustomNode(editor, def, attrs, text, { data })` accepts
 * any shape at all. Payload typing lives where the definition is WRITTEN — `defineCustomNode`
 * infers the schema, and its hooks are typed from it.
 */
export type AnyCustomNodeDefinition = CustomNodeDefinition;

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
export function isCustomNodeDefinition(candidate: unknown): candidate is AnyCustomNodeDefinition {
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
export function defineCustomNode<Schema extends StandardSchemaV1 | undefined = undefined>(
  definition: CustomNodeDefinition<Schema>
): CustomNode<Schema> {
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
  const node: CustomNode<Schema> = Object.freeze({
    ...definition,
    dataOf: (candidate: { readonly name?: string; readonly data?: unknown } | null | undefined) => {
      if (!candidate || candidate.data === undefined) return undefined;
      // A `name` is CHECKED when there is one and never REQUIRED. An activation or a review item
      // carries one, and rejecting a mismatch is the narrowing half of this function. A host's
      // own object — a popover's state, a form's — usually carries only the payload it kept, and
      // demanding a name it never had would make this silently answer undefined forever.
      if (candidate.name !== undefined && candidate.name !== definition.name) return undefined;
      if (!definition.schema) return candidate.data as InferSchemaOutput<Schema>;
      const validated = definition.schema['~standard'].validate(candidate.data);
      if (typeof (validated as { then?: unknown }).then === 'function') return undefined;
      const settled = validated as { issues?: unknown; value?: unknown };
      return settled.issues ? undefined : (settled.value as InferSchemaOutput<Schema>);
    },
  });
  return node;
}

/**
 * How {@link customNodesModule} is configured.
 *
 * @public
 */
export interface CustomNodesModuleOptions extends ProLicenseOptions {
  /** The definitions this editor recognizes. A tag prefix no definition claims stays literal. */
  readonly nodes: readonly AnyCustomNodeDefinition[];
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
 * engine's own contract.
 *
 * A SET, not a slot. Two editors on one page each register a module, and the second one — which
 * may not want diagnostics at all — used to overwrite the first's callback with `null` and
 * silence it for the rest of the session.
 */
const diagnosticListeners = new Set<(diagnostic: CustomNodeDiagnostic) => void>();

/** Report to every registered listener. Never throws at the caller. */
export function reportCustomNodeDiagnostic(diagnostic: CustomNodeDiagnostic): void {
  for (const report of [...diagnosticListeners]) {
    try {
      report(diagnostic);
    } catch {
      // A host's logger throwing must not take a document's recognition pass with it.
    }
  }
}

/** Register custom node definitions with `createDocxEditor({ modules })`. */
export function customNodesModule(options: CustomNodesModuleOptions): EditorModule {
  rememberLicenseKey(options.licenseKey);
  if (options.onDiagnostic) diagnosticListeners.add(options.onDiagnostic);
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
  definitions: readonly AnyCustomNodeDefinition[],
  payloads?: ReadonlyMap<string, CustomNodePayloadSource>
): RecognizedCustomNode[] {
  if (definitions.length === 0) return [];
  const byIdentity = new Map<string, AnyCustomNodeDefinition>();
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
        const data = resolvePayload(
          definition,
          node.id,
          payloads?.get(node.id),
          contentControlPropertiesOf(node).dataBinding !== undefined
        );
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
  definition: AnyCustomNodeDefinition,
  nodeId: string,
  source: CustomNodePayloadSource | undefined,
  /** Whether the control declares a `w:dataBinding` — i.e. claims to have a payload. */
  bound: boolean
): { readonly present: true; readonly value: unknown } | { readonly present: false } {
  if (!source) {
    // A control that says it is bound and a store that does not hold the node is not the same
    // thing as a control that carries no payload, and both used to arrive as silence.
    if (bound) {
      reportCustomNodeDiagnostic({
        code: 'payload-missing',
        name: definition.name,
        nodeId,
        issues: ['the control binds a store node this document does not hold'],
      });
    }
    return { present: false };
  }
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
