import type { InjectionKey } from 'vue';
import type {
  DocxEditorInstance,
  RevisionAuthorStyle,
  RevisionStyles,
} from '@docx-editor.dev/core/editor';

export interface RevisionStyleRegistry {
  registerScheme(id: symbol): void;
  register(id: symbol, author: string, style: RevisionAuthorStyle): void;
  unregister(id: symbol): void;
  connect(editor: DocxEditorInstance | null): void;
  current(): RevisionStyles | undefined;
}

export function createRevisionStyleRegistry(): RevisionStyleRegistry {
  const schemes = new Set<symbol>();
  const entries = new Map<symbol, { author: string; style: RevisionAuthorStyle }>();
  const ranks = new Map<symbol, number>();
  let nextRank = 0;
  let editor: DocxEditorInstance | null = null;
  let overriding = false;
  let written: string | null = null;
  let scheduled = false;

  function current(): RevisionStyles | undefined {
    if (schemes.size === 0 && entries.size === 0) return undefined;
    if (entries.size === 0) return 'kind';
    const authors: Record<string, RevisionAuthorStyle> = Object.create(null);
    const ordered = [...entries].sort((a, b) => (ranks.get(a[0]) ?? 0) - (ranks.get(b[0]) ?? 0));
    for (const [, { author, style }] of ordered) authors[author] = style;
    return { authors, others: schemes.size > 0 ? 'kind' : 'author' };
  }

  function schemeKey(styles: RevisionStyles | undefined): string {
    if (styles === undefined) return 'none';
    if (typeof styles === 'string') return styles;
    const authors = Object.entries(styles.authors)
      .map(([author, style]) => `${author}\u0000${JSON.stringify(style)}`)
      .sort();
    return `${styles.others ?? 'kind'}\u0001${authors.join('\u0001')}`;
  }

  function flush(): void {
    if (!editor) return;
    const styles = current();
    const key = schemeKey(styles);
    if (key === written) return;
    if (styles === undefined) {
      if (overriding) {
        editor.setRevisionStyles('author');
        overriding = false;
        written = key;
      }
      return;
    }
    editor.setRevisionStyles(styles);
    overriding = true;
    written = key;
  }

  function apply(): void {
    if (!editor || scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      flush();
    });
  }

  return {
    registerScheme(id) {
      schemes.add(id);
      apply();
    },
    register(id, author, style) {
      if (!ranks.has(id)) ranks.set(id, nextRank++);
      entries.set(id, { author, style });
      apply();
    },
    unregister(id) {
      const removed = schemes.delete(id) || entries.delete(id);
      if (removed) apply();
    },
    connect(next) {
      editor = next;
      const seeded = current();
      overriding = next !== null && seeded !== undefined;
      written = next === null ? null : schemeKey(seeded);
      apply();
    },
    current,
  };
}

export const RevisionStyleRegistryContext: InjectionKey<RevisionStyleRegistry> =
  Symbol('RevisionStyleRegistry');
