import { describe, expect, test } from 'bun:test';
import * as surface from '../lib/public-docs-surface.mjs';

describe('public docs paths on Windows', () => {
  const historicalPaths = [
    'CHANGELOG.md',
    'packages/core/CHANGELOG.md',
    'packages/editor-api/CHANGELOG.md',
    'packages/i18n/CHANGELOG.md',
    'packages/react/CHANGELOG.md',
    'packages/vue/CHANGELOG.md',
    'packages/core/changelog.md',
    'packages/core/Changelog.md',
    'docs/api/core.api.md',
    'docs/api/core.md',
    'openspec/changes/retired-api/proposal.md',
    '.openspec/retired-api/spec.md',
    'docs/reference/retired-api.md',
    'reference/retired-api.mdx',
  ];

  for (const posixPath of historicalPaths) {
    test(`excludes historical path ${posixPath} on both platforms`, () => {
      expect(surface.isCurrentPublicDoc(posixPath)).toBe(false);
      expect(surface.isCurrentPublicDoc(posixPath.replaceAll('/', '\\'))).toBe(false);
      expect(surface.findRemovedSurfaceClaims({ [posixPath]: 'renderAsync' })).toEqual([]);
      expect(
        surface.findRemovedSurfaceClaims({ [posixPath.replaceAll('/', '\\')]: 'renderAsync' })
      ).toEqual([]);
    });
  }

  const currentPaths = [
    'README.md',
    'packages/core/README.md',
    'packages/nuxt/README.md',
    'docs/PROPS.md',
    'docs/site/content/editor-api/lists.mdx',
    'docs/site/content/editor-api/reference-guide.mdx',
    'docs/site/content/editor-api/changelog-guide.mdx',
  ];

  for (const posixPath of currentPaths) {
    test(`keeps current path ${posixPath} on both platforms`, () => {
      const windowsPath = posixPath.replaceAll('/', '\\');
      expect(surface.isCurrentPublicDoc(posixPath)).toBe(true);
      expect(surface.isCurrentPublicDoc(windowsPath)).toBe(true);
      const posixClaims = surface.findRemovedSurfaceClaims({ [posixPath]: 'renderAsync' });
      const windowsClaims = surface.findRemovedSurfaceClaims({ [windowsPath]: 'renderAsync' });
      expect(posixClaims).toHaveLength(1);
      expect(windowsClaims).toHaveLength(1);
      expect(windowsClaims[0]).toEqual({ ...posixClaims[0], file: windowsPath });
    });
  }

  test('keeps extension and API declaration exclusions', () => {
    for (const file of ['README.txt', 'packages/core/core.api.md', 'packages\\core\\core.api.md']) {
      expect(surface.isCurrentPublicDoc(file)).toBe(false);
    }
  });
});
