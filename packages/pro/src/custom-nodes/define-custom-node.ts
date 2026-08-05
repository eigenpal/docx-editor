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

import type { EditorModule } from '@docx-editor.dev/core-contract/editor';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '@docx-editor.dev/core-contract/store';
import { rememberLicenseKey, type ProLicenseOptions } from '../license.ts';
import { decodeCustomNodeTag } from './tag-codec.ts';

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
}

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
  return Object.freeze({ ...definition });
}

export interface CustomNodesModuleOptions extends ProLicenseOptions {
  readonly nodes: readonly CustomNodeDefinition[];
}

/** Register custom node definitions with `createDocxEditor({ modules })`. */
export function customNodesModule(options: CustomNodesModuleOptions): EditorModule {
  rememberLicenseKey(options.licenseKey);
  return { id: 'custom-nodes', customNodes: options.nodes };
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
  definitions: readonly CustomNodeDefinition[]
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
        const attrs = definition.fromDocx
          ? definition.fromDocx({ attrs: decoded.attrs, text })
          : decoded.attrs;
        if (attrs !== null) {
          found.push({ name: definition.name, attrs, text, nodeId: node.id, tag });
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
