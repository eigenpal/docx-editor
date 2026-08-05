// What every publishable manifest has to be true about, checked against the manifests
// themselves rather than against a build.
//
// Both rules here failed silently before they were tests: nothing in the repo reads a
// published tarball, so a manifest can be wrong for months and only the first consumer
// finds out.

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const packagesDir = path.join(root, 'packages');

type Manifest = {
  name: string;
  version: string;
  private?: boolean;
  files?: string[];
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const publishable = readdirSync(packagesDir)
  .filter((entry) => statSync(path.join(packagesDir, entry)).isDirectory())
  .map((entry) => {
    const manifestPath = path.join(packagesDir, entry, 'package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
    return { entry, manifest };
  })
  .filter(({ manifest }) => manifest.private !== true);

describe('published manifests', () => {
  test('there are publishable packages to check', () => {
    expect(publishable.length).toBeGreaterThan(0);
  });

  // `changeset version` leaves `workspace:*` and `workspace:^` alone by design, and
  // `npm publish` — which `changeset publish` shells out to — copies package.json
  // verbatim. So the protocol survives into the tarball, where npm has no idea what it
  // means: `npm i @docx-editor.dev/react` fails on `Unsupported URL Type "workspace:"`
  // before anything is unpacked. A plain range links to the workspace copy locally
  // (bun resolves it against the sibling's version) AND installs from the registry.
  test.each(publishable)('$manifest.name declares no workspace: range a consumer would see', ({
    manifest,
  }) => {
    const consumerFacing = {
      ...(manifest.dependencies ?? {}),
      ...(manifest.peerDependencies ?? {}),
    };
    const workspaceRanges = Object.entries(consumerFacing).filter(([, range]) =>
      range.startsWith('workspace:')
    );
    expect(workspaceRanges).toEqual([]);
  });

  // npm packs README and LICENSE whatever `files` says, but nothing else — a notice left
  // off the list is dropped from the tarball with no error anywhere.
  test.each(publishable)('$manifest.name packs its third-party notices', ({ manifest }) => {
    if (!Array.isArray(manifest.files)) return;
    expect(manifest.files).toContain('THIRD_PARTY_NOTICES.md');
  });
});
