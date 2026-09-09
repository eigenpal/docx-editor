import { describe, expect, test } from 'bun:test';
import { ACCEPTED_RUN_PROPERTIES, type OoxmlProperty } from '@docx-editor.dev/core/store';
import { lastWinsRunLanguage } from '../run-language.ts';

const lang = (val: string): OoxmlProperty => ({ localName: 'lang', attributes: { val } });

describe('lastWinsRunLanguage', () => {
  test('reads the last cascaded w:lang/@w:val', () => {
    expect(lastWinsRunLanguage([])).toBeNull();
    expect(lastWinsRunLanguage([{ localName: 'b' }])).toBeNull();
    expect(lastWinsRunLanguage([lang('en-US')])).toBe('en-US');
    expect(lastWinsRunLanguage([lang('en-US'), lang('ru-RU')])).toBe('ru-RU');
    expect(lastWinsRunLanguage([lang('en-US'), { localName: 'lang' }, lang('fr-FR')])).toBe(
      'fr-FR'
    );
    expect(lastWinsRunLanguage([lang('  en-GB  ')])).toBe('en-GB');
    expect(lastWinsRunLanguage([lang('en-US'), lang('ru-RU'), lang('en-GB')])).toBe('en-GB');
  });

  test('does not add language to authorable run properties', () => {
    expect((ACCEPTED_RUN_PROPERTIES as readonly string[]).includes('lang')).toBe(false);
  });
});
