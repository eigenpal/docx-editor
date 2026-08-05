// What the rest of the repository says about this package.
//
// The entry and manifest tests next door cover the tarball. They cannot fail for the thing that
// actually breaks a monorepo after a rewrite: an adapter that still declares the dependency, an
// example that still imports `./bridge`, a docs page that still teaches `DocxReviewer`, or a
// workspace list naming a directory that was deleted. Those all typecheck — the demos are their own
// workspaces and the docs are prose — so nothing else notices.
//
// So this walks the working tree and asserts the absence. Two exemptions, both deliberate: the
// migration guides name the removed surfaces because that is their subject, and this file names
// them because it is looking for them. Archived specs and published CHANGELOGs are history and are
// not rewritten.

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const PACKAGE = join(import.meta.dir, '..', '..');
const REPO = join(PACKAGE, '..', '..');

/** Identifiers and import specifiers that only ever meant the surfaces this change removed. */
const LEGACY = [
  'DocxReviewer',
  'createReviewerBridge',
  'createEditorBridge',
  'WordCompatBridge',
  'useAgentChat',
  'useDocxAgentTools',
  'agentTools',
  'executeToolCall',
  'getToolSchemas',
  'createMcpServer',
  'getToolDisplayName',
  'AgentPanelOptions',
  'LocalizedAgentPanel',
  'agentPanel',
  '@docx-editor.dev/agents/bridge',
  '@docx-editor.dev/agents/react',
  '@docx-editor.dev/agents/vue',
  '@docx-editor.dev/agents/mcp',
  '@docx-editor.dev/agents/ai-sdk',
  '@docx-editor.dev/agents/runtime',
  '@docx-editor.dev/agents/server',
];

const SKIP_DIRECTORIES = new Set([
  'node_modules',
  // Task briefs and reports: a record of the work, written before and after it, not a consumer.
  '.superpowers',
  'dist',
  '.git',
  '.turbo',
  '.worktrees',
  'archive',
  'coverage',
  'screenshots',
  'test-results',
  'playwright-report',
]);

const SCANNED = /\.(?:ts|tsx|vue|mjs|cjs|js|jsx|json|md|mdx|yml|yaml|css)$/;

/**
 * Files that name the removed surfaces on purpose: the two migration guides, the tests that look
 * for them, and the contract-only MCP registry in the private contract package — that one declares
 * a surface of the published `@docx-editor.dev/core` engine, whose implementation lives in another
 * repository, so this change is not the one that gets to retire it.
 */
const EXEMPT = new Set([
  join('packages', 'agents', 'MIGRATION.md'),
  join('packages', 'agents', 'src', '__tests__', 'repo-consumers.test.ts'),
  join('packages', 'agents', 'src', '__tests__', 'entry-surface.test.ts'),
  join('packages', 'agents', 'src', '__tests__', 'package-surface.test.ts'),
  join('docs', 'site', 'content', 'agents', 'migration.mdx'),
  join('packages', 'core', 'src', 'contracts', 'mcp.ts'),
  join('packages', 'core', 'src', '__tests__', 'consumer.test-d.ts'),
]);

function scannedFiles(): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      if (SKIP_DIRECTORIES.has(entry)) continue;
      const absolute = join(directory, entry);
      if (statSync(absolute).isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!SCANNED.test(entry)) continue;
      if (entry === 'CHANGELOG.md' || entry === 'bun.lock') continue;
      const path = relative(REPO, absolute);
      // A changeset, like a CHANGELOG entry, is where a removal is announced by name.
      if (path.startsWith(`.changeset${sep}`)) continue;
      // Archived proposals and their specs record what was true when they were archived.
      if (path.startsWith(`openspec${sep}changes${sep}archive`)) continue;
      if (EXEMPT.has(path)) continue;
      found.push(path);
    }
  };
  walk(REPO);
  return found;
}

const files = scannedFiles();

describe('nothing in the repository reaches a surface that is gone', () => {
  test('the scan looks at a repository, not at an empty list', () => {
    // Without this, every assertion below passes on a walk that found nothing — a skipped
    // directory or a tightened extension list would turn the whole file green and silent.
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain(join('packages', 'react', 'package.json'));
    expect(files).toContain(join('docs', 'site', 'content', 'agents', 'index.mdx'));
  });

  test('the same scan FIRES on a file that does mention one', () => {
    // The control: `MIGRATION.md` is exempt from the assertions and is the one file guaranteed to
    // contain the strings, so it proves the matcher works rather than the corpus being clean.
    const guide = readFileSync(join(PACKAGE, 'MIGRATION.md'), 'utf8');
    expect(LEGACY.filter((name) => guide.includes(name)).length).toBeGreaterThan(5);
  });

  test.each(LEGACY)('%s appears nowhere', (name) => {
    const offenders = files.filter((path) => readFileSync(join(REPO, path), 'utf8').includes(name));
    expect(offenders).toEqual([]);
  });
});

describe('the consumers that declared this package', () => {
  const manifestOf = (path: string): { dependencies?: Record<string, string> } =>
    JSON.parse(readFileSync(join(REPO, path), 'utf8'));

  test.each([
    join('packages', 'react', 'package.json'),
    join('packages', 'vue', 'package.json'),
    join('packages', 'nuxt', 'package.json'),
    join('examples', 'vue', 'package.json'),
  ])('%s no longer depends on it', (path) => {
    expect(manifestOf(path).dependencies?.['@docx-editor.dev/agents']).toBeUndefined();
  });

  test('the adapters are not allowed to depend on it again', () => {
    // The adapters' dependency allowlist is the thing that would let it back in quietly.
    const authority = readFileSync(
      join(REPO, 'packages', 'core', 'src', 'store', '__tests__', 'adapter-authority.test.ts'),
      'utf8'
    );
    const allowed = authority.slice(authority.indexOf('ALLOWED_ENGINE_DEPS'));
    expect(allowed.slice(0, allowed.indexOf(']'))).not.toContain('@docx-editor.dev/agents');
  });
});

describe('the example a consumer is pointed at', () => {
  const root = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as {
    workspaces: string[];
  };

  test('every workspace listed is a directory that exists', () => {
    const missing = root.workspaces
      .filter((pattern) => !pattern.includes('*'))
      .filter((pattern) => !existsSync(join(REPO, pattern)));
    expect(missing).toEqual([]);
  });

  test('the demos built on the removed surfaces are gone from the tree and the workspaces', () => {
    for (const demo of [join('examples', 'agents-demo'), join('examples', 'agent-chat-demo')]) {
      expect(existsSync(join(REPO, demo))).toBe(false);
    }
    expect(root.workspaces).not.toContain('examples/agents-demo');
    expect(root.workspaces).not.toContain('examples/agent-chat-demo');
  });

  test('the framework-neutral example is a workspace member and imports the package root', () => {
    expect(root.workspaces).toContain('examples/automation');
    const script = readFileSync(join(REPO, 'examples', 'automation', 'fill-template.ts'), 'utf8');
    expect(script).toContain("from '@docx-editor.dev/agents'");
    // A repo example that imported a relative source path would compile here and nowhere else.
    expect(script).not.toMatch(/from '\.{1,2}\//);
    for (const call of ['DocxEditor.createServer', 'context.sync()', 'runtime.save()']) {
      expect(script).toContain(call);
    }
  });
});
