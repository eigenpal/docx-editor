import { describe, expect, test } from 'bun:test';
import { createDocumentSchema, hasEnoughBrief, WRITER_TOOLS } from './tools';

const brief = {
  documentType: 'mutual NDA',
  partiesOrAudience: 'Example Company and Example Partner',
  purpose: 'evaluate a possible project',
  jurisdictionOrDomainRules: 'generic United States contract terms',
  tone: 'plain and balanced',
  length: 'two pages',
};

describe('writer agent tools', () => {
  test('the interview gate requires every brief field', () => {
    expect(hasEnoughBrief(brief)).toBe(true);
    expect(hasEnoughBrief({ ...brief, jurisdictionOrDomainRules: '' })).toBe(false);
  });

  test('fresh document input requires structured blocks', () => {
    expect(
      createDocumentSchema.safeParse({
        brief,
        title: 'Mutual non-disclosure agreement',
        blocks: [
          { text: 'Title', style: 'Title' },
          { text: 'Purpose', style: 'Heading 1' },
          { text: 'Terms', style: 'Normal', list: 'numbered', contentControl: true },
        ],
      }).success
    ).toBe(true);
    expect(createDocumentSchema.safeParse({ brief, title: 'Draft', blocks: [] }).success).toBe(
      false
    );
  });

  test('the catalog exposes creation and all tracked proposal commands', () => {
    expect(Object.keys(WRITER_TOOLS).sort()).toEqual([
      'create_document',
      'propose_deletion',
      'propose_insertion',
      'propose_replacement',
      'read_document',
    ]);
  });
});
