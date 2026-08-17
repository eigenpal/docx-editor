import { describe, expect, test } from 'bun:test';

import { aggregateReports, COMMENT_MARKER, renderComment } from './edit-bench-comment.mjs';

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

  test('the comment is the table alone — no chart block', () => {
    const body = renderComment(report({ medianMs: 8 }), report({ medianMs: 10 }));
    expect(body).not.toContain('```mermaid');
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

describe('interleaved-run aggregation', () => {
  const engine = (scenario: { total: { medianMs: number } }) => scenario.total;

  test('two runs aggregate to the mean of their medians', () => {
    const head = aggregateReports([report({ medianMs: 10 }), report({ medianMs: 12 })], engine);
    const body = renderComment(head, aggregateReports([report({ medianMs: 10 })], engine));
    expect(body).toContain('| steady-middle-text | 10.00 ms | 11.00 ms |');
    expect(body).toContain('How to read these tables');
  });

  test('a delta inside the same-side spread renders neutral, outside it colors', () => {
    // Head runs 10 and 14: mean 12, spread (14-10)/12 = 33%. The +20% delta vs a
    // base of 10 stays neutral because the head disagrees with itself by more.
    const noisy = aggregateReports([report({ medianMs: 10 }), report({ medianMs: 14 })], engine);
    const base = aggregateReports([report({ medianMs: 10 })], engine);
    const noisyBody = renderComment(noisy, base);
    expect(noisyBody).toContain('| ⚪ +20.0% |');
    // Steady runs 12 and 12: zero spread, same +20% delta now colors red.
    const steady = aggregateReports([report({ medianMs: 12 }), report({ medianMs: 12 })], engine);
    expect(renderComment(steady, base)).toContain('| 🔴 +20.0% |');
  });

  test('all-zero medians record no spread instead of a NaN that neutralizes everything', () => {
    const zeroHead = aggregateReports([report({ medianMs: 0 }), report({ medianMs: 0 })], engine);
    const base = aggregateReports([report({ medianMs: 10 })], engine);
    const body = renderComment(zeroHead, base);
    expect(body).toContain('🟢 -100.0%');
    expect(body).not.toContain('NaN');
  });

  test('a run with a different fixture hash is dropped from the aggregate', () => {
    const head = aggregateReports(
      [report({ medianMs: 10 }), report({ medianMs: 20, fixtureSha256: 'other' })],
      engine
    );
    expect(head.runCount).toBe(1);
    const body = renderComment(head, aggregateReports([report({ medianMs: 10 })], engine));
    expect(body).toContain('| steady-middle-text | 10.00 ms | 10.00 ms |');
  });
});

function uxReport(overrides: { fixtureSha256?: string; inputMedianMs?: number }) {
  const median = overrides.inputMedianMs ?? 40;
  return {
    schema: 1,
    fixture: 'synthetic-long-edit.docx',
    fixtureSha256: overrides.fixtureSha256 ?? 'abc123',
    environment: { browser: 'chromium', platform: 'linux' },
    config: { runs: 7, warmup: 2 },
    scenarios: [
      {
        name: 'editing-character',
        inputTask: {
          medianMs: median,
          p95Ms: median * 1.4,
          minMs: median * 0.8,
          maxMs: median * 2,
        },
        frame: { medianMs: median + 8, p95Ms: median + 20, minMs: median, maxMs: median * 2 },
      },
    ],
  };
}

describe('browser typing-latency section', () => {
  test('renders first, with deltas, and subtitles the engine table', () => {
    const body = renderComment(report({}), report({}), {
      headUx: uxReport({ inputMedianMs: 30 }),
      baseUx: uxReport({ inputMedianMs: 40 }),
    });
    expect(body).toContain('### Typing latency (browser)');
    expect(body).toContain('### Engine layout (headless)');
    expect(body.indexOf('Typing latency')).toBeLessThan(body.indexOf('Engine layout'));
    expect(body).toContain('| editing-character | 40.00 ms | 30.00 ms | 🟢 -25.0% |');
  });

  test('head-only browser report renders without deltas', () => {
    const body = renderComment(report({}), undefined, { headUx: uxReport({}) });
    expect(body).toContain('### Typing latency (browser)');
    expect(body).toContain('| editing-character | 40.00 ms |');
    expect(body).not.toContain('| Base median | Head median | Δ | Head p95 | Frame p95 |');
  });

  test('a browser fixture mismatch degrades that section to head-only', () => {
    const body = renderComment(report({}), report({}), {
      headUx: uxReport({ fixtureSha256: 'new' }),
      baseUx: uxReport({ fixtureSha256: 'old' }),
    });
    expect(body).toContain('Browser baseline not comparable');
  });

  test('no browser report keeps the original single-table layout', () => {
    const body = renderComment(report({}), report({}));
    expect(body).not.toContain('Typing latency');
    expect(body).not.toContain('Engine layout');
  });

  test('a scenario removed on head still shows its baseline row', () => {
    const base = uxReport({});
    const head = uxReport({});
    (head.scenarios as Array<{ name: string }>)[0]!.name = 'renamed-ux-scenario';
    const body = renderComment(report({}), report({}), { headUx: head, baseUx: base });
    expect(body).toContain('| editing-character | 40.00 ms | — | n/a | — | — |');
  });

  test('four oversized reports stay under the GitHub comment cap', () => {
    const oversize = (target: Record<string, unknown>) => ({
      ...target,
      padding: 'x'.repeat(40_000),
    });
    const body = renderComment(oversize(report({})), oversize(report({})), {
      headUx: oversize(uxReport({})),
      baseUx: oversize(uxReport({})),
    });
    expect(body.length).toBeLessThan(65_536);
    expect(body).toContain('… truncated …');
  });
});
