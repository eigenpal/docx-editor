// What leaves the system: applying a host's export policy to the custom nodes in a document.
//
// A host may not want its own markup travelling in a file its users download — a `w:tag` naming
// the tool, or a payload that means nothing anywhere else. This is the mechanism for that, and
// it takes the DECISION from the caller: core has no idea which tags belong to which definition,
// and a policy guessed from a tag prefix would be this library deciding what a host's nodes mean.
//
// Three fates, and the middle one is the interesting one:
//
//   - `keep`   — untouched, tag, binding, payload and all.
//   - `text`   — the control is UNWRAPPED. A reader still sees the words; the `w:sdt`, its tag,
//                its binding and its node are gone. Right for a citation, whose text is the point.
//   - `remove` — the control goes and takes its content with it.
//
// WHAT THIS DOES NOT MAKE ANONYMOUS. It removes THIS LIBRARY'S markup and nothing else. A `.docx`
// carries its origin in `docProps/app.xml`, `docProps/core.xml`, comment and revision authors,
// rsids and custom document properties. Describing this as "no traces" would be false, and the
// distinction belongs here as much as in the docs.

import { boundCustomXmlNodeIds } from './custom-node-payloads.ts';
import { findCustomXmlDataPart, withoutCustomXmlDataPart } from './custom-xml-part.ts';
import {
  contentControlContentNodeOf,
  contentControlPropertiesOf,
  contentControlsIn,
} from './content-control-nodes.ts';
import { parentNodeOf, removeNode, replaceChildren } from './ooxml-edit.ts';

import { withPart, type OoxmlPackage } from './ooxml-package.ts';
import type { OoxmlInvariantIssue, OoxmlNode } from './ooxml-tree.ts';

/** What happens to one control when the document is exported. */
export type CustomNodeExportPolicy = 'keep' | 'text' | 'remove';

/** How {@link withExportedCustomNodes} decides, and which stores it may tidy afterwards. */
export interface CustomNodeExportRequest {
  /** The story whose controls are policed, and whose relationships the stores hang off. */
  readonly storyPartName: string;
  /**
   * Payload namespaces the caller CLAIMS.
   *
   * The store cleanup runs only over these. Word's own Cover Page Properties store rides in most
   * templates, and an export that tidied every customXml part would be deleting from documents it
   * was only asked to strip its own markup from.
   */
  readonly namespaces: readonly string[];
  /** The fate of a control carrying this `w:tag`. A control with no tag is never touched. */
  readonly decide: (tag: string) => CustomNodeExportPolicy;
}

/**
 * The export, or the reason there is no export.
 *
 * A refusal answers no package on purpose. "Stripping failed, here is the document anyway" is the
 * one outcome that must not be possible: a caller would ship the markup it asked to remove and
 * have been told the export succeeded.
 */
export type CustomNodeExportResult =
  | {
      readonly ok: true;
      readonly pkg: OoxmlPackage;
      /** Controls unwrapped (`text`) and controls removed (`remove`). */
      readonly unwrapped: number;
      readonly removed: number;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Apply the policy, then take the payloads and the stores the policy orphaned.
 *
 * Order matters and is the reverse of the write's. The BODY goes first, so the sweep that follows
 * sees the controls that actually survive; the stores go last, once nothing binds them. Doing it
 * the other way would strip a store while a control still quoted its `w:storeItemID`, which is a
 * document Word opens and offers to repair.
 */
export function withExportedCustomNodes(
  pkg: OoxmlPackage,
  request: CustomNodeExportRequest
): CustomNodeExportResult {
  const story = pkg.parts.get(request.storyPartName);
  if (!story) return { ok: false, reason: `no story part named ${request.storyPartName}` };

  // Decided against ONE tree, applied one at a time. Every edit rebuilds the part, so a list of
  // node objects gathered up front would go stale; the ids do not, and an id whose node the
  // previous edit already removed is simply skipped.
  const decided: { readonly nodeId: string; readonly policy: CustomNodeExportPolicy }[] = [];
  for (const entry of contentControlsIn(story.root)) {
    const tag = contentControlPropertiesOf(entry.node).tag;
    if (tag === undefined || tag.length === 0) continue;
    const policy = request.decide(tag);
    if (policy === 'keep') continue;
    decided.push({ nodeId: entry.node.id, policy });
  }

  let part = story;
  let unwrapped = 0;
  let removed = 0;
  for (const { nodeId, policy } of decided) {
    // A control INSIDE one already unwrapped or removed is reached through the outer decision,
    // so its id may no longer be in the tree. That is not a failure — the outer policy already
    // said what happens to everything under it.
    const parent = parentNodeOf(part, nodeId);
    if (!parent) continue;
    if (policy === 'remove') {
      const edit = removeNode(part, nodeId, { deferValidation: true });
      if (!edit.ok) return { ok: false, reason: `a node could not be removed: ${describe(edit)}` };
      part = edit.part;
      removed += 1;
      continue;
    }
    const control = parent.children.find((child) => child.id === nodeId);
    if (!control) continue;
    const content = contentControlContentNodeOf(control);
    // No `w:sdtContent` is a control with nothing to keep, so unwrapping it is removing it.
    const kept: readonly OoxmlNode[] = content ? content.children : [];
    const children = parent.children.flatMap((child) => (child.id === nodeId ? kept : [child]));
    const edit = replaceChildren(part, parent.id, children, { deferValidation: true });
    if (!edit.ok) return { ok: false, reason: `a node could not be unwrapped: ${describe(edit)}` };
    part = edit.part;
    unwrapped += 1;
  }

  let next = part === story ? pkg : withPart(pkg, part);
  const storyAfter = next.parts.get(request.storyPartName);
  if (!storyAfter) return { ok: false, reason: 'the story went missing during the export' };

  for (const namespaceUri of request.namespaces) {
    const dataPart = findCustomXmlDataPart(next, request.storyPartName, namespaceUri);
    if (!dataPart) continue;
    const referenced = boundCustomXmlNodeIds(storyAfter, dataPart.itemId);
    // The whole store goes when nothing binds it any more — part, properties, both
    // relationships and the content-type Override, which is what "no record of it" means.
    // A store still holding a bound node keeps its unbound siblings too: this is an export,
    // not the sweep, and collecting orphans is the sweep's decision to make on open.
    if (referenced.size > 0) continue;
    const stripped = withoutCustomXmlDataPart(next, request.storyPartName, namespaceUri);
    // `ok: false` means NOTHING was removed. Answering the unchanged package would hand back a
    // document a caller could not tell from a stripped one.
    if (!stripped.ok) {
      return { ok: false, reason: `the payload store for ${namespaceUri} could not be removed` };
    }
    next = stripped.pkg;
  }

  return { ok: true, pkg: next, unwrapped, removed };
}

/** An edit refusal as one line, so an export failure names the invariant that stopped it. */
function describe(edit: { readonly issues: readonly OoxmlInvariantIssue[] }): string {
  return edit.issues.map((issue) => issue.code).join(', ') || 'the edit was refused';
}
