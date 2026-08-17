import { describe, expect, test } from 'bun:test';

import { COMMENT_MARKER, renderComment } from './edit-bench-comment.mjs';

function timing(medianMs: number): Record<string, number> {
  return { medianMs, p95Ms: medianMs * 1.2, minMs: medianMs * 0.8, maxMs: medianMs * 1.5 };
}

function report(overrides: {
  fixtureSha256?: string;
  medianMs?: number;
  cacheMisses?: number;
}): Record<string, unknown> {
  const medianMs = overrides.medianMs ?? 10;
  return {
    schema: 1,
    fixture: 'e2e/fixtures/synthetic-long-edit.docx',
    fixtureBytes: 27000,
    fixtureSha256: overrides.fixtureSha256 ?? 'abc123',
    environment: { runtime: 'bun', arch: 'arm64' },
    config: { runs: 10, warmup: 2, measurer: 'deterministic' },
    scenarios: [
      {
        name: 'steady-middle-text',
        target: { paragraphIndex: 1600, paragraphId: 'p-1600' },
        transaction: timing(medianMs / 10),
        layout: timing(medianMs),
        total: timing(medianMs),
        work: {
          placed: 13,
          total: 3200,
          reusedPages: 154,
          fullPasses: 1,
          pagesBefore: 204,
          pagesAfter: 204,
          cache: { hits: 0, misses: overrides.cacheMisses ?? 3213, evictions: 3213, size: 0 },
        },
      },
    ],
  };
}

describe('edit-bench comment rendering', () => {
  test('comparable base renders a delta table with the sticky marker first', () => {
    const body = renderComment(report({ medianMs: 8 }), report({ medianMs: 10 }));
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(body).toContain('## Performance benchmark');
    expect(body).toContain('| steady-middle-text | 10.00 ms | 8.00 ms | 🟢 -20.0% |');
    expect(body).toContain('Work counters: unchanged.');
    expect(body).not.toContain('⚠️');
  });

  test('a regression past the threshold gets the warning marker', () => {
    const body = renderComment(report({ medianMs: 15 }), report({ medianMs: 10 }));
    expect(body).toContain('🔴 +50.0% ⚠️');
  });

  test('a delta inside the noise band renders neutral', () => {
    const body = renderComment(report({ medianMs: 10.3 }), report({ medianMs: 10 }));
    expect(body).toContain('⚪ +3.0%');
  });

  test('comparable mode charts head bars against a baseline line', () => {
    const body = renderComment(report({ medianMs: 8 }), report({ medianMs: 10 }));
    expect(body).toContain('```mermaid');
    expect(body).toContain('xychart-beta');
    expect(body).toContain('bar [8.00]');
    expect(body).toContain('line [10.00]');
    expect(body).toContain('line: `main` baseline');
  });

  test('head-only mode charts a single bar series', () => {
    const body = renderComment(report({}), undefined);
    expect(body).toContain('xychart-beta');
    expect(body).toContain('bar [10.00]');
    expect(body).not.toContain('line [');
  });

  test('changed work counters are listed as deterministic deltas', () => {
    const body = renderComment(report({ cacheMisses: 4000 }), report({ cacheMisses: 3213 }));
    expect(body).toContain('Work counters changed');
    expect(body).toContain('`cache.misses`: 3213 → 4000');
  });

  test('a fixture hash mismatch degrades to a head-only table', () => {
    const body = renderComment(report({ fixtureSha256: 'new' }), report({ fixtureSha256: 'old' }));
    expect(body).toContain('Baseline not comparable');
    expect(body).toContain('| Scenario | Median | p95 | Min | Max |');
    expect(body).not.toContain('| Base median |');
  });

  test('a missing base degrades to a head-only table', () => {
    const body = renderComment(report({}), undefined);
    expect(body).toContain('Baseline unavailable');
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
  });

  test('a scenario present only in the base still gets a row', () => {
    const base = report({});
    const head = report({});
    (head.scenarios as Array<{ name: string }>)[0]!.name = 'renamed-scenario';
    const body = renderComment(head, base);
    expect(body).toContain('| renamed-scenario | — |');
    expect(body).toContain('| steady-middle-text | 10.00 ms | — | n/a | — |');
  });
});
