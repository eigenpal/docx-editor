import { describe, expect, test } from 'bun:test';
import * as surface from '../lib/public-docs-surface.mjs';

describe('public docs surface', () => {
  test('rejects removed subpath claims in docs', () => {
    const result = surface.evaluatePublicDocsSurface({
      docsByPackage: {
        '@docx-editor.dev/react': {
          rootClaims: ['DocxEditor', 'useDocxEditor'],
          subpathClaims: {
            '.': ['DocxEditor', 'useDocxEditor'],
            './ui': ['ToolbarButton'],
          },
        },
      },
      packageExports: {
        '@docx-editor.dev/react': {
          '.': ['DocxEditor', 'useDocxEditor'],
        },
      },
    });

    expect(result.invalidSubpaths).toEqual([
      {
        packageName: '@docx-editor.dev/react',
        subpath: './ui',
      },
    ]);
  });

  test('checks the documented root claims against the current root entry', () => {
    const result = surface.evaluatePublicDocsSurface({
      docsByPackage: {
        '@docx-editor.dev/react': {
          rootClaims: ['DocxEditor', 'DocxEditorRoot', 'useDocxEditor', 'useEditorState'],
          subpathClaims: {
            '.': ['DocxEditor', 'DocxEditorRoot', 'useDocxEditor', 'useEditorState'],
          },
        },
      },
      packageExports: {
        '@docx-editor.dev/react': {
          '.': ['DocxEditor', 'DocxEditorRoot', 'useDocxEditor'],
        },
      },
    });

    expect(result.missingRootExports).toEqual([
      {
        packageName: '@docx-editor.dev/react',
        exportName: 'useEditorState',
      },
    ]);
  });
});
