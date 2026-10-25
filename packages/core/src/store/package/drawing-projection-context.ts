// The resolvers a part's drawings project with: styles, relationships, theme colours and
// style matrices, and the diagram parts behind SmartArt drawings.

import { createDiagramPartResolver, withUndrawnCharts } from './diagram-parts.ts';
import { createDrawingRelationshipResolver } from './drawing-projection.ts';
import { stylesPartOf } from './ooxml-indexes.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { createPackageShapeThemeResolvers } from './theme-color-resolution.ts';

/**
 * Projection context for the drawings of `ownerPartName` in `pkg`. With `drawCharts: false`,
 * charts skip the chart renderer and show their fallback picture or placeholder.
 */
export function packageDrawingProjectionContext(
  pkg: OoxmlPackage,
  ownerPartName: string,
  options: { readonly drawCharts?: boolean } = {}
) {
  const theme = createPackageShapeThemeResolvers(pkg);
  const diagramParts = createDiagramPartResolver(pkg, ownerPartName);
  return {
    stylesPart: stylesPartOf(pkg),
    resolveRelationship: createDrawingRelationshipResolver(pkg, ownerPartName),
    resolveSchemeColor: theme.resolveSchemeColor,
    resolveStyleMatrixReference: theme.resolveStyleMatrixReference,
    resolveDiagramParts:
      options.drawCharts === false ? withUndrawnCharts(diagramParts) : diagramParts,
  };
}
