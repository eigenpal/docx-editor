// Source diagnostics for content that never reaches a semantic layout record.
import {
  resolveNotesPart,
  type HeadlessDocumentView,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import {
  emptyNamespaceScope,
  namespaceScopeForNode,
  isMcAlternateContent,
  resolveRunLevelMcAtom,
  MAX_PART_SCAN_ELEMENTS,
} from '../store/package/drawing-projection.ts';
import { MAX_XML_DEPTH } from '../store/package/ooxml-drawing-rules.ts';

/** Source content that cannot be certified by the layout snapshot. @public */
export interface ExportContentWarning {
  /** Legacy text boxes are preserved in the DOCX but not laid out. */
  readonly code: 'legacy-textbox' | 'scan-limit';
  /** Package part containing the content, or where the bounded scan stopped. */
  readonly partName: string;
}

const cache = new WeakMap<OoxmlNode, readonly ExportContentWarning['code'][]>();

function inspectPart(part: OoxmlPart): readonly ExportContentWarning['code'][] {
  const cached = cache.get(part.root);
  if (cached) return cached;
  const codes = new Set<ExportContentWarning['code']>();
  const stack = [{ node: part.root as OoxmlNode, scope: emptyNamespaceScope(), depth: 0 }];
  let visited = 0;
  while (stack.length) {
    const { node, scope: inherited, depth } = stack.pop()!;
    if (++visited > MAX_PART_SCAN_ELEMENTS || depth > MAX_XML_DEPTH) {
      codes.add('scan-limit');
      break;
    }
    if (node.kind === 'textValue') continue;
    const scope = namespaceScopeForNode(inherited, node);
    // A selected modern drawing supersedes its legacy fallback. Do not warn about dead copies.
    if (isMcAlternateContent(node) && resolveRunLevelMcAtom(node, scope).drawing) continue;
    if (node.namespaceUri === 'urn:schemas-microsoft-com:vml' && node.localName === 'textbox') {
      codes.add('legacy-textbox');
      continue;
    }
    if (visited + stack.length + node.children.length > MAX_PART_SCAN_ELEMENTS) {
      codes.add('scan-limit');
      break;
    }
    for (const child of node.children) stack.push({ node: child, scope, depth: depth + 1 });
  }
  const result = Object.freeze([...codes]);
  cache.set(part.root, result);
  return result;
}

/** @internal */
export function collectExportContentWarnings(
  view: HeadlessDocumentView
): readonly ExportContentWarning[] {
  const parts = new Set([view.part()]);
  for (const section of view.headerFooterPartsBySection()) {
    for (const slots of [section.headers, section.footers]) {
      for (const part of slots.values()) parts.add(part);
    }
  }
  for (const kind of ['footnote', 'endnote'] as const) {
    const part = resolveNotesPart(view.currentPackage(), kind);
    if (part) parts.add(part);
  }
  return Object.freeze(
    [...parts].flatMap((part) =>
      inspectPart(part).map((code) => Object.freeze({ code, partName: part.name }))
    )
  );
}
