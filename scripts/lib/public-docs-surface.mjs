function sorted(items, compare) {
  return [...items].sort(compare);
}

export function evaluatePublicDocsSurface({ docsByPackage, packageExports }) {
  const invalidSubpaths = [];
  const missingRootExports = [];

  for (const [packageName, docs] of Object.entries(docsByPackage)) {
    const exportedEntries = packageExports[packageName] ?? {};
    const rootExports = new Set(exportedEntries['.'] ?? []);

    for (const subpath of Object.keys(docs.subpathClaims)) {
      if (!(subpath in exportedEntries)) {
        invalidSubpaths.push({ packageName, subpath });
      }
    }

    for (const exportName of docs.rootClaims) {
      if (!rootExports.has(exportName)) {
        missingRootExports.push({ packageName, exportName });
      }
    }
  }

  return {
    invalidSubpaths: sorted(invalidSubpaths, (a, b) =>
      a.packageName === b.packageName
        ? a.subpath.localeCompare(b.subpath)
        : a.packageName.localeCompare(b.packageName)
    ),
    missingRootExports: sorted(missingRootExports, (a, b) =>
      a.packageName === b.packageName
        ? a.exportName.localeCompare(b.exportName)
        : a.packageName.localeCompare(b.packageName)
    ),
  };
}
