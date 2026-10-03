// Floating shapes a story's paragraphs anchor, and the text-box stories they hold.
//
// INTERNAL. A shape is a floating drawing (`wp:anchor`) anchored in one of a story's own
// paragraphs, named by its `wp:docPr/@id` — the number a document gives it and the one
// `Shape.id` reports. A text box is the shape whose `wps:wsp` holds a `wps:txbx/w:txbxContent`;
// that content is its own story, with its own paragraphs, edited through the owning story's
// transaction scope.
//
// Inline drawings are inline pictures, not shapes, and stay out of this list. A run-level
// `mc:AlternateContent` is read through its first `mc:Choice` holding a `w:drawing`: that is the
// copy edits change, and the VML fallback follows it on save (`textbox-fallback-export.ts`).

import { schemaAttributeValue, WPS_NAMESPACE_URI } from '../store/package/ooxml-drawing-rules.ts';
import {
  DRAWINGML_MAIN_NAMESPACE_URI,
  MC_NAMESPACE_URI,
  WML_NAMESPACE_URI,
  WP_NAMESPACE_URI,
} from '../store/package/ooxml-shared.ts';
import type { OoxmlElement, OoxmlNode } from '../store/package/ooxml-tree.ts';

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
  /** The text box's `w:txbxContent`, or null for any other shape. */
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

/** The drawing an `mc:AlternateContent` shows: its first `mc:Choice` holding a `w:drawing`. */
function chosenDrawing(alternate: OoxmlElement): OoxmlElement | null {
  for (const choice of alternate.children) {
    if (!named(choice, MC_NAMESPACE_URI, 'Choice') || choice.kind === 'textValue') continue;
    const drawing = choice.children.find((node) => named(node, WML_NAMESPACE_URI, 'drawing'));
    if (drawing) return element(drawing);
  }
  return null;
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
  if (!docPr || rawId === undefined || !/^\d{1,9}$/.test(rawId)) return 'malformed';
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
    type = root ? 'TextBox' : wsp ? 'GeometricShape' : 'Unsupported';
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
export function shapesInParagraphs(paragraphs: readonly OoxmlNode[]): AutomationShapesRead {
  const shapes: AutomationShapeEntry[] = [];
  const seen = new Set<number>();
  for (const paragraph of paragraphs) {
    if (paragraph.kind === 'textValue') continue;
    const stack: OoxmlNode[] = [...paragraph.children].reverse();
    let visits = 0;
    while (stack.length > 0) {
      if (++visits > MAX_NODES_PER_PARAGRAPH) return { ok: false, reason: 'truncated' };
      const node = stack.pop()!;
      if (node.kind === 'textValue' || node.kind === 'paragraph') continue;
      const drawing =
        node.kind === 'drawing' || named(node, WML_NAMESPACE_URI, 'drawing')
          ? node
          : named(node, MC_NAMESPACE_URI, 'AlternateContent')
            ? chosenDrawing(node)
            : null;
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
        stack.push(node.children[index]!);
      }
    }
  }
  return { ok: true, shapes: Object.freeze(shapes) };
}
