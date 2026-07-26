import { describe, expect, test } from 'bun:test';
import { evaluateLighthouseGate, lighthouseGateExitCode } from '../scripts/lighthouse-a11y-gate.ts';

describe('lighthouse accessibility gate', () => {
  test('passes only when score is 1 and no scored audits fail', () => {
    const passing = evaluateLighthouseGate(
      {
        categories: { accessibility: { score: 1 } },
        audits: {
          'label-names': { id: 'label-names', title: 'Labels', score: 1 },
        },
      },
      'http://localhost:5299/'
    );
    expect(lighthouseGateExitCode(passing)).toBe(0);

    const failingScore = evaluateLighthouseGate(
      { categories: { accessibility: { score: 0.96 } }, audits: {} },
      'http://localhost:5299/'
    );
    expect(lighthouseGateExitCode(failingScore)).toBe(1);

    const failingAudit = evaluateLighthouseGate(
      {
        categories: { accessibility: { score: 1 } },
        audits: {
          'aria-hidden-body': { id: 'aria-hidden-body', title: 'Hidden body', score: 0 },
        },
      },
      'http://localhost:5299/'
    );
    expect(failingAudit.failedAuditIds).toEqual(['aria-hidden-body']);
    expect(lighthouseGateExitCode(failingAudit)).toBe(1);
  });
});
