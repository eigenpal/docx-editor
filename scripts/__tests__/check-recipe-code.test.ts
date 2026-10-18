import { describe, expect, test } from 'bun:test';
import { codeBlocks, toRecipeLines, vueScript } from '../check-recipe-code.mjs';

describe('recipe code check', () => {
  test('finds each fenced block with the recipe line its code starts on', () => {
    const text = 'Intro\n\n```tsx\nconst a = 1;\n```\n\nText\n\n```vue\n<template />\n```\n';
    expect(codeBlocks(text)).toEqual([
      { lang: 'tsx', line: 4, code: 'const a = 1;' },
      { lang: 'vue', line: 10, code: '<template />' },
    ]);
  });

  test('refuses a block that would otherwise go unchecked', () => {
    expect(() => codeBlocks('```typescript\nconst a = 1;\n```')).toThrow('"typescript"');
    expect(() => codeBlocks('```\nconst a = 1;\n```')).toThrow('language ""');
    expect(() => codeBlocks('```ts\nconst a = 1;')).toThrow('unclosed');
    expect(codeBlocks('```bash\nbun add x\n```')).toEqual([
      { lang: 'bash', line: 2, code: 'bun add x' },
    ]);
  });

  test('keeps the script line numbers of a Vue block and reads its file name', () => {
    const code =
      '<!-- MyCards.vue -->\n<script setup lang="ts">\nconst a = 1;\n</script>\n\n<template />';
    const { name, script } = vueScript(code);
    expect(name).toBe('MyCards');
    expect(script.split('\n')[2]).toBe('const a = 1;');
  });

  test('refuses a Vue block without a typed script setup', () => {
    expect(() => vueScript('<script setup>\n</script>')).toThrow('<script setup lang="ts">');
  });

  test('reports errors at recipe lines, in the attributes and the source excerpt', () => {
    const origins = new Map([['vue/a.vue.ts', { file: 'recipes/a.mdx', line: 20 }]]);
    const output =
      '<error file="x/recipe-check/vue/a.vue.ts" line="3" column="1" code="TS2339">\n' +
      '<source>\n3 | const a = b;\n</source>\n<also>x/recipe-check/vue/a.vue.ts:5:2</also>\n</error>\n' +
      '<error file="packages/core/src/x.ts" line="3">\n3 | y\n</error>\n';
    expect(toRecipeLines(output, origins)).toBe(
      '<error file="recipes/a.mdx" line="22" column="1" code="TS2339">\n' +
        '<source>\n22 | const a = b;\n</source>\n<also>recipes/a.mdx:24:2</also>\n</error>\n' +
        '<error file="packages/core/src/x.ts" line="3">\n3 | y\n</error>\n'
    );
  });
});
