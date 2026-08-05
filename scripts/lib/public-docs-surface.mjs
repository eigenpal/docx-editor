function sorted(items, compare) {
  return [...items].sort(compare);
}

const REMOVED_SURFACE_PATTERNS = [
  '@docx-editor.dev/react/ui',
  '@docx-editor.dev/react/hooks',
  '@docx-editor.dev/react/dialogs',
  '@docx-editor.dev/react/plugin-api',
  '@docx-editor.dev/vue/ui',
  '@docx-editor.dev/vue/composables',
  '@docx-editor.dev/vue/dialogs',
  '@docx-editor.dev/vue/plugin-api',
  'renderAsync',
  'RenderAsyncOptions',
  'DocxEditorHandle',
];

export function isCurrentPublicDoc(file) {
  return (
    /\.mdx?$/.test(file) &&
    !/\.api\.md$/i.test(file) &&
    !/(^|\/)(CHANGELOG|changelog)(\.md)?$/i.test(file) &&
    !/(^|\/)docs\/api\//.test(file) &&
    !/(^|\/)openspec\//.test(file) &&
    !/(^|\/)\.openspec\//.test(file) &&
    !/(^|\/)reference\//.test(file)
  );
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

export function findRemovedSurfaceClaims(filesByPath) {
  const findings = [];
  for (const [file, source] of Object.entries(filesByPath)) {
    if (!isCurrentPublicDoc(file)) continue;
    for (const claim of REMOVED_SURFACE_PATTERNS) {
      if (source.includes(claim)) findings.push({ file, claim });
    }
  }
  return sorted(findings, (a, b) =>
    a.file === b.file ? a.claim.localeCompare(b.claim) : a.file.localeCompare(b.file)
  );
}
