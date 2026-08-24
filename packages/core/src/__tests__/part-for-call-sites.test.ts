// `partFor` call sites are pinned, because a partFor read is a write in disguise.
//
// `partFor(partName)` opens a story store and PERMANENTLY retains its slot — the store
// caps editable story parts (`DEFAULT_MAX_EDITABLE_STORY_PARTS`, 64), and a slot once
// opened is never returned. `editor/surface-scope.ts` documents the failure in full:
// sixty-four such "reads" and no further header, footer or note could be opened for the
// rest of the session, silently. A pure read routes through `partOfNodeId`
// (`editor/surface-scope.ts`) or another store read API instead.
//
// So every `partFor(` in non-test source is pinned here, in the manner of
// `prosemirror-isolation.test.ts`. Add a new site only for a WRITE that needs the open
// store, then update this list; a removed site fails too, so the list ratchets down.

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

/** file (relative to src/) → number of `partFor(` occurrences, definitions included. */
const PINNED_CALL_SITES: Readonly<Record<string, number>> = {
  'automation/server-host.ts': 1,
  'binding/tree-session.ts': 7, // includes the TreeEditingSession facade definition
  'editor/doc-target-resolution.ts': 2,
  'editor/docx-editor-derive.ts': 1,
  'editor/docx-editor-images.ts': 1,
  'editor/paginated-surface.ts': 10,
  'editor/surface-equations.ts': 1,
  'editor/surface-format.ts': 1,
  'editor/surface-hf-editing.ts': 1,
  'editor/surface-hyperlinks.ts': 1,
  'editor/surface-scope.ts': 2, // storyScopeOfNodeId — documented as a known debt in-file
  'editor/surface-structure.ts': 1,
  'store/store/tree-package-store.ts': 1, // the definition itself
};

function* sourceFiles(directory: string): Generator<string> {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      yield* sourceFiles(path);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      yield path;
    }
  }
}

describe('partFor stays a write-path API', () => {
  test('the call-site census matches the pinned list exactly', () => {
    const census: Record<string, number> = {};
    for (const file of sourceFiles(SRC)) {
      const count = (readFileSync(file, 'utf8').match(/\bpartFor\(/g) ?? []).length;
      if (count > 0) census[relative(SRC, file).split(sep).join('/')] = count;
    }
    const sorted = Object.fromEntries(Object.entries(census).sort(([a], [b]) => (a < b ? -1 : 1)));
    // A NEW site: partFor opens and permanently retains a story store (cap 64). If this
    // is a pure read, use partOfNodeId (editor/surface-scope.ts) or a store read API and
    // leave this list alone. If it is a write that needs the open store, add the entry.
    // A REMOVED site: delete its entry — the list only ratchets down.
    expect(sorted).toEqual(PINNED_CALL_SITES);
  });

  test('the census is not vacuous: it sees the definition', () => {
    expect(PINNED_CALL_SITES['store/store/tree-package-store.ts']).toBeGreaterThan(0);
  });
});
