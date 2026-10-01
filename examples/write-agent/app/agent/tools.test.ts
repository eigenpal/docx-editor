import { describe, expect, test } from 'bun:test';
import { createDocumentSchema, hasEnoughBrief, toolLabel, WRITER_TOOLS } from './tools';

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
          { text: 'Subtitle', style: 'Subtitle' },
          { text: 'Purpose', style: 'Heading 1' },
          { text: 'Scope', style: 'Heading 2' },
          { text: 'First term', style: 'Normal' },
          { text: 'Second term', style: 'Normal' },
          { text: 'Third term', style: 'Normal' },
          { text: 'Summary', style: 'Quote' },
        ],
      }).success
    ).toBe(true);
    expect(createDocumentSchema.safeParse({ brief, title: 'Draft', blocks: [] }).success).toBe(
      false
    );
  });

  test('the catalog exposes granular structure and tracked proposal commands', () => {
    expect(Object.keys(WRITER_TOOLS).sort()).toEqual([
      'configure_list',
      'create_document',
      'discover_capabilities',
      'edit_control',
      'edit_field',
      'edit_layout',
      'edit_list',
      'edit_picture',
      'edit_properties',
      'edit_review',
      'edit_table',
      'edit_text',
      'format_document',
      'format_lists',
      'insert_break',
      'insert_content_controls',
      'insert_table',
      'inspect_document',
      'read_document',
      'read_properties',
      'write_header_footer',
      'write_story',
    ]);
  });

  test('uses reader-facing language for document reads', () => {
    expect(toolLabel('read_document')).toBe('Reading the document');
  });
});

test('maps every pinned editing member to an available tool or application mode', async () => {
  const { EDITING_COVERAGE, APPLICATION_COVERAGE } = await import('./coverage');
  const profile = await import('../../../../packages/editor-api/compat/agent-editing-scope.json');
  const covered = [...Object.values(EDITING_COVERAGE).flat(), ...APPLICATION_COVERAGE].map(
    (member) => `Word.${member.replace('.', '#')}`
  );
  expect(profile.endpoints.filter((endpoint) => !covered.includes(endpoint))).toEqual([]);
  for (const name of Object.keys(EDITING_COVERAGE)) expect(name in WRITER_TOOLS).toBe(true);
});
