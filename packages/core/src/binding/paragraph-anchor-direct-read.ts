import { findNode, type OoxmlPart } from '@docx-editor.dev/core/store';
import { validatedParaIdOfNode } from './paragraph-anchors.ts';

interface DirectParagraphPartSource {
  readonly body: OoxmlPart;
  readonly openStories: readonly OoxmlPart[];
  readonly otherStories: readonly OoxmlPart[];
  normalize(part: OoxmlPart): OoxmlPart;
}

/** Read one paragraph identity without composing the complete anchor index. */
export function directParaIdOf(nodeId: string, source: DirectParagraphPartSource): string | null {
  const hash = nodeId.indexOf('#');
  if (hash <= 0) return null;
  const partName = nodeId.slice(0, hash);
  let part = source.body.name === partName ? source.body : undefined;
  part ??= source.openStories.find((candidate) => candidate.name === partName);
  const other = part
    ? undefined
    : source.otherStories.find((candidate) => candidate.name === partName);
  part ??= other ? source.normalize(other) : undefined;
  if (!part) return null;
  const paragraph = findNode(part, nodeId);
  return paragraph?.kind === 'paragraph' ? validatedParaIdOfNode(paragraph) : null;
}
