import { WML_NAMESPACE_URI, type OoxmlElement } from '@docx-editor.dev/core/store';
import {
  revisionNodeIncluded,
  type RevisionAuthorFilter,
  type RevisionDisplayMode,
} from './revision-projection.ts';
import type { TableCellFragmentRecord } from './semantic-records.ts';

/** Classify visible cell changes without changing authored shading. */
export function revisionCellShading(
  properties: OoxmlElement | undefined,
  mode: RevisionDisplayMode,
  filter: RevisionAuthorFilter | undefined
): TableCellFragmentRecord['revisionShading'] {
  if (mode !== 'all-markup' || !properties) return undefined;
  const revision = properties.children.find(
    (node) =>
      node.kind !== 'textValue' &&
      node.namespaceUri === WML_NAMESPACE_URI &&
      ['cellIns', 'cellDel', 'cellMerge'].includes(node.localName)
  );
  if (!revision || revision.kind === 'textValue') return undefined;
  const attribute = (name: string) =>
    revision.attributes.find(
      (item) => item.localName === name && item.namespaceUri === WML_NAMESPACE_URI
    )?.value;
  if (filter && !revisionNodeIncluded(filter, revision.id, attribute('author') ?? ''))
    return undefined;
  if (revision.localName === 'cellIns') return 'inserted';
  if (revision.localName === 'cellDel') return 'deleted';
  return attribute('vMergeOrig') === 'cont' && attribute('vMerge') !== 'cont' ? 'split' : 'merged';
}

/** Publish cell revision metadata only when a visible cell revision exists. */
export function revisionCellMetadata(
  properties: OoxmlElement | undefined,
  mode: RevisionDisplayMode,
  filter: RevisionAuthorFilter | undefined
): Pick<TableCellFragmentRecord, 'revisionShading'> {
  const revisionShading = revisionCellShading(properties, mode, filter);
  return revisionShading ? { revisionShading } : {};
}
