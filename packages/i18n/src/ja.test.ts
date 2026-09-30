import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createT, deepMerge, en, ja, locales, type LocaleStrings } from './index';
import jaSubpath from './ja';
import catalog from '../ja.json';

function flatten(value: object, prefix = ''): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return typeof entry === 'string' ? [[path, entry]] : Object.entries(flatten(entry, path));
    })
  );
}

function parameters(message: string) {
  return [...new Set(Array.from(message.matchAll(/\{(\w+)(?=[},])/g), (match) => match[1]))].sort();
}

describe('Japanese editor locale', () => {
  const source = flatten(en);
  const translated = flatten(catalog);

  it('covers the source catalog without empty strings or extra keys', () => {
    assert.deepEqual(Object.keys(translated).sort(), Object.keys(source).sort());
    for (const [key, value] of Object.entries(translated)) {
      assert.notEqual(value.trim(), '', key);
    }
    assert.equal(catalog._lang, 'ja');
    assert.equal(locales.ja, jaSubpath);
  });

  it('preserves interpolation parameters and keyboard shortcuts', () => {
    for (const [key, value] of Object.entries(source)) {
      assert.deepEqual(parameters(translated[key]), parameters(value), key);
      const shortcuts = value.match(/\b(?:Ctrl|Alt|Shift|Meta)(?:\+[A-Za-z0-9=]+)+/g) ?? [];
      for (const shortcut of shortcuts) {
        assert.ok(translated[key].includes(shortcut), `${key}: ${shortcut}`);
      }
    }
  });

  it('renders Japanese counters for zero, one, and multiple results', () => {
    const t = createT(deepMerge(en, ja) as LocaleStrings, 'ja');
    for (const count of [0, 1, 2, 15]) {
      assert.equal(t('navigation.find.total', { total: count }), `${count} 件`);
      assert.equal(t('navigation.find.totalTruncated', { total: count }), `${count} 件以上`);
      assert.equal(t('collaboration.moreParticipants', { count }), `他 ${count} 人`);
      assert.equal(t('collaborationDemo.caretPages', { count }), `${count} ページ`);
      assert.equal(t('documentRefresh.count', { count }), `最近の変更 ${count} 件`);
    }
    assert.equal(t('navigation.find.counter', { current: 2, total: 15 }), '15 件中 2 件目');
    assert.equal(
      t('toolbar.exportFailed', { message: '接続エラー' }),
      'エクスポートに失敗しました: 接続エラー'
    );
    assert.equal(t('unknown.key' as never), 'unknown.key');
  });
});
