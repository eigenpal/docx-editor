// Regression: predefined-entity decoding (fixes the OOXML-review double-escape
// bug) + audit index / replay journal (task 4.11).

import { describe, expect, test } from 'bun:test';
import { readXml, findElement, textContent, parseDocx, writeDocx } from '../src/package/index.ts';
import { AuditIndex, ReplayJournal, DocumentStore } from '../src/store/index.ts';
import { createEmptyModel, bodyStoryId, type ParagraphRecord } from '../src/model/index.ts';
import { ORIGIN_IDS } from '../src/registry/frozen-ids.ts';

const HUMAN = ORIGIN_IDS.mutationHuman;

describe('predefined entity decoding (OOXML-review fix)', () => {
  test('reader decodes the five predefined entities and numeric refs', () => {
    const r = readXml('<w:t>AT&amp;T &lt;x&gt; &quot;q&quot; &#169; &#x41;</w:t>');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(textContent(findElement(r.nodes, 'w:t')!)).toBe('AT&T <x> "q" © A');
  });

  test('round-trip does NOT double-escape ampersands', () => {
    // Build a DOCX whose body text contains an ampersand, via writeDocx, then reparse.
    const model = createEmptyModel();
    const p1 = (model.stories.get(bodyStoryId(model))!.blocks[0] as ParagraphRecord).id;
    const store = new DocumentStore(model);
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p1, text: 'Ben & Jerry <co>' }));

    const once = parseDocx(writeDocx(store.currentModel));
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const text1 = (once.model.stories.get(bodyStoryId(once.model))!.blocks[0] as ParagraphRecord).runs.map((r) => r.text).join('');
    expect(text1).toBe('Ben & Jerry <co>');

    // Second round-trip stays stable (no compounding escapes).
    const twice = parseDocx(writeDocx(once.model));
    expect(twice.ok).toBe(true);
    if (!twice.ok) return;
    const text2 = (twice.model.stories.get(bodyStoryId(twice.model))!.blocks[0] as ParagraphRecord).runs.map((r) => r.text).join('');
    expect(text2).toBe('Ben & Jerry <co>');
  });

  test('deeply nested XML fails safely (bounded), not a stack overflow', () => {
    const deep = '<a>'.repeat(2000) + '</a>'.repeat(2000);
    const r = readXml(deep);
    expect(r.ok).toBe(false); // bounded failure (too-deep or parse-error), never a crash
    if (!r.ok) expect(['too-deep', 'parse-error']).toContain(r.reason);
  });
});

describe('audit index + replay journal (4.11)', () => {
  test('redacted audit never contains raw text; journal holds full ops behind auth', () => {
    const audit = new AuditIndex();
    const journal = new ReplayJournal('secret-token');
    const model = createEmptyModel();
    const p1 = (model.stories.get(bodyStoryId(model))!.blocks[0] as ParagraphRecord).id;
    const store = new DocumentStore(model, { audit, journal, clock: () => 1 });

    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p1, text: 'TOP SECRET TEXT' }));

    // Redacted index: an entry exists, but the raw text is NOT in it.
    expect(audit.list()).toHaveLength(1);
    expect(JSON.stringify(audit.list())).not.toContain('TOP SECRET TEXT');
    expect(audit.list()[0].dirtyIds).toContain(p1);

    // Journal: full ops (including the text) are there, but require the token.
    expect(() => journal.read('wrong')).toThrow(/unauthorized/);
    const entries = journal.read('secret-token');
    expect(JSON.stringify(entries)).toContain('TOP SECRET TEXT');
  });

  test('audit retention is finite (oldest dropped)', () => {
    const audit = new AuditIndex(2);
    for (let i = 0; i < 5; i++) audit.append({ commitId: `c${i}`, toRevision: i, origin: HUMAN, dirtyIds: [], at: i });
    expect(audit.list()).toHaveLength(2);
    expect(audit.list().map((e) => e.commitId)).toEqual(['c3', 'c4']);
  });
});
