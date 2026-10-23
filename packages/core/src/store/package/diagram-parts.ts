// The package parts behind one SmartArt drawing.
//
// A diagram `a:graphicData` holds `dgm:relIds`, whose `r:dm` names the data model part. The
// data model carries a Microsoft extension, `dsp:dataModelExt/@relId`, that names the saved
// drawing part: the shapes Office last laid out. Office writes that relationship on the STORY
// part (the part holding the `w:drawing`), not on the data part, so it resolves there first.
// Only parsed internal parts resolve; external targets never load.

import { findDirectChild } from './drawing-shape-readers.ts';
import { isElement } from './drawing-projection-walk.ts';
import { schemaAttributeValue } from './ooxml-drawing-rules.ts';
import { RELATIONSHIPS_NAMESPACE_URI } from './ooxml-shared.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import type { OoxmlElement } from './ooxml-tree.ts';
import { resolveRelationship } from './relationships.ts';

export const DIAGRAM_GRAPHIC_DATA_URI = 'http://schemas.openxmlformats.org/drawingml/2006/diagram';
export const DIAGRAM_NAMESPACE_URI = 'http://schemas.openxmlformats.org/drawingml/2006/diagram';
export const DIAGRAM_DRAWING_NAMESPACE_URI =
  'http://schemas.microsoft.com/office/drawing/2008/diagram';

const DATA_RELATIONSHIP_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData';
const DRAWING_RELATIONSHIP_TYPE =
  'http://schemas.microsoft.com/office/2007/relationships/diagramDrawing';

/** The parts one diagram drawing renders from. */
export interface DiagramParts {
  /** The data model root (`dgm:dataModel`): background and outline of the whole diagram. */
  readonly dataModel: OoxmlElement;
  /** The saved drawing root (`dsp:drawing`), or null when the package has none. */
  readonly drawing: OoxmlElement | null;
  /** Canonical name of the saved drawing part, for diagnostics and cache keys. */
  readonly drawingPartName: string | null;
}

/** Resolves the parts behind one `dgm:relIds` element of the owner story part. */
export type DiagramPartResolver = (relIds: OoxmlElement) => DiagramParts | null;

function internalPartRoot(
  pkg: OoxmlPackage,
  ownerPartName: string,
  relationshipId: string,
  relationshipType: string
): { readonly root: OoxmlElement; readonly partName: string } | null {
  for (const record of pkg.relationships.get(ownerPartName) ?? []) {
    if (record.id !== relationshipId) continue;
    if (record.type !== relationshipType || record.targetMode !== 'Internal') return null;
    const resolved = resolveRelationship(record);
    if (resolved.mode !== 'Internal' || !resolved.target.ok) return null;
    const part = pkg.parts.get(resolved.target.partName);
    return part ? { root: part.root, partName: resolved.target.partName } : null;
  }
  return null;
}

/** `dsp:dataModelExt/@relId` under the data model's `dgm:extLst/a:ext`. */
function drawingRelationshipId(dataModel: OoxmlElement): string | null {
  const extLst = findDirectChild(dataModel.children, {
    namespaceUri: DIAGRAM_NAMESPACE_URI,
    localName: 'extLst',
  });
  if (!extLst) return null;
  for (const ext of extLst.children) {
    if (!isElement(ext)) continue;
    const modelExt = findDirectChild(ext.children, {
      namespaceUri: DIAGRAM_DRAWING_NAMESPACE_URI,
      localName: 'dataModelExt',
    });
    const relId = modelExt ? schemaAttributeValue(modelExt.attributes, 'relId') : undefined;
    if (relId) return relId;
  }
  return null;
}

function relationshipAttribute(element: OoxmlElement, localName: string): string | undefined {
  for (const attribute of element.attributes) {
    if (attribute.namespaceUri === RELATIONSHIPS_NAMESPACE_URI && attribute.localName === localName)
      return attribute.value;
  }
  return undefined;
}

const RESOLVERS = new WeakMap<OoxmlPackage, Map<string, DiagramPartResolver>>();

/**
 * A resolver for the diagrams of one story part. Resolution only reads parsed parts, so the
 * result is cached per `dgm:relIds` element: the package and its diagram parts are immutable.
 */
export function createDiagramPartResolver(
  pkg: OoxmlPackage,
  ownerPartName: string
): DiagramPartResolver {
  let byOwner = RESOLVERS.get(pkg);
  if (!byOwner) {
    byOwner = new Map();
    RESOLVERS.set(pkg, byOwner);
  }
  const cached = byOwner.get(ownerPartName);
  if (cached) return cached;
  const results = new WeakMap<OoxmlElement, DiagramParts | null>();
  const resolver: DiagramPartResolver = (relIds) => {
    if (results.has(relIds)) return results.get(relIds)!;
    const result = resolveDiagramParts(pkg, ownerPartName, relIds);
    results.set(relIds, result);
    return result;
  };
  byOwner.set(ownerPartName, resolver);
  return resolver;
}

function resolveDiagramParts(
  pkg: OoxmlPackage,
  ownerPartName: string,
  relIds: OoxmlElement
): DiagramParts | null {
  if (relIds.namespaceUri !== DIAGRAM_NAMESPACE_URI || relIds.localName !== 'relIds') return null;
  const dataId = relationshipAttribute(relIds, 'dm');
  if (!dataId) return null;
  const data = internalPartRoot(pkg, ownerPartName, dataId, DATA_RELATIONSHIP_TYPE);
  if (!data || data.root.namespaceUri !== DIAGRAM_NAMESPACE_URI) return null;
  if (data.root.localName !== 'dataModel') return null;
  const drawingId = drawingRelationshipId(data.root);
  const drawing = drawingId
    ? (internalPartRoot(pkg, ownerPartName, drawingId, DRAWING_RELATIONSHIP_TYPE) ??
      internalPartRoot(pkg, data.partName, drawingId, DRAWING_RELATIONSHIP_TYPE))
    : null;
  const valid =
    drawing !== null &&
    drawing.root.namespaceUri === DIAGRAM_DRAWING_NAMESPACE_URI &&
    drawing.root.localName === 'drawing';
  return {
    dataModel: data.root,
    drawing: valid ? drawing.root : null,
    drawingPartName: valid ? drawing.partName : null,
  };
}

const partIds = new WeakMap<OoxmlElement, number>();
let nextPartId = 1;

/**
 * The identity of every diagram part in a package. Layout reuses drawing projections while
 * the story part is unchanged; a changed diagram part must invalidate them too.
 */
export function diagramPartsToken(pkg: OoxmlPackage): string {
  const ids: number[] = [];
  for (const [name, part] of pkg.parts) {
    if (!name.startsWith('/word/diagrams/')) continue;
    let id = partIds.get(part.root);
    if (id === undefined) {
      id = nextPartId++;
      partIds.set(part.root, id);
    }
    ids.push(id);
  }
  return ids.join(',');
}
