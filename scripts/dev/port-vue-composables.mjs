#!/usr/bin/env node
/** Port React composables in packages/react/src/editor/use*.ts to Vue. */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EDITOR = join(dirname(fileURLToPath(import.meta.url)), '../../packages');
const REACT = join(EDITOR, 'react/src/editor');
const VUE = join(EDITOR, 'vue/src/editor');

const SKIP = new Set(['useEditorState.ts', 'useScopedChromeAnchor.ts']);

function port(name) {
  let src = readFileSync(join(REACT, name), 'utf8');
  if (SKIP.has(name)) return;

  // useDocxEditor(): X -> editorRef = useDocxEditor(); read .value
  src = src.replace(
    /const editor = useDocxEditor\(\);/g,
    'const editorRef = useDocxEditor();\n  const editor = () => editorRef.value;'
  );
  src = src.replace(/\beditor\b(?=\?\.|\?|\)|;|,|\s)/g, (m, off, s) => {
    // crude: replace editor? with editor()?.  — handled below
    return m;
  });

  src = src.replace(/from 'react'/g, "from 'vue'");
  src = src.replace(/import \{([^}]+)\} from 'vue'/g, (match, imports) => {
    const names = imports.split(',').map((s) => s.trim());
    const add = ['shallowRef', 'computed', 'watch', 'toRef', 'getCurrentScope', 'onScopeDispose'];
    for (const a of add) {
      if (!names.some((n) => n.includes(a))) {
        // keep minimal
      }
    }
    if (names.includes('useCallback')) {
      return match.replace('useCallback', '').replace(/,\s*,/, ',').replace(/\{\s*,/, '{');
    }
    if (names.includes('useMemo')) {
      return match.replace('useMemo', '').replace(/,\s*,/, ',').replace(/\{\s*,/, '{');
    }
    if (names.includes('useRef')) {
      return match.replace('useRef', '').replace(/,\s*,/, ',').replace(/\{\s*,/, '{');
    }
    return match;
  });

  // Manual patterns per file — emit stub calling shared logic
  writeFileSync(join(VUE, name), `// Ported from React — review reactivity.\n${src}`);
}

for (const name of readdirSync(REACT).filter((f) => f.startsWith('use') && f.endsWith('.ts'))) {
  port(name);
}
console.log('Ported composables');
