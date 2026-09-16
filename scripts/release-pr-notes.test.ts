import { expect, test } from 'bun:test';
import { omitPrivateReleases } from './release-pr-notes.mjs';

const privateNames = new Set(['@docx-editor.dev/nuxt', '@docx-editor.dev/example-collaboration']);

test('omits private release sections and preserves public notes and bot footer', () => {
  const header = 'Release introduction.\n\n# Releases\n';
  const core = '## @docx-editor.dev/core@2.19.1\n\n### Patch Changes\n\n- Fix layout.\n';
  const privateSection =
    '## @docx-editor.dev/example-collaboration@0.0.14\n\n### Patch Changes\n\n- Updated dependencies\n';
  const vue = '## @docx-editor.dev/vue@2.19.1\n\n- Update core.\n';
  const nuxt = '## @docx-editor.dev/nuxt@2.19.1\n\n- Update Vue.\n';
  const footer = '<!-- codesmith:footer -->\nReview links.\n';
  const result = omitPrivateReleases(
    header + core + privateSection + vue + nuxt + footer,
    privateNames
  );
  expect(result).toBe(header + core + vue + footer);
  expect(omitPrivateReleases(result, privateNames)).toBe(result);
});

test('handles abbreviated notes, prereleases, and a final section without a newline', () => {
  expect(
    omitPrivateReleases(
      '# Releases\n## @docx-editor.dev/core@2.20.0-beta.1\n## @docx-editor.dev/nuxt@2.20.0-beta.1',
      privateNames
    )
  ).toBe('# Releases\n## @docx-editor.dev/core@2.20.0-beta.1\n');
});

test('preserves code examples and content outside the Releases section', () => {
  const body =
    '# Releases\n## @docx-editor.dev/core@2.19.1\n```md\n## @docx-editor.dev/nuxt@2.19.1\n```\n# Review notes\n## @docx-editor.dev/nuxt@2.19.1\n';
  expect(omitPrivateReleases(body, privateNames)).toBe(body);
});
