import { RELATIONSHIPS_NAMESPACE_URI, WML_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';
import { isStandardVmlTemplate } from './legacy-vml-templates.ts';
import {
  attribute as a,
  boundedVml,
  children,
  element,
  named,
  OFFICE,
  VML,
} from './legacy-vml-values.ts';

const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const OBJECT_ATTRIBUTES = [
  [WML_NAMESPACE_URI, 'dxaOrig'],
  [WML_NAMESPACE_URI, 'dyaOrig'],
  [W14, 'anchorId'],
] as const;
const OLE_ATTRIBUTES = ['Type', 'ProgID', 'ShapeID', 'DrawAspect', 'ObjectID'];

/** `o:FieldCodes` is inert switch text. It is carried, never parsed or evaluated. */
function inertFieldCodes(node: OoxmlElement): boolean {
  if (!named(node, OFFICE, 'FieldCodes') || node.attributes.length) return false;
  let length = 0;
  for (const child of node.children) {
    if (element(child)) return false;
    length += child.value.length;
  }
  return length <= 1024;
}

/**
 * The cached preview of an embedded OLE object: the `v:shape` of a `w:object` that holds one
 * standard picture frame, an optional built-in template, and an optional `o:OLEObject`.
 *
 * The preview is the only rendered content. The `o:OLEObject` relationship is never read here,
 * so the embedded part is never resolved, loaded, or run. Linked objects, controls, extra
 * children and unknown attributes keep the whole object opaque. Null when unsupported.
 */
export function embeddedObjectPreview(node: OoxmlElement): OoxmlElement | null {
  if (node.children.length > 16 || node.attributes.length > OBJECT_ATTRIBUTES.length) return null;
  for (const attr of node.attributes) {
    if (
      !OBJECT_ATTRIBUTES.some(([ns, name]) => attr.namespaceUri === ns && attr.localName === name)
    )
      return null;
    const pattern = attr.localName === 'anchorId' ? /^[\da-f]{1,8}$/i : /^\d{1,7}$/;
    if (!pattern.test(attr.value)) return null;
  }
  for (const child of node.children) if (!element(child) && child.value.trim()) return null;
  const list = children(node);
  const templates = list.filter((n) => named(n, VML, 'shapetype'));
  const shapes = list.filter((n) => named(n, VML, 'shape'));
  const objects = list.filter((n) => named(n, OFFICE, 'OLEObject'));
  if (
    templates.length > 1 ||
    shapes.length !== 1 ||
    objects.length > 1 ||
    templates.length + shapes.length + objects.length !== list.length ||
    templates.some((template) => !isStandardVmlTemplate(template) || !boundedVml(template))
  )
    return null;
  const shape = shapes[0]!;
  if (a(shape, 'type') !== '#_x0000_t75') return null;
  const images = children(shape).filter((n) => named(n, VML, 'imagedata'));
  if (images.length !== 1) return null;
  const imageId = a(images[0]!, 'id', RELATIONSHIPS_NAMESPACE_URI);
  const ole = objects[0];
  if (ole) {
    const oleId = a(ole, 'id', RELATIONSHIPS_NAMESPACE_URI);
    const shapeId = a(ole, 'ShapeID');
    if (
      ole.attributes.some(
        (attr) =>
          attr.value.length > 256 ||
          !(attr.namespaceUri === RELATIONSHIPS_NAMESPACE_URI
            ? attr.localName === 'id'
            : !attr.namespaceUri && OLE_ATTRIBUTES.includes(attr.localName))
      ) ||
      a(ole, 'Type') !== 'Embed' ||
      !['Content', 'Icon', undefined].includes(a(ole, 'DrawAspect')) ||
      (shapeId !== undefined && shapeId !== a(shape, 'id')) ||
      // The preview must be its own picture, never the embedded object's payload.
      (oleId !== undefined && oleId === imageId) ||
      ole.children.length > 1 ||
      !ole.children.every((child) => element(child) && inertFieldCodes(child))
    )
      return null;
  }
  return shape;
}
