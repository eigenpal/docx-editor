// Floating shapes a story's paragraphs anchor, and the text-box stories they hold.
//
// INTERNAL. A shape is a floating drawing (`wp:anchor`) anchored in one of a story's own
// paragraphs, named by its `wp:docPr/@id` — the number a document gives it and the one
// `Shape.id` reports. A `wps:wsp` that holds a `wps:txbx/w:txbxContent` has a story of its own,
// with its own paragraphs, edited through the owning story's transaction scope. It is a text box
// when `wps:cNvSpPr/@txBox` says so, and a geometric shape with text otherwise.
//
// Inline drawings are inline pictures, not shapes, and stay out of this list. A run-level
// `mc:AlternateContent` is read through the branch layout selects for it: a shape whose selected
// branch is a VML fallback has no DrawingML story and is not listed. The VML fallback of a
// DrawingML text box follows its story on save (`textbox-fallback-export.ts`).

import { schemaAttributeValue, WPS_NAMESPACE_URI } from '../store/package/ooxml-drawing-rules.ts';
import {
  isMcAlternateContent,
  namespaceScopeForNode,
  resolveRunLevelMcAtom,
} from '../store/package/drawing-projection.ts';
import {
  DRAWINGML_MAIN_NAMESPACE_URI,
  WML_NAMESPACE_URI,
  WP_NAMESPACE_URI,
} from '../store/package/ooxml-shared.ts';
import type {
  OoxmlElement,
  OoxmlGenericElementNode,
  OoxmlNode,
  OoxmlPart,
} from '../store/package/ooxml-tree.ts';
import { namespaceBindingsAt } from '../store/package/wml-namespace.ts';

/** Word's shape types, as `Word.ShapeType` spells them. */
export type AutomationShapeType =
  | 'TextBox'
  | 'GeometricShape'
  | 'Picture'
  | 'Group'
  | 'Canvas'
  | 'Unsupported';

/** What a shape read answers. */
export interface AutomationShapeRead {
  readonly id: number;
  readonly name: string;
  readonly type: AutomationShapeType;
}

/** One floating shape in a story, with where it sits. */
export interface AutomationShapeEntry extends AutomationShapeRead {
  /** The paragraph whose run anchors the drawing. */
  readonly hostParagraphId: string;
  /**
   * The shape's own `w:txbxContent` story, or null when it has none. A text box or a geometric
   * shape can hold one; a linked text box continues another box's story and holds none.
   */
  readonly textboxRoot: OoxmlElement | null;
}

export type AutomationShapesRead =
  | { readonly ok: true; readonly shapes: readonly AutomationShapeEntry[] }
  | { readonly ok: false; readonly reason: 'duplicates' | 'malformed' | 'truncated' };

const PICTURE_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const GROUP_URI = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
const CANVAS_URI = 'http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas';

/** Shapes one story may list, and nodes one paragraph scan may visit. */
export const MAX_SHAPES_PER_STORY = 4096;
const MAX_NODES_PER_PARAGRAPH = 1 << 16;

function element(node: OoxmlNode | undefined): OoxmlElement | null {
  return node && node.kind !== 'textValue' ? node : null;
}

function named(node: OoxmlNode, namespaceUri: string, localName: string): boolean {
  return (
    node.kind !== 'textValue' && node.namespaceUri === namespaceUri && node.localName === localName
  );
}

function child(parent: OoxmlElement, namespaceUri: string, localName: string): OoxmlElement | null {
  return element(parent.children.find((node) => named(node, namespaceUri, localName)));
}

type ShapeOf = { readonly read: AutomationShapeRead; readonly root: OoxmlElement | null };

/** A floating drawing's identity and type, or null for an inline one; 'malformed' if unnamed. */
function shapeOf(drawing: OoxmlElement): ShapeOf | 'malformed' | null {
  const anchor = drawing.children.find(
    (node) => node.kind === 'anchoredDrawing' || named(node, WP_NAMESPACE_URI, 'anchor')
  );
  if (!anchor || anchor.kind === 'textValue') return null;
  const docPr = child(anchor, WP_NAMESPACE_URI, 'docPr');
  const rawId = docPr ? schemaAttributeValue(docPr.attributes, 'id') : undefined;
  // `xsd:unsignedInt`: up to ten digits, at most 4294967295.
  if (!docPr || rawId === undefined || !/^\d{1,10}$/.test(rawId) || Number(rawId) > 0xffffffff)
    return 'malformed';
  const name = schemaAttributeValue(docPr.attributes, 'name') ?? '';
  const graphic = child(anchor, DRAWINGML_MAIN_NAMESPACE_URI, 'graphic');
  const data = graphic ? child(graphic, DRAWINGML_MAIN_NAMESPACE_URI, 'graphicData') : null;
  const uri = data ? schemaAttributeValue(data.attributes, 'uri') : undefined;
  let type: AutomationShapeType = 'Unsupported';
  let root: OoxmlElement | null = null;
  if (data && uri === WPS_NAMESPACE_URI) {
    const wsp = child(data, WPS_NAMESPACE_URI, 'wsp');
    const txbx = wsp ? child(wsp, WPS_NAMESPACE_URI, 'txbx') : null;
    root = txbx ? child(txbx, WML_NAMESPACE_URI, 'txbxContent') : null;
    // A text box says so (`wps:cNvSpPr/@txBox`); a geometric shape may hold text and stays one.
    const properties = wsp ? child(wsp, WPS_NAMESPACE_URI, 'cNvSpPr') : null;
    const flag = properties ? schemaAttributeValue(properties.attributes, 'txBox') : undefined;
    type = !wsp ? 'Unsupported' : flag === '1' || flag === 'true' ? 'TextBox' : 'GeometricShape';
  } else if (uri === PICTURE_URI) type = 'Picture';
  else if (uri === GROUP_URI) type = 'Group';
  else if (uri === CANVAS_URI) type = 'Canvas';
  return { read: { id: Number(rawId), name, type }, root };
}

/**
 * The floating shapes a story's paragraphs anchor, in reading order.
 *
 * Fails closed: a drawing with no usable `wp:docPr/@id`, two shapes sharing an id, or a scan past
 * its bounds refuses the whole list rather than answer one a handle could not name again.
 */
export function shapesInParagraphs(
  part: OoxmlPart,
  paragraphs: readonly OoxmlNode[]
): AutomationShapesRead {
  const shapes: AutomationShapeEntry[] = [];
  const seen = new Set<number>();
  for (const paragraph of paragraphs) {
    if (paragraph.kind === 'textValue') continue;
    // `mc:Choice/@Requires` names prefixes, so the branch is chosen in the scope the file declares.
    const scope = namespaceScopeForNode(namespaceBindingsAt(part, paragraph), paragraph);
    const stack: { node: OoxmlNode; scope: ReadonlyMap<string, string> }[] = [];
    for (let index = paragraph.children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: paragraph.children[index]!, scope });
    }
    let visits = 0;
    while (stack.length > 0) {
      if (++visits > MAX_NODES_PER_PARAGRAPH) return { ok: false, reason: 'truncated' };
      const { node, scope: inherited } = stack.pop()!;
      if (node.kind === 'textValue' || node.kind === 'paragraph') continue;
      const inScope = namespaceScopeForNode(inherited, node);
      const alternate = isMcAlternateContent(node);
      const drawing: OoxmlElement | null =
        node.kind === 'drawing' || named(node, WML_NAMESPACE_URI, 'drawing')
          ? node
          : alternate
            ? resolveRunLevelMcAtom(node as OoxmlGenericElementNode, inScope).drawing
            : null;
      if (alternate && !drawing) continue;
      if (drawing) {
        const found = shapeOf(drawing);
        if (found === 'malformed') return { ok: false, reason: 'malformed' };
        if (found) {
          if (seen.has(found.read.id)) return { ok: false, reason: 'duplicates' };
          if (shapes.length >= MAX_SHAPES_PER_STORY) return { ok: false, reason: 'truncated' };
          seen.add(found.read.id);
          shapes.push({ ...found.read, hostParagraphId: paragraph.id, textboxRoot: found.root });
        }
        continue;
      }
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        stack.push({ node: node.children[index]!, scope: inScope });
      }
    }
  }
  return { ok: true, shapes: Object.freeze(shapes) };
}
