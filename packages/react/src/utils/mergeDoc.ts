import type { EditorState, Transaction } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';

export interface SavedParagraph {
  index: number;
  nodeJSON: any;
  baseText: string;
}

/**
 * Identify paragraphs that the user modified by comparing
 * the current PM doc against a base snapshot (node JSON array).
 */
export function findModifiedParagraphs(doc: PMNode, baseNodes: any[]): SavedParagraph[] {
  const saved: SavedParagraph[] = [];
  let idx = 0;
  doc.forEach((node) => {
    const baseNode = baseNodes[idx];
    const currentJSON = node.toJSON();
    if (!baseNode || JSON.stringify(currentJSON) !== JSON.stringify(baseNode)) {
      saved.push({
        index: idx,
        nodeJSON: currentJSON,
        baseText: baseNode ? (baseNode.content?.map((c: any) => c.text || '').join('') ?? '') : '',
      });
    }
    idx++;
  });
  return saved;
}

/**
 * Re-apply saved (user-modified) paragraphs on top of a new PM state.
 * Matches by paragraph index first, falls back to base text content.
 * Returns the transaction (caller must dispatch).
 */
export function reapplyParagraphs(
  state: EditorState,
  savedParagraphs: SavedParagraph[]
): { tr: Transaction; replacements: number } {
  const tr = state.tr;
  let replacements = 0;

  // Only re-apply paragraph-type nodes. Complex container nodes (lists, tables, etc.)
  // lose OOXML formatting metadata (numbering, styles) through nodeFromJSON reconstruction.
  const SAFE_TYPES = new Set(['paragraph']);

  for (const saved of savedParagraphs) {
    // Skip complex nodes entirely — their formatting can't survive nodeFromJSON
    if (!SAFE_TYPES.has(saved.nodeJSON.type)) {
      console.log(
        '[mergeDoc] skipping complex node at index',
        saved.index,
        ':',
        saved.nodeJSON.type
      );
      continue;
    }

    let matched = false;
    let newParaIndex = 0;
    state.doc.forEach((newNode, offset) => {
      if (matched) return;
      const indexMatch = newParaIndex === saved.index;
      const textMatch = saved.baseText && newNode.textContent === saved.baseText;
      if (indexMatch || textMatch) {
        try {
          const userNode = state.schema.nodeFromJSON(saved.nodeJSON);
          if (userNode.type.name !== newNode.type.name) {
            // Type mismatch — don't replace, try next position
          } else {
            const from = tr.mapping.map(offset);
            const to = tr.mapping.map(offset + newNode.nodeSize);
            tr.replaceWith(from, to, userNode);
            matched = true;
            replacements++;
          }
        } catch (e) {
          console.warn('[mergeDoc] failed to restore paragraph', saved.index, e);
        }
      }
      newParaIndex++;
    });
  }

  return { tr, replacements };
}

/**
 * Capture a base snapshot from a PM doc (array of top-level node JSONs).
 */
export function captureBaseSnapshot(doc: PMNode): any[] {
  const nodes: any[] = [];
  doc.forEach((node) => {
    nodes.push(node.toJSON());
  });
  return nodes;
}

/**
 * Check if the current doc has any modifications vs a base snapshot.
 * Stops at the first diff — O(1) best case, O(n) worst case.
 */
export function hasModifiedParagraphs(doc: PMNode, baseNodes: any[]): boolean {
  if (!baseNodes) return false;
  let idx = 0;
  let found = false;
  doc.forEach((node) => {
    if (found) return;
    const baseNode = baseNodes[idx];
    if (!baseNode || JSON.stringify(node.toJSON()) !== JSON.stringify(baseNode)) {
      found = true;
    }
    idx++;
  });
  return found;
}
