// Authored model -> ProseMirror projection (document-engine task 6.2). The PM doc is a projection
// of authored state; it is never canonical. Each block projects through its registered binding
// capability (comprehensive 3.5), so modelToDoc has no `block.kind` switch. Paragraph nodes carry
// `semId` so the forward mapper can target the right authored paragraph.

import { Node as PMNode } from 'prosemirror-model';
import {
  bodyStoryId,
  isRunPropertiesCapsule,
  isUnderlineColor,
  isUnderlineVariant,
  type PackageModel,
  type RunRecord,
  type RunUnderline,
} from '@docx-editor.dev/engine-core';
import { docSchema } from './schema.ts';
import { projectBlock } from './binding-capabilities.ts';

/** Project the body story into a ProseMirror doc. Each block projects through its capability
 *  (paragraphs editable; every other kind a read-only atom carrying its authored semId), so
 *  unsupported content stays visible and structurally intact rather than flattened. */
export function modelToDoc(model: PackageModel, readOnlyBlockIds?: ReadonlySet<string>): PMNode {
  const story = model.stories.get(bodyStoryId(model))!;
  // A block the body access policy marks read-only projects as an immutable atom even
  // when its kind is editable (M6P.1): a paragraph carrying unmodeled inline OOXML has
  // no lossless patch path, so it must be visible and untouchable rather than editable.
  const nodes = story.blocks.map((b) =>
    projectBlock(b, docSchema, readOnlyBlockIds?.has(b.id) === true)
  );
  return docSchema.node(
    'doc',
    null,
    nodes.length > 0 ? nodes : [docSchema.node('paragraph', { semId: null })]
  );
}

/** Read a paragraph node's inline content back into authored runs.
 *
 * Opaque rPr marks carry the exact XML bytes, but ProseMirror does not carry the parallel
 * semantic `props` projection used by style resolution/layout. When canonical runs are supplied,
 * restore those props by exact capsule identity. The capsule comes only from this projection's
 * registry and is revalidated below, so this cannot attach formatting from attacker-controlled DOM.
 */
export function paragraphNodeToRuns(
  node: PMNode,
  canonicalRuns: readonly RunRecord[] = []
): RunRecord[] {
  const runs: RunRecord[] = [];
  node.forEach((child) => {
    if (!child.isText || !child.text) return;
    const props: { bold?: true; italic?: true; underline?: RunUnderline } = {};
    let rPrCapsule: string | undefined;
    for (const m of child.marks) {
      // Validate the capsule at this PM->model trust boundary too: only a well-formed single w:rPr
      // becomes an rPr capsule, so a forged mark that slipped through is dropped (the run reverts to
      // modeled formatting) rather than injecting bytes on save.
      if (m.type.name === 'rawRunProps' && isRunPropertiesCapsule(String(m.attrs.rpr)))
        rPrCapsule = String(m.attrs.rpr);
      if (m.type.name === 'bold') props.bold = true;
      if (m.type.name === 'italic') props.italic = true;
      // Re-validate at this PM->model boundary: mark attrs travel through the DOM on a
      // clipboard round trip, so an unrecognized variant or colour falls back to a plain
      // single underline rather than reaching `w:u` as an authored attribute value.
      if (m.type.name === 'underline') {
        const val = isUnderlineVariant(m.attrs.val) ? m.attrs.val : 'single';
        props.underline = isUnderlineColor(m.attrs.color) ? { val, color: m.attrs.color } : { val };
      }
    }
    // An ownership-scoped rPr capsule wins: it already holds the full rPr, so the modeled b/i marks
    // (if any co-exist) are not separately serialized.
    if (rPrCapsule !== undefined) {
      const canonical = canonicalRuns.find((run) => run.rPrCapsule === rPrCapsule);
      runs.push({
        text: child.text,
        ...(canonical?.props ? { props: canonical.props } : {}),
        rPrCapsule,
      });
    } else
      runs.push(Object.keys(props).length > 0 ? { text: child.text, props } : { text: child.text });
  });
  return runs;
}
