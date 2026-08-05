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

  test('flags removed claims in current public markdown outside the docs site tree', () => {
    const claims = surface.findRemovedSurfaceClaims({
      'packages/nuxt/README.md': `
        import { useAutoSave } from '@docx-editor.dev/vue/composables';
        import { renderAsync } from '@docx-editor.dev/vue';
      `,
      'docs/PROPS.md': `
        import { DocxEditor, type DocxEditorRef, renderAsync } from '@docx-editor.dev/react';
        Both packages export DocxEditorHandle and RenderAsyncOptions.
      `,
      'CHANGELOG.md': `
        import { PluginHost } from '@docx-editor.dev/react/plugin-api';
      `,
    });

    expect(claims).toEqual([
      {
        file: 'docs/PROPS.md',
        claim: 'DocxEditorHandle',
      },
      {
        file: 'docs/PROPS.md',
        claim: 'renderAsync',
      },
      {
        file: 'docs/PROPS.md',
        claim: 'RenderAsyncOptions',
      },
      {
        file: 'packages/nuxt/README.md',
        claim: '@docx-editor.dev/vue/composables',
      },
      {
        file: 'packages/nuxt/README.md',
        claim: 'renderAsync',
      },
    ]);
  });
});
